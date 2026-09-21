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

import { ask, aiAvailable } from "./ask";
import { readable } from "./readable";

/**
 * How much of the chat a draft needs.
 *
 * Twenty was the turn being replied to and little else, which is why a reply could miss what the
 * conversation had been about for the last hour. Sixty is the evening: what was arranged, what was
 * refused, what is still open. It costs about two thousand tokens against a context of two hundred and
 * sixty thousand, so the limit is not the model - it is that a draft written from last month is a draft
 * about last month.
 */
const READ_BACK = 60;
/**
 * How much of your own writing is enough to write like you - and how little is enough.
 *
 * Sixty of them, each up to four hundred characters, came to some three thousand tokens against a
 * conversation of five hundred: the drafts drifted towards the samples, which is why they read as though
 * they had not seen the chat and why they changed character between one message and the next. Twenty
 * short ones carry a voice just as well and leave the conversation the loudest thing in the request.
 */
const STYLE = 20;
const STYLE_LONGEST = 120;
/**
 * A ceiling, not a target: how many are worth offering is the model's judgement, and one good draft beats
 * three padded ones. This is the point past which a row of pills stops being a row of pills.
 */
const MOST = 6;
const LONGEST = 240;

/** Drafts already asked for, by the message they reply to: a chat re-entered costs nothing. */
const known = new Map<string, string[]>();

/**
 * And kept where a reload cannot lose them.
 *
 * Seventeen requests for ten chats in one afternoon, because the map above lives for as long as the page
 * does and a phone reloads the page all day. Room account data is private to the reader, syncs to their
 * other devices and costs nothing to read, so a chat drafted on the phone is already drafted on the
 * laptop.
 */
const KEPT = "im.mxg.ai_replies";

interface Kept {
    /** The message the drafts reply to: different message, different drafts. */
    anchor: string;
    drafts: string[];
}

function fromRoom(room: Room, anchor: string): string[] | undefined {
    const kept = room.getAccountData(KEPT as never)?.getContent<Kept>();
    return kept?.anchor === anchor ? kept.drafts : undefined;
}

/** A draft chosen somewhere the composer was not: taken by that room's composer when it appears. */
const waitingDraft = new Map<string, string>();

const text = (event: MatrixEvent): string | undefined => {
    if (event.getType() !== "m.room.message" || event.isRedacted()) return undefined;
    const body = event.getContent().body;
    return typeof body === "string" && body.trim() ? body : undefined;
};

/**
 * How long a message can go unanswered before a suggested reply is beside the point: opening a chat from
 * last month to look something up should not put three ways of answering it over the composer.
 */
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Past this many people a room is a place rather than a conversation, and most messages are not for you. */
const CROWD = 8;

/**
 * Messages that are an acknowledgement rather than something to answer.
 *
 * Not a language model's job: "ok" needs no suggestions in any language, and asking costs a request, a
 * second of waiting and a row of pills over the composer saying nothing.
 */
const NOTHING_TO_SAY =
    /^(ok(ej|ay|k)?|spoko|dobra|git|jasne|no|tak|nie|yes|yeah|yep|nope|thx|thanks|dzięki|dzieki|dzięks|haha+|hah|lol|xd+|😂|👍|❤️|\+1|k|np|nara|pa|cześć|czesc|hi|hej|siema)[.!?…]*$/i;

/**
 * The last message, if it is one worth drafting a reply to.
 *
 * Most messages are not. Somebody else's words, recent, addressed to this reader, and actually asking
 * something of them - anything else and the right number of suggestions is none: a row of pills that
 * appears over every chat you open, saying "ok" back to "ok", is worse than no feature, and each one of
 * them costs a request against the day's allowance.
 *
 * Your own last message is not one either: you are not owed a reply to yourself.
 */
export function waitingOn(room: Room, me: string): MatrixEvent | undefined {
    const events = room.getLiveTimeline().getEvents();
    for (let at = events.length - 1; at >= 0; at--) {
        const event = events[at];
        const body = text(event);
        if (!body) continue;
        if (event.getSender() === me) return undefined;
        // Anything but a plain message - a notice from a bridge, a state change dressed as one - is not
        // somebody waiting for an answer.
        if (event.getContent().msgtype !== "m.text") return undefined;
        if (Date.now() - event.getTs() > STALE_MS) return undefined;
        if (NOTHING_TO_SAY.test(body.trim())) return undefined;
        /*
         * In a crowd, only what is actually aimed at you: a question, or your own name. Otherwise every
         * busy room you glance at drafts three replies to a conversation between other people.
         */
        if (room.getJoinedMemberCount() > CROWD) {
            const mentioned =
                body.includes(room.client.getUserIdLocalpart() ?? "\0") ||
                body.includes(room.getMember(me)?.name ?? "\0");
            if (!mentioned && !body.includes("?")) return undefined;
        }
        return event;
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
    const had = known.get(at) ?? fromRoom(room, at);
    if (had) return had;

    const messages = await readable(client, room, READ_BACK);
    // Nothing said is nothing to reply to: drafting from an empty chat spends a request on a shrug.
    if (!messages.length) return [];

    // Claimed before it is asked for, so two callers at once ask once.
    known.set(at, []);
    try {
        const answer = await ask(client, { kind: "replies", messages, ...voiceOf(client, room) });
        const suggested = answer.drafts?.slice(0, MOST) ?? drafts(answer.answer);
        known.set(at, suggested);
        // `as never` the way notes.ts does it: the typed map knows only the event types upstream defines.
        void client.setRoomAccountData(room.roomId, KEPT as never, { anchor: at, drafts: suggested } as never);
        return suggested;
    } catch {
        known.delete(at);
        return [];
    }
}

/** What is already known, without asking for anything: what a second mount should show at once. */
export function repliesKnown(client: MatrixClient, room: Room): string[] {
    const at = waitingOn(room, client.getSafeUserId())?.getId();
    return at ? (known.get(at) ?? fromRoom(room, at) ?? []) : [];
}

/**
 * How you write: your own messages, newest last, from this chat and then from the others.
 *
 * This chat first, because how somebody writes to their mother is not how they write to a client - but a
 * chat you have just opened holds a screenful of somebody else's messages and often none of yours, which
 * is why the drafts almost never had a voice to copy. The rest of the rooms make up the difference.
 */
function voiceOf(client: MatrixClient, room: Room): { style: string[]; elsewhere: string[] } {
    const me = client.getSafeUserId();
    const take = (from: Room, into: string[], room_for: number): void => {
        const events = from.getLiveTimeline().getEvents();
        for (let at = events.length - 1; at >= 0 && into.length < room_for; at--) {
            const body = events[at].getSender() === me ? text(events[at]) : undefined;
            // Only what you typed: a line long enough to have a voice in it.
            // Long enough to have a voice in it, short enough not to drown the chat it is drafting for.
            if (body && body.length > 1) into.push(body.slice(0, STYLE_LONGEST));
        }
    };
    const style: string[] = [];
    take(room, style, STYLE);
    /*
     * Kept apart from this chat's own: a line the reader has used here is theirs to use again, but one
     * carried in from another conversation must never come back as a ready-made message, so the two go
     * up separately and only the second is struck out of the drafts.
     */
    const elsewhere: string[] = [];
    if (style.length < STYLE) {
        for (const other of client.getVisibleRooms()) {
            if (other.roomId === room.roomId || style.length + elsewhere.length >= STYLE) continue;
            take(other, elsewhere, STYLE - style.length);
        }
    }
    return { style: style.reverse(), elsewhere: elsewhere.reverse() };
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
