/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Things you might say, drafted in your own words.
 *
 * Two places want them - the row above the composer, and the chats the digest says are waiting - so the
 * asking, the caching and the sampling of how you write live here rather than twice.
 *
 * Your voice is not a style setting, it is your messages: as many of your own as the chat holds are sent
 * alongside the conversation, marked as a voice to copy rather than something to answer, so what comes
 * back is the length you write, the punctuation you use and the languages you mix.
 *
 * Nothing is ever sent by suggesting it. A pill fills the composer, and sending stays yours.
 */

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { type AskMessage, ask, aiAvailable } from "./ask";

/** How much of the chat a draft needs: the turn being replied to, not the year around it. */
const READ_BACK = 20;
/** How many of your own messages are enough to write like you. */
const STYLE = 60;
/** Three at most, each short enough to be something somebody would actually send. */
const MOST = 3;
const LONGEST = 240;

/** Drafts already asked for, by the message they reply to: a chat re-entered costs nothing. */
const known = new Map<string, string[]>();

/** A draft chosen somewhere the composer was not: taken by that room's composer when it appears. */
const waitingDraft = new Map<string, string>();

const text = (event: MatrixEvent): string | undefined => {
    if (event.getType() !== "m.room.message" || event.isRedacted()) return undefined;
    const body = event.getContent().body;
    return typeof body === "string" && body.trim() ? body : undefined;
};

/**
 * The last message, if it is one worth drafting a reply to.
 *
 * Somebody else's words, waiting for an answer. Your own last message is not: you are not owed a reply to
 * yourself, and a chat where you spoke last needs nothing.
 */
export function waitingOn(room: Room, me: string): MatrixEvent | undefined {
    const events = room.getLiveTimeline().getEvents();
    for (let at = events.length - 1; at >= 0; at--) {
        const event = events[at];
        if (!text(event)) continue;
        return event.getSender() === me ? undefined : event;
    }
    return undefined;
}

/**
 * Three drafts out of one answer.
 *
 * The model is asked for a line each and writes them the way anybody writes a list: sometimes bulleted,
 * sometimes numbered, sometimes quoted. All of that comes off, because what goes in the composer has to
 * be the message and nothing about the message.
 */
export function drafts(answer: string): string[] {
    return answer
        .split("\n")
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .map((line) => line.replace(/^["'“”]|["'“”]$/g, "").trim())
        .filter((line) => line.length > 0 && line.length <= LONGEST)
        .slice(0, MOST);
}

/**
 * Replies for a chat, drafted once per message.
 *
 * The answer is kept against the id of the message it replies to, so two mounts of the same chat, and a
 * digest and a composer wanting the same drafts, cost one request between them. Nothing is drafted where
 * a reply makes no sense, and a failure leaves no pills rather than an apology.
 */
export async function repliesFor(client: MatrixClient, room: Room): Promise<string[]> {
    if (!aiAvailable()) return [];
    const to = waitingOn(room, client.getSafeUserId());
    const at = to?.getId();
    if (!at) return [];
    const had = known.get(at);
    if (had) return had;

    // Claimed before it is asked for, so two callers at once ask once.
    known.set(at, []);
    try {
        const answer = await ask(client, { kind: "replies", messages: readable(room), style: styleOf(client, room) });
        const suggested = drafts(answer.answer);
        known.set(at, suggested);
        return suggested;
    } catch (error) {
        known.delete(at);
        return [];
    }
}

/** What is already known, without asking for anything: what a second mount should show at once. */
export function repliesKnown(client: MatrixClient, room: Room): string[] {
    const at = waitingOn(room, client.getSafeUserId())?.getId();
    return at ? (known.get(at) ?? []) : [];
}

/** The chat as the model is given it. */
function readable(room: Room): AskMessage[] {
    const out: AskMessage[] = [];
    for (const event of room.getLiveTimeline().getEvents().slice(-READ_BACK)) {
        const body = text(event);
        if (!body) continue;
        out.push({
            id: event.getId()!,
            sender: event.sender?.name ?? event.getSender() ?? "?",
            body: body.slice(0, 600),
        });
    }
    return out;
}

/** How you write, in this chat: your own messages, newest last, as many as are worth sending. */
function styleOf(client: MatrixClient, room: Room): string[] {
    const me = client.getSafeUserId();
    const mine: string[] = [];
    const events = room.getLiveTimeline().getEvents();
    for (let at = events.length - 1; at >= 0 && mine.length < STYLE; at--) {
        const body = events[at].getSender() === me ? text(events[at]) : undefined;
        // Only what you typed: a line long enough to have a voice in it.
        if (body && body.length > 1) mine.push(body.slice(0, 400));
    }
    return mine.reverse();
}

/** Chosen from somewhere without a composer: left for that room's own composer to pick up. */
export function leaveDraft(roomId: string, draft: string): void {
    waitingDraft.set(roomId, draft);
}

/** Taken by the composer when it appears, once. */
export function takeDraft(roomId: string): string | undefined {
    const draft = waitingDraft.get(roomId);
    waitingDraft.delete(roomId);
    return draft;
}
