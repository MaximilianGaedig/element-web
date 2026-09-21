/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A chat, as the model is given it.
 *
 * One builder for every question asked about a room - what you missed, what you might reply, what the
 * digest triages - because they were three copies of the same twenty lines and only one of them ever got
 * fixed.
 *
 * Pictures count as things that were said. A chat where somebody sent a photo of an address and then
 * wrote "here" is unanswerable from the words alone, so a picture arrives as what it is and, where the
 * device or the server already read it, what it says: the text out of the picture, or what was said in a
 * voice message. Nothing is read here to make that happen - this uses only what has already been read
 * (utils/detect/mediaText.ts), so asking a question never sets an OCR engine going.
 */

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { type AskMessage } from "./ask";
import { storedMediaText } from "../detect/mediaText";
import { _t } from "../../languageHandler";

/** How much of one message is worth sending. */
const LONGEST = 2000;

/** The message types that are a thing sent rather than something said. */
const MEDIA: Record<string, string> = {
    "m.image": "ai|a_picture",
    "m.video": "ai|a_video",
    "m.audio": "ai|a_voice_message",
    "m.file": "ai|a_file",
};

/**
 * What a message is, as the reader sees it.
 *
 * "A picture" covers a photograph of a receipt and a reaction gif, and a chat where somebody answers a
 * question with a sticker reads as silence unless the sticker is there. The model is shown what a person
 * would see at a glance: a sticker, a gif, a video, a voice message, a photograph.
 */
function kindOf(event: MatrixEvent): string | undefined {
    if (event.getType() === "m.sticker") return "sticker";
    const content = event.getContent();
    const msgtype = typeof content.msgtype === "string" ? content.msgtype : undefined;
    if (msgtype === "m.image") return content.info?.mimetype === "image/gif" ? "gif" : "picture";
    if (msgtype === "m.video") return "video";
    if (msgtype === "m.audio") return content["org.matrix.msc3245.voice"] ? "voice message" : "audio";
    if (msgtype === "m.file") return "file";
    if (msgtype === "m.emote") return "emote";
    return undefined;
}

/**
 * What is in a message's content that the line about it does not already say.
 *
 * Everything the model was missing - what something was a reply to, whether it was a sticker, how long a
 * voice message is, where a location points - is in the event, and each time one of them was missed it had
 * to be noticed and added by hand. So the content travels with the message: whatever the event says, minus
 * the parts that are noise (the body, which is the line itself) and the parts that must never leave the
 * device at all.
 *
 * Those are the ones to be careful about. An encrypted room's `file` carries the key the media is
 * decrypted with, and `url` is a handle to the media itself: neither means anything to a model, and both
 * would hand a server that only ever needed to read words the ability to fetch and decrypt the pictures.
 * They are dropped here, at the point they would otherwise be copied.
 */
const TELLS_NOTHING = new Set(["body", "formatted_body", "url", "file", "msgtype"]);

function detailOf(event: MatrixEvent): Record<string, unknown> | undefined {
    const content = event.getContent() as Record<string, unknown>;
    const detail: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
        if (TELLS_NOTHING.has(key) || value === undefined) continue;
        if (key === "info" && value && typeof value === "object") {
            // The same rule one level down: a thumbnail has its own url and its own key.
            const info = Object.fromEntries(
                Object.entries(value as Record<string, unknown>).filter(
                    ([name]) => !name.startsWith("thumbnail_") && name !== "xyz.amorgan.blurhash",
                ),
            );
            if (Object.keys(info).length) detail.info = info;
            continue;
        }
        detail[key] = value;
    }
    return Object.keys(detail).length ? detail : undefined;
}

/**
 * What people reacted with, which is a reply of the shortest kind.
 *
 * A thumbs-up on the question about Saturday is the answer to it, and a chat read without the reactions is
 * a chat where three people said nothing. The aggregation is the one the timeline itself draws from, so
 * this says exactly what is on the screen.
 */
function reactionsOf(room: Room, event: MatrixEvent): Record<string, number> | undefined {
    const id = event.getId();
    const relations = id
        ? room.getUnfilteredTimelineSet().relations?.getChildEventsForEvent(id, "m.annotation", "m.reaction")
        : undefined;
    const counted: Record<string, number> = {};
    for (const [key, events] of relations?.getSortedAnnotationsByKey() ?? []) {
        const alive = [...events].filter((one) => !one.isRedacted()).length;
        if (key && alive) counted[key] = alive;
    }
    return Object.keys(counted).length ? counted : undefined;
}

/** The message this one is a reply to, where it is one. */
const replyOf = (event: MatrixEvent): string | undefined =>
    event.getContent()["m.relates_to"]?.["m.in_reply_to"]?.event_id;

/** What one event contributes, or nothing at all: its words, or what its picture says. */
export async function sayable(client: MatrixClient, event: MatrixEvent): Promise<string | undefined> {
    const content = event.getContent();
    const body = typeof content.body === "string" ? content.body : "";
    if (event.getType() === "m.sticker") return body.trim() || _t("ai|a_sticker");
    const media = typeof content.msgtype === "string" ? MEDIA[content.msgtype] : undefined;
    if (!media) return body.trim() || undefined;

    /*
     * A picture is named by what it is, not by IMG_4032.HEIC, and then by what it says if anybody has
     * read it. The reading is the server's copy where there is one, so a photo read on a phone is
     * answerable from a laptop that never opened it.
     */
    const said = await storedMediaText(client, event.getRoomId()!, event.getId()!).catch(() => undefined);
    // Text out of a picture, words out of a voice message, or a description of what is in it: whichever
    // the server has, in that order - the first two are what was actually there, the third is a guess.
    const text = said?.ocr ?? said?.transcript ?? said?.description;
    const what = _t(media);
    return text ? `${what}: ${text.slice(0, LONGEST)}` : `${what}${body ? ` (${body})` : ""}`;
}

/**
 * The last `most` messages of a chat, each with an id the answer can cite.
 *
 * Media is looked up in parallel: one small request per picture against a server that usually already
 * has the answer, rather than a round trip each in turn while somebody waits.
 */
export async function readable(
    client: MatrixClient,
    room: Room,
    most: number,
    /** The first message they have not read: from there on, everything is news rather than context. */
    newFrom?: string,
): Promise<AskMessage[]> {
    const events = room
        .getLiveTimeline()
        .getEvents()
        // Stickers are their own event type and are half of what some chats are made of.
        .filter(
            (event) => (event.getType() === "m.room.message" || event.getType() === "m.sticker") && !event.isRedacted(),
        )
        .slice(-most);
    const lines = await Promise.all(events.map((event) => sayable(client, event)));
    const from = newFrom ? events.findIndex((event) => event.getId() === newFrom) : -1;
    const me = client.getSafeUserId();
    const out: AskMessage[] = [];
    for (const [at, event] of events.entries()) {
        const body = lines[at];
        if (!body) continue;
        out.push({
            id: event.getId()!,
            sender: event.sender?.name ?? event.getSender() ?? "?",
            senderId: event.getSender(),
            avatar: event.sender?.getMxcAvatarUrl(),
            ts: new Date(event.getTs()).toISOString().slice(0, 16).replace("T", " "),
            body: body.slice(0, LONGEST),
            new: from >= 0 && at >= from,
            mine: event.getSender() === me,
            replyTo: replyOf(event),
            kind: kindOf(event),
            edited: !!event.replacingEventId(),
            reactions: reactionsOf(room, event),
            detail: detailOf(event),
        });
    }
    return out;
}
