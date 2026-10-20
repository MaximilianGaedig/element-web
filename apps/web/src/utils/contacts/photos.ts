/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A contact's picture: in the reader's media, never inside the card.
 *
 * A phone exports a contact's photo as a base64 PHOTO line, and the card used to carry that line verbatim
 * among the properties it does not understand (`extra`). Six of them were 87% of the reader's whole
 * account data - about 83 KB each, copied once per Matrix ID and again into the history - and account data
 * goes to every new sync connection, including the one a phone opens for every push notification. So the
 * picture is uploaded on the way in and the card keeps only its mxc: URI, and it is inlined again only on
 * the way out, when a vCard leaves for another address book that cannot read mxc: URIs.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type ContactCard } from "./card";
import { toVCard } from "./vcard";

/**
 * The longest unknown vCard line a card carries. A property this client does not understand is carried so
 * that exporting does not strip it, but nothing that size is a property worth syncing to every device: a
 * line longer than this is a blob of some kind (a photo, a logo, a sound), and it is dropped.
 */
export const MAX_EXTRA_LINE = 1024;

/** An inline picture, as a vCard carries one. */
export interface InlinePhoto {
    /** A MIME type: `image/jpeg`. */
    type: string;
    base64: string;
}

/** What the first bytes say a picture is, for a PHOTO line that does not say. */
function sniff(base64: string): string {
    if (base64.startsWith("/9j/")) return "image/jpeg";
    if (base64.startsWith("iVBOR")) return "image/png";
    if (base64.startsWith("R0lG")) return "image/gif";
    if (base64.startsWith("UklGR")) return "image/webp";
    return "image/jpeg";
}

/**
 * The picture in a raw vCard line, if the line is an inline PHOTO: vCard 3's `PHOTO;ENCODING=b;TYPE=JPEG:...`
 * or vCard 4's `PHOTO:data:image/jpeg;base64,...`, with or without an `item1.` group. A PHOTO that is a link
 * is not one: it is small, and carried as it is.
 */
export function inlinePhotoOf(raw: string): InlinePhoto | undefined {
    const colon = raw.indexOf(":");
    if (colon < 0) return undefined;
    const [name, ...params] = raw.slice(0, colon).split(";");
    if (name.split(".").pop()?.toUpperCase() !== "PHOTO") return undefined;
    const value = raw.slice(colon + 1);
    const data = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(value);
    if (data) {
        if (!/;base64/i.test(data[2])) return undefined;
        const base64 = data[3].replace(/\s+/g, "");
        return { type: data[1] || sniff(base64), base64 };
    }
    const upper = params.map((param) => param.toUpperCase());
    if (!upper.some((param) => param === "ENCODING=B" || param === "ENCODING=BASE64")) return undefined;
    const base64 = value.replace(/\s+/g, "");
    const declared = upper.find((param) => param.startsWith("TYPE="))?.slice(5);
    return { type: declared ? `image/${declared.toLowerCase()}` : sniff(base64), base64 };
}

const bytesOf = (base64: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

/**
 * The card with its inline picture moved to the reader's media and every oversized unknown line dropped.
 *
 * The first picture becomes `photoUrl` unless the card already has one (a picture the reader chose wins);
 * any other inline picture is dropped, since a card shows one. `uploaded` remembers what has gone up in this
 * run by its content, so the same photo copied into several cards and their history is uploaded once.
 */
export async function photosToMedia(
    client: MatrixClient,
    card: ContactCard,
    uploaded: Map<string, Promise<string>> = new Map(),
): Promise<ContactCard> {
    if (!card.extra?.length) return card;
    let photoUrl = card.photoUrl;
    const extra: string[] = [];
    for (const raw of card.extra) {
        const photo = inlinePhotoOf(raw);
        if (photo) {
            if (!photoUrl) {
                let url = uploaded.get(photo.base64);
                if (!url) {
                    url = client
                        .uploadContent(new Blob([bytesOf(photo.base64)], { type: photo.type }), {
                            type: photo.type,
                            includeFilename: false,
                        })
                        .then((response) => response.content_uri);
                    uploaded.set(photo.base64, url);
                }
                photoUrl = await url;
            }
            continue;
        }
        if (raw.length > MAX_EXTRA_LINE) continue;
        extra.push(raw);
    }
    const { extra: _old, ...rest } = card;
    return { ...rest, ...(photoUrl ? { photoUrl } : {}), ...(extra.length ? { extra } : {}) };
}

/** Bytes as base64, in slices: spreading a whole photo into one call overflows the argument limit. */
function base64Of(bytes: Uint8Array): string {
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }
    return btoa(binary);
}

/**
 * The card's picture, fetched back from the media repository for a vCard that leaves this client: another
 * address book cannot read an mxc: URI. Nothing when there is no picture or it cannot be fetched - a contact
 * exported without its picture is still the contact.
 */
export async function photoForExport(client: MatrixClient, card: ContactCard): Promise<InlinePhoto | undefined> {
    if (!card.photoUrl?.startsWith("mxc://")) return undefined;
    try {
        const { mediaFromMxc } = await import("../../customisations/Media");
        const response = await mediaFromMxc(card.photoUrl, client).downloadSource();
        const blob = await response.blob();
        return { type: blob.type || "image/jpeg", base64: base64Of(new Uint8Array(await blob.arrayBuffer())) };
    } catch {
        return undefined;
    }
}

/** A person's vCard as it leaves this client, with their picture in it rather than a link only we can read. */
export async function vCardWithPhoto(client: MatrixClient, card: ContactCard): Promise<string> {
    // Never the mxc: URI itself: nothing outside Matrix can open it, so a picture that could not be fetched is left out.
    const { photoUrl: _link, ...rest } = card;
    return toVCard(rest, { photo: await photoForExport(client, card) });
}

/** Several of them in one file, which is how a whole address book travels. */
export async function vCardsWithPhotos(client: MatrixClient, cards: ContactCard[]): Promise<string> {
    const texts: string[] = [];
    for (const card of cards) texts.push(await vCardWithPhoto(client, card));
    return texts.join("");
}
