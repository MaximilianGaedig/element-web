/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the model said, kept in the chat it was said about - and kept to yourself.
 *
 * An answer that vanishes when the app reloads is a toy. An answer that everybody in the chat sees is a
 * message, which is not what this is. So it is written as *your own* account data for the room: it sits
 * with the chat, follows you to your other devices, and nobody else in the room can see it at all.
 *
 * Sending one to the others is a separate act, done on purpose by pressing a button, and what is sent is
 * an ordinary message that says where it came from. Removing one takes it off every device you have.
 */

import { type MatrixClient, MsgType } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import Markdown from "../../Markdown";

export const AI_NOTES_EVENT_TYPE = "im.mxg.ai_notes";

/** One answer, against the message it was asked about. */
export interface AiNote {
    /** Ours, so a note can be removed without ambiguity. */
    id: string;
    /** The message it sits under in the timeline. */
    anchor: string;
    /** What was asked, for a note that came from a question rather than a summary. */
    question?: string;
    answer: string;
    /** Event ids the answer rests on, and any web pages it used. */
    cites: string[];
    /** When it was asked, so an old answer can say so. */
    ts: number;
    /** Whether the model thought what it saw really answered it. */
    confident?: boolean;
    /** Where the ask is kept, so it can be opened and rated after the fact. */
    kept?: { roomId: string; eventId: string };
    /** What you thought of it, once you have said. */
    verdict?: "good" | "bad";
    /**
     * Exactly what left the device to get this answer.
     *
     * Kept with the answer rather than worked out again later, because what was sent is a fact about the
     * moment it was sent: the timeline has moved on since, and a count recomputed tomorrow would be a
     * different, confident-sounding number. What the model then went and looked up itself is in `looked`.
     */
    sent?: {
        /** How many messages of this chat went with the question. */
        messages: number;
        /** The first and last of them, so they can be seen rather than taken on trust. */
        first?: string;
        last?: string;
        /** How many of your own messages went as a writing sample, where any did. */
        style?: number;
        /** How many pictures were sent to be looked at, where any were. */
        pictures?: number;
        /** What it went and looked at afterwards: searches, chats read, pages fetched. */
        looked?: string[];
        /** Which model answered, how long it took, and how much of the day's allowance is left. */
        model?: string;
        ms?: number;
        asksLeft?: number;
    };
}

/** Enough to keep a chat's worth of thinking, not enough to bloat the account. */
const KEEP = 40;

function read(client: MatrixClient, roomId: string): AiNote[] {
    const room = client.getRoom(roomId);
    const content = room?.getAccountData(AI_NOTES_EVENT_TYPE)?.getContent<{ notes?: AiNote[] }>();
    return Array.isArray(content?.notes) ? content.notes : [];
}

async function write(client: MatrixClient, roomId: string, notes: AiNote[]): Promise<void> {
    try {
        // Our own event type, which the SDK's map of known ones does not (and should not) carry.
        await client.setRoomAccountData(roomId, AI_NOTES_EVENT_TYPE as never, { notes: notes.slice(-KEEP) } as never);
    } catch (error) {
        // The note is still on screen; it simply will not outlive the session.
        logger.warn("Could not keep what the model said", error);
    }
}

/** The notes of a chat, oldest first, as the timeline wants them. */
export function notesOf(client: MatrixClient, roomId: string): AiNote[] {
    return read(client, roomId);
}

/** Notes by the message they sit under, which is how the timeline looks them up. */
export function notesByAnchor(client: MatrixClient, roomId: string): Map<string, AiNote[]> {
    const byAnchor = new Map<string, AiNote[]>();
    for (const note of read(client, roomId)) {
        const at = byAnchor.get(note.anchor);
        if (at) at.push(note);
        else byAnchor.set(note.anchor, [note]);
    }
    return byAnchor;
}

export async function keepNote(client: MatrixClient, roomId: string, note: AiNote): Promise<void> {
    const notes = read(client, roomId).filter((other) => other.id !== note.id);
    await write(client, roomId, [...notes, note]);
}

export async function removeNote(client: MatrixClient, roomId: string, id: string): Promise<void> {
    await write(
        client,
        roomId,
        read(client, roomId).filter((note) => note.id !== id),
    );
}

/**
 * Sends a note to the others, as a plain message that says what it is.
 *
 * Marked as coming from the model, because passing off what a machine wrote as your own words is the
 * one thing this must never quietly do.
 */
export async function sendNote(client: MatrixClient, roomId: string, note: AiNote): Promise<void> {
    const preamble = note.question ? `${note.question}\n\n` : "";
    // What is sent is what was shown: the same markdown, through the same converter the composer uses.
    const markdown = new Markdown(`${preamble}${note.answer}`);
    // Cast because the extra key is ours: the SDK's message type knows only what the spec defines, and
    // a message that does not say a machine wrote it is the one thing this must never send.
    await client.sendMessage(roomId, {
        "msgtype": MsgType.Text,
        "body": `${preamble}${note.answer}`,
        ...(markdown.isPlainText()
            ? {}
            : { format: "org.matrix.custom.html", formatted_body: markdown.toHTML({ externalLinks: true }) }),
        // So a client that cares can tell, and so this can never be mistaken for something written here.
        "im.mxg.ai": { generated: true, cites: note.cites },
    } as never);
}
