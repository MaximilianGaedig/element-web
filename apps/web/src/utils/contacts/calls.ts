/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Every call, in one list.
 *
 * A call leaves a trace in the chat it happened in - an invite and a hangup, or the notice a bridge writes
 * when a network tells it a call happened - and that is the only place it can be seen. So "who rang while I
 * was out?" means opening chats until one of them has a missed call in it, which is exactly the question a
 * call list answers in one screen.
 *
 * Built from what the client already holds, in the order the events happened, so it costs a walk of loaded
 * timelines and nothing else: no index, no request, nothing to keep in step. A chat whose history is not
 * loaded contributes what is loaded of it, which is the recent end - which is the end a call list is about.
 *
 * Both shapes of call are read, because both exist here: a Matrix call (`m.call.invite` and friends, what
 * Element and the bridges' own call bridging use) and a bridge's notice about a call on the network, which
 * carries a structured marker rather than only words (see BeeperActionMessage in actionMessage.ts) - a notice
 * matched by its text would break in every language.
 */

import { type MatrixClient, type MatrixEvent, type Room, EventType } from "matrix-js-sdk/src/matrix";

import { getBridgeInfo } from "../bridge/bridgeInfo";
import { getActionMessage } from "../bridge/actionMessage";

/** How the call ended, as far as the timeline can say. */
export type CallOutcome = "answered" | "missed" | "declined" | "unknown";

/** One call, as it can be read back from the chat it happened in. */
export interface Call {
    /** The event the call started with: where to jump to, and what makes this call unique. */
    eventId: string;
    roomId: string;
    /** The other side, or the caller in a group. */
    userId: string;
    /** Their name at the time, which is the name the reader will recognise. */
    name: string;
    avatarUrl?: string;
    /** The network it happened on, or "Matrix" for a call that was never bridged. */
    network: string;
    ts: number;
    /** Whether the reader made the call. */
    outgoing: boolean;
    video: boolean;
    outcome: CallOutcome;
    /** How long it lasted, when the timeline says enough to know. */
    seconds?: number;
    /**
     * Whether this was a call in a group rather than with one person.
     *
     * A group call is not "a call from whoever started it": the reader looking for it is looking for the
     * group, so the row says the room and keeps the starter as the person underneath it. Element's own
     * calls are MatrixRTC sessions, which leave an `org.matrix.msc4075.rtc.notification` in the timeline
     * where a one-to-one call leaves an `m.call.invite`, so both are read and only the room says which
     * kind it was.
     */
    group: boolean;
    /** What to put on the row: the group's name for a group call, the person's for a call with one. */
    title: string;
}

/** How far back into each chat is worth reading: the recent end, which is what a call list is. */
const DEEPEST = 500;

/** Whether this event is a call starting, in any of the three shapes calls take here. */
function startsCall(event: MatrixEvent): boolean {
    // The bridge's own marker rather than its words: "Incoming call" is only English.
    return (
        event.getType() === EventType.CallInvite ||
        event.getType() === EventType.RTCNotification ||
        getActionMessage(event)?.type === "call"
    );
}

/** What a hangup says about how the call went. */
function outcomeOf(hangup: MatrixEvent | undefined, answered: boolean): CallOutcome {
    if (answered) return "answered";
    if (!hangup) return "unknown";
    const reason = hangup.getContent().reason;
    if (reason === "invite_timeout" || reason === "user_busy") return "missed";
    if (hangup.getType() === EventType.CallReject || reason === "user_hangup") return "declined";
    return "unknown";
}

/** The calls in one chat, newest first. */
function callsIn(client: MatrixClient, room: Room): Call[] {
    const events = room.getLiveTimeline().getEvents();
    const from = Math.max(0, events.length - DEEPEST);
    const me = client.getSafeUserId();
    const network = getBridgeInfo(room)?.networkName ?? "Matrix";
    /*
     * Whether this room is a group, decided once for the room rather than per call: a call's own events
     * do not say how many people the room has, and the answer cannot change between two calls in it.
     */
    const group = room.getJoinedMemberCount() + room.getInvitedMemberCount() > 2;
    const calls: Call[] = [];

    for (let at = events.length - 1; at >= from; at--) {
        const event = events[at];
        if (!startsCall(event) || event.isRedacted()) continue;
        const userId = event.getSender() ?? "";
        const member = room.getMember(userId);
        const callId = event.getContent().call_id;

        /*
         * The rest of the call is whatever follows the invite, so it is read forwards from here: an answer
         * makes it answered, a hangup says how it ended, and their timestamps are the only source for how
         * long it lasted. Matched on call_id where there is one, so two calls close together do not merge.
         */
        let answer: MatrixEvent | undefined;
        let hangup: MatrixEvent | undefined;
        for (let then = at + 1; then < events.length; then++) {
            const later = events[then];
            const type = later.getType();
            if (callId && later.getContent().call_id && later.getContent().call_id !== callId) continue;
            if (type === EventType.CallAnswer) answer ??= later;
            if (type === EventType.CallHangup || type === EventType.CallReject) {
                hangup = later;
                break;
            }
            // Another call starting ends what can be said about this one.
            if (startsCall(later)) break;
        }

        /*
         * A group call is joined rather than answered, and declined out loud: MatrixRTC records the
         * reader's own membership when they join and an `rtc.decline` when they turn it down, so those
         * are what "answered" and "declined" mean for one.
         */
        let declined = false;
        let joined = false;
        if (event.getType() === EventType.RTCNotification) {
            for (let then = at + 1; then < events.length; then++) {
                const later = events[then];
                if (startsCall(later)) break;
                if (later.getSender() !== me) continue;
                if (later.getType() === EventType.RTCDecline) declined = true;
                if (later.getType() === EventType.RTCMembership) joined = true;
            }
        }

        const answered = !!answer || joined;
        calls.push({
            eventId: event.getId()!,
            roomId: room.roomId,
            userId,
            name: member?.rawDisplayName ?? userId,
            avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
            network,
            ts: event.getTs(),
            outgoing: userId === me,
            video:
                !!event.getContent().offer?.sdp?.includes("m=video") || getActionMessage(event)?.call_type === "video",
            outcome: declined ? "declined" : outcomeOf(hangup, answered),
            group,
            title: group ? room.name : (member?.rawDisplayName ?? userId),
            seconds: answer && hangup ? Math.max(0, Math.round((hangup.getTs() - answer.getTs()) / 1000)) : undefined,
        });
    }
    return calls;
}

/** Every call the client can see, newest first. */
export function callHistory(client: MatrixClient, { limit = 200 }: { limit?: number } = {}): Call[] {
    return client
        .getVisibleRooms()
        .flatMap((room) => callsIn(client, room))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
}

/** The calls nobody answered, which is the list people actually open a call list for. */
export const missedCalls = (calls: Call[]): Call[] =>
    calls.filter((call) => !call.outgoing && call.outcome === "missed");

/**
 * Calls from somebody no address book holds.
 *
 * "Not in your contacts" is a question about the contact list, so it is asked there: `saved` on a Person is
 * true only when a network's own contact list named them, which is a published fact rather than a guess from
 * whether a chat happens to exist. Everyone else - a chat with a stranger, a Matrix ID nobody saved - is
 * unknown, which is the same line a phone draws and for the same reason.
 *
 * Outgoing calls are left out: the reader knows who they rang.
 */
export const unknownCallers = (calls: Call[], saved: ReadonlySet<string>): Call[] =>
    calls.filter((call) => !call.outgoing && !saved.has(call.userId));

/**
 * The calls on one day, or in one hour when the search said a time as well.
 *
 * "Yesterday" and "last Tuesday" are how people look for a call they half remember, and a list that can
 * only be searched by name cannot answer either. The date comes from the same detector the composer uses
 * to spot dates in messages (utils/detect/entities.ts), so the words it understands are the same words.
 */
export function callsWhen(calls: readonly Call[], when: Date, hasTime: boolean): Call[] {
    const from = new Date(when);
    const to = new Date(when);
    if (hasTime) {
        from.setMinutes(0, 0, 0);
        to.setMinutes(59, 59, 999);
    } else {
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
    }
    return calls.filter((call) => call.ts >= from.getTime() && call.ts <= to.getTime());
}
