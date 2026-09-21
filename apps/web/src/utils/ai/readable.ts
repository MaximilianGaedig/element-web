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
    "m.image": "tg_layout|ai_a_picture",
    "m.video": "tg_layout|ai_a_video",
    "m.audio": "tg_layout|ai_a_voice_message",
    "m.file": "tg_layout|ai_a_file",
};

/** What one event contributes, or nothing at all: its words, or what its picture says. */
export async function sayable(client: MatrixClient, event: MatrixEvent): Promise<string | undefined> {
    const content = event.getContent();
    const body = typeof content.body === "string" ? content.body : "";
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
        .filter((event) => event.getType() === "m.room.message" && !event.isRedacted())
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
        });
    }
    return out;
}
