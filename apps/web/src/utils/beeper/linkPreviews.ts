/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IPreviewUrlResponse, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type EncryptedFile } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";

import SettingsStore from "../../settings/SettingsStore";
import { decryptFile } from "../DecryptFile";

/** Bundled URL previews (MSC4095), as sent by mautrix bridges. */
export const LINK_PREVIEWS_KEY = "com.beeper.linkpreviews";

/** One entry of `com.beeper.linkpreviews` (mautrix-go event.BeeperLinkPreview). */
export interface BundledLinkPreview {
    "matched_url"?: string;
    "og:url"?: string;
    "og:title"?: string;
    "og:type"?: string;
    "og:description"?: string;
    "og:site_name"?: string;
    "og:image"?: string;
    "og:image:type"?: string;
    "og:image:width"?: number | string;
    "og:image:height"?: number | string;
    "matrix:image:size"?: number | string;
    "matrix:image:blurhash"?: string;
    "beeper:image:encryption"?: EncryptedFile;
}

/** Shapes a bundled preview like a homeserver /preview_url response. */
export function toPreviewUrlResponse(preview: BundledLinkPreview): IPreviewUrlResponse {
    const response: IPreviewUrlResponse = {
        "og:title": typeof preview["og:title"] === "string" ? preview["og:title"] : "",
        "og:type": typeof preview["og:type"] === "string" ? preview["og:type"] : "",
        "og:url": preview["og:url"] ?? preview.matched_url ?? "",
    };
    for (const key of ["og:description", "og:site_name", "og:image", "og:image:type"] as const) {
        if (typeof preview[key] === "string") response[key] = preview[key];
    }
    for (const key of ["og:image:width", "og:image:height", "matrix:image:size"] as const) {
        // mautrix-go's IntOrString accepts both; the preview renderer wants numbers.
        const raw = preview[key];
        const value = typeof raw === "string" ? parseInt(raw, 10) : raw;
        if (typeof value === "number" && !isNaN(value)) response[key] = value;
    }
    return response;
}

function normalise(url: string): string {
    try {
        const u = new URL(url);
        return u.href.replace(/\/$/, "");
    } catch {
        return url.replace(/\/$/, "");
    }
}

/** The previews the sender bundled into the event (from the latest edit, if any). */
export function getBundledLinkPreviews(mxEvent: MatrixEvent): BundledLinkPreview[] {
    const raw = mxEvent.getContent()?.[LINK_PREVIEWS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (p): p is BundledLinkPreview =>
            !!p && typeof p === "object" && (typeof p.matched_url === "string" || typeof p["og:url"] === "string"),
    );
}

/** The URL a bundled preview is for: the text that matched in the body, else its canonical URL. */
export function bundledPreviewLink(preview: BundledLinkPreview): string {
    return (preview.matched_url || preview["og:url"])!;
}

/** Finds the bundled preview for a link found in the rendered body. */
export function findBundledLinkPreview(mxEvent: MatrixEvent, link: string): BundledLinkPreview | undefined {
    const wanted = normalise(link);
    return getBundledLinkPreviews(mxEvent).find(
        (p) =>
            (p.matched_url && normalise(p.matched_url) === wanted) ||
            (p["og:url"] && normalise(p["og:url"]) === wanted),
    );
}

/**
 * Merges links found in the body with the bundled previews' links, keeping body order and
 * appending bundled links the body didn't linkify (e.g. bare domains the heuristic skipped).
 */
export function mergeBundledLinks(mxEvent: MatrixEvent, domLinks: string[]): string[] {
    const result = [...domLinks];
    for (const preview of getBundledLinkPreviews(mxEvent)) {
        const link = bundledPreviewLink(preview);
        if (!result.some((l) => normalise(l) === normalise(link))) result.push(link);
    }
    return result;
}

/**
 * Whether bundled previews may be shown even though URL previews are off for this room.
 *
 * Element disables previews in encrypted rooms by default because fetching them leaks the URL to
 * the homeserver. Bundled previews need no request, so in encrypted rooms we follow the general
 * (unencrypted) preview setting instead, so turning previews off globally still hides them.
 */
export function bundledPreviewsAllowed(mxEvent: MatrixEvent): boolean {
    if (getBundledLinkPreviews(mxEvent).length === 0) return false;
    if (!mxEvent.isEncrypted()) return false;
    return !!SettingsStore.getValue("urlPreviewsEnabled", mxEvent.getRoomId() ?? null);
}

/**
 * Decrypts the image of a bundled preview sent in an encrypted room and returns an object URL for
 * it (tracked in `blobUrls` so the caller can revoke it), or undefined on failure.
 */
export async function bundledPreviewImageUrl(
    preview: BundledLinkPreview,
    blobUrls: string[],
): Promise<string | undefined> {
    const file = preview["beeper:image:encryption"];
    if (!file?.url) return undefined;
    try {
        const blob = await decryptFile(file, { mimetype: preview["og:image:type"] });
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        return url;
    } catch (e) {
        logger.warn("Failed to decrypt bundled link preview image", e);
        return undefined;
    }
}
