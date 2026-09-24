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
}

/** How far back into each chat is worth reading: the recent end, which is what a call list is. */
const DEEPEST = 500;

/** Whether this event is a call starting, in either of the two shapes calls take here. */
function startsCall(event: MatrixEvent): boolean {
    // The bridge's own marker rather than its words: "Incoming call" is only English.
    return event.getType() === EventType.CallInvite || getActionMessage(event)?.type === "call";
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

        const answered = !!answer;
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
            outcome: outcomeOf(hangup, answered),
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
