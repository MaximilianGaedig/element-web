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
 * Shown at once from what the client already holds, in the order the events happened - a walk of loaded
 * timelines, which reaches back only as far as each chat is loaded. Where the homeserver indexes calls
 * (tuwunel's media index, kind `calls`), the whole history then comes from there in one request
 * (`indexedCallHistory`), with what the loaded timelines know about each call kept.
 *
 * A group call is one entry per call, not per person who joined it: Element Call writes a notification and
 * a membership for every member who joins, so reading each as a call listed one call a dozen times. Those
 * events are grouped into sessions (see `sessionsIn`) and each session is one entry that knows who took part,
 * when it ended and whether it is still going.
 *
 * Both shapes of call are read, because both exist here: a Matrix call (`m.call.invite` and friends, what
 * Element and the bridges' own call bridging use) and a bridge's notice about a call on the network, which
 * carries a structured marker rather than only words (see BeeperActionMessage in actionMessage.ts) - a notice
 * matched by its text would break in every language.
 */

import {
    type IRoomEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    EventType,
    Method,
} from "matrix-js-sdk/src/matrix";

import { getBridgeBots, getBridgeInfo } from "../bridge/bridgeInfo";
import { isOneToOneRoom } from "../telegram/telegramLayout";
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
    /** When the last person left, for a MatrixRTC call whose events say so. Never set while it is ongoing. */
    endTs?: number;
    /** Whether somebody is still in it, so the row can offer to join rather than to call back. */
    ongoing?: boolean;
    /** Whether the reader took part, which is what separates a call they were in from one they heard about. */
    joined?: boolean;
    /** Everyone who took part, in the order they first showed up; only MatrixRTC calls say. */
    participants?: CallParticipant[];
}

/** One person in a call. */
export interface CallParticipant {
    userId: string;
    name: string;
    avatarUrl?: string;
    /** Whether this is the reader, who is said as "you" rather than by name. */
    you: boolean;
}

/** How far back into each chat is worth reading: the recent end, which is what a call list is. */
const DEEPEST = 500;

/**
 * Whether this event is a call starting, in either of the shapes a call is read one event at a time.
 * MatrixRTC calls are not here: one of their events says a person joined, not that a call began (see
 * `isRtcEvent`).
 */
function startsCall(event: MatrixEvent): boolean {
    // The bridge's own marker rather than its words: "Incoming call" is only English.
    return event.getType() === EventType.CallInvite || getActionMessage(event)?.type === "call";
}

/** The events a MatrixRTC call is made of: its ring, and each member's joining, refreshing and leaving. */
function isRtcEvent(event: MatrixEvent): boolean {
    const type = event.getType();
    return (
        type === EventType.RTCNotification ||
        type === EventType.RTCMembership ||
        type === EventType.GroupCallMemberPrefix ||
        type === EventType.RTCDecline
    );
}

/** How close a call event has to be to a bridge's line about a call for the two to be one call. */
const SAME_CALL_MS = 2 * 60 * 1000;

/** Whether a real call event (not a bridge's line) starts within SAME_CALL_MS of the event at `at`. */
function hasCallEventNear(events: readonly MatrixEvent[], at: number): boolean {
    const ts = events[at].getTs();
    for (const step of [-1, 1]) {
        for (let i = at + step; i >= 0 && i < events.length; i += step) {
            const other = events[i];
            if (Math.abs(other.getTs() - ts) > SAME_CALL_MS) break;
            if ((startsCall(other) || isRtcEvent(other)) && !getActionMessage(other)) return true;
        }
    }
    return false;
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

/** What about a room is the same for every call in it. */
interface RoomContext {
    me: string;
    network: string;
    /*
     * Whether this room is a group, decided once for the room rather than per call: a call's own events
     * do not say how many people the room has, and the answer cannot change between two calls in it.
     * Asked the bridge-aware way: a bridged DM holds the bridge's bot too, and counting members made
     * every call in one a "group call".
     */
    group: boolean;
    bots: Set<string>;
}

function roomContext(client: MatrixClient, room: Room): RoomContext {
    return {
        me: client.getSafeUserId(),
        network: getBridgeInfo(room)?.networkName ?? "Matrix",
        group: !isOneToOneRoom(room),
        bots: getBridgeBots(room),
    };
}

/** The call starting at `events[at]`, read from it and what follows it in `events`. */
function readCall(room: Room, events: readonly MatrixEvent[], at: number, ctx: RoomContext): Call {
    const { me, network, group, bots } = ctx;
    const event = events[at];
    const fromBot = bots.has(event.getSender() ?? "");
    const userId = event.getSender() ?? "";
    const member = fromBot ? null : room.getMember(userId);
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
    return {
        eventId: event.getId()!,
        roomId: room.roomId,
        userId,
        name: fromBot ? room.name : (member?.rawDisplayName ?? userId),
        avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
        network,
        ts: event.getTs(),
        outgoing: userId === me,
        video: !!event.getContent().offer?.sdp?.includes("m=video") || getActionMessage(event)?.call_type === "video",
        outcome: outcomeOf(hangup, answered),
        group,
        // A line the bridge had to send as its bot names nobody: the chat is who it was with.
        title: group || fromBot ? room.name : (member?.rawDisplayName ?? userId),
        seconds: answer && hangup ? Math.max(0, Math.round((hangup.getTs() - answer.getTs()) / 1000)) : undefined,
        joined: answered,
    };
}

/**
 * How long a room has to stay empty for the next join to be a different call.
 *
 * A call ends when the last person leaves, but people drop and rejoin: a flaky connection, a switched
 * device, the one who left to fetch someone. Those are the same call, so a join this soon after the room
 * emptied continues it. Longer than that, somebody is starting something new.
 */
export const SESSION_GAP_MS = 15 * 60 * 1000;

/**
 * How long a membership counts when its own event does not say, and so how long a call can look ongoing
 * after a client died without writing its leave. Clients refresh a membership well inside this.
 */
const MEMBERSHIP_LIFETIME_MS = 4 * 60 * 60 * 1000;

/** Whether a membership event is somebody being in the call, as opposed to the empty content that leaves it. */
function isJoin(event: MatrixEvent): boolean {
    const content = event.getContent();
    if (Array.isArray(content.memberships)) return content.memberships.length > 0;
    return Object.keys(content).length > 0;
}

/** A group of RTC events that is one call. */
interface Session {
    first: MatrixEvent;
    /** Who is in it right now, by membership (one per device), and until when that membership is good. */
    present: Map<string, number>;
    /** Who took part, by user, in the order they first appeared. */
    participants: Map<string, true>;
    lastActivity: number;
    /** Whether anybody other than the reader rang the reader, by notification. */
    rang: boolean;
    joined: boolean;
    declined: boolean;
    video: boolean;
}

/**
 * The MatrixRTC calls in one room, oldest first, from its events oldest first.
 *
 * One call is one run of events in the room, ended by the room being empty - everyone's membership left
 * or lapsed - for longer than SESSION_GAP_MS. A notification, a join, a refresh and a leave all belong to
 * the run they fall in; a notification with no memberships at all (a ring nobody joined, or a room whose
 * membership events were not loaded) is a run of its own that ends SESSION_GAP_MS after its last event.
 */
function sessionsIn(room: Room, events: readonly MatrixEvent[], ctx: RoomContext, now: number): Call[] {
    const calls: Call[] = [];
    let cur: Session | undefined;

    /** Drops the memberships that ran out by `t`: nobody wrote their leave, so they left when they expired. */
    const lapse = (s: Session, t: number): void => {
        for (const [key, until] of s.present) {
            if (until > t) continue;
            s.present.delete(key);
            s.lastActivity = Math.max(s.lastActivity, until);
        }
    };
    const close = (s: Session, ongoing: boolean): void => {
        calls.push(toCall(room, s, ctx, ongoing));
    };

    for (const event of events) {
        if (event.isRedacted()) continue;
        const t = event.getTs();
        if (cur) {
            lapse(cur, t);
            if (cur.present.size === 0 && t - cur.lastActivity > SESSION_GAP_MS) {
                close(cur, false);
                cur = undefined;
            }
        }
        const type = event.getType();
        // A decline answers a ring; with no call for it to answer it is not the start of one.
        if (!cur && type === EventType.RTCDecline) continue;
        cur ??= {
            first: event,
            present: new Map(),
            participants: new Map(),
            lastActivity: t,
            rang: false,
            joined: false,
            declined: false,
            video: false,
        };
        const sender = event.getSender() ?? "";
        const content = event.getContent();
        if (content["m.call.intent"] === "video") cur.video = true;

        if (type === EventType.RTCDecline) {
            if (sender === ctx.me) cur.declined = true;
            continue;
        }
        cur.lastActivity = Math.max(cur.lastActivity, t);
        cur.participants.set(sender, true);
        if (type === EventType.RTCNotification) {
            const mentions = content["m.mentions"];
            const toMe = !mentions || mentions.room || mentions.user_ids?.includes(ctx.me);
            if (sender !== ctx.me && toMe) cur.rang = true;
            continue;
        }
        // A membership: state_key is per device, so one person on two devices is two memberships but one participant.
        const key = event.getStateKey() ?? sender;
        if (isJoin(event)) {
            const expires = typeof content.expires === "number" ? content.expires : MEMBERSHIP_LIFETIME_MS;
            cur.present.set(key, t + expires);
            if (sender === ctx.me) cur.joined = true;
        } else {
            cur.present.delete(key);
        }
    }
    if (cur) {
        lapse(cur, now);
        close(cur, cur.present.size > 0);
    }
    return calls;
}

function toCall(room: Room, s: Session, ctx: RoomContext, ongoing: boolean): Call {
    const { me, network, group, bots } = ctx;
    const event = s.first;
    const userId = event.getSender() ?? "";
    const fromBot = bots.has(userId);
    const starter = fromBot ? null : room.getMember(userId);
    const outgoing = userId === me;
    const end = ongoing ? undefined : s.lastActivity;
    const start = event.getTs();

    const participants: CallParticipant[] = [...s.participants.keys()]
        .filter((id) => !bots.has(id))
        .map((id) => {
            const member = room.getMember(id);
            return {
                userId: id,
                name: member?.rawDisplayName ?? id,
                avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
                you: id === me,
            };
        });

    // Missed is "it rang and I was not in it": a call in a big room nobody rang me for is just one that happened.
    let outcome: CallOutcome = "unknown";
    if (s.declined) outcome = "declined";
    else if (s.joined) outcome = "answered";
    else if (!ongoing && s.rang) outcome = "missed";

    return {
        eventId: event.getId()!,
        roomId: room.roomId,
        userId,
        name: fromBot ? room.name : (starter?.rawDisplayName ?? userId),
        avatarUrl: starter?.getMxcAvatarUrl() ?? undefined,
        network,
        ts: start,
        outgoing,
        video: s.video,
        outcome,
        group,
        title: group || fromBot ? room.name : (starter?.rawDisplayName ?? userId),
        // Nothing is known of how long it ran from a single event: the start is also the end.
        seconds: end !== undefined && end > start ? Math.round((end - start) / 1000) : undefined,
        endTs: end,
        ongoing,
        joined: s.joined,
        participants,
    };
}

/** The calls in one chat, newest first. */
function callsIn(client: MatrixClient, room: Room): Call[] {
    const events = room.getLiveTimeline().getEvents();
    const from = Math.max(0, events.length - DEEPEST);
    const ctx = roomContext(client, room);
    const calls: Call[] = sessionsIn(room, events.slice(from).filter(isRtcEvent), ctx, Date.now());

    for (let at = events.length - 1; at >= from; at--) {
        const event = events[at];
        if (!startsCall(event) || event.isRedacted()) continue;
        /*
         * The bridge's line about a call it also bridged as a real call (Element Call's ring, a legacy
         * invite) is the same call told twice: the call event, which knows who and how, is the one kept.
         */
        if (getActionMessage(event) && hasCallEventNear(events, at)) continue;
        calls.push(readCall(room, events, at, ctx));
    }
    return calls.sort((a, b) => b.ts - a.ts);
}

/** Every call the client can see, newest first. */
export function callHistory(client: MatrixClient, { limit = 200 }: { limit?: number } = {}): Call[] {
    return client
        .getVisibleRooms()
        .flatMap((room) => callsIn(client, room))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
}

const MEDIA_INDEX_FEATURE = "im.mxg.media_index";
const MEDIA_INDEX_PREFIX = "/_matrix/client/unstable/im.mxg.media_index";

/**
 * Every call, from the homeserver's index (tuwunel's media index, kind `calls`) rather than from the loaded
 * timelines, which reach back only a few hundred events per room and not at all into rooms not opened
 * yet. One request, whatever the history behind it; undefined where the server keeps no such index.
 *
 * A call whose events are loaded here is read as `callHistory` reads it - answered or missed, how long -
 * and one that is not is still listed, with what its own event says.
 */
export async function indexedCallHistory(
    client: MatrixClient,
    { limit = 200 }: { limit?: number } = {},
): Promise<Call[] | undefined> {
    try {
        if (!(await client.doesServerSupportUnstableFeature(MEDIA_INDEX_FEATURE))) return undefined;
        const res = await client.http.authedRequest<{ chunk: IRoomEvent[]; rooms: string[] }>(
            Method.Get,
            "/media",
            { kind: "calls", limit: String(limit) },
            undefined,
            { prefix: MEDIA_INDEX_PREFIX },
        );
        const loaded = new Map(callHistory(client, { limit: Number.MAX_SAFE_INTEGER }).map((c) => [c.eventId, c]));
        const mapper = client.getEventMapper();
        const byRoom = new Map<string, MatrixEvent[]>();
        res.chunk.forEach((raw, i) => {
            const roomId = res.rooms[i];
            if (!roomId) return;
            const list = byRoom.get(roomId) ?? [];
            list.push(mapper({ ...raw, room_id: roomId }));
            byRoom.set(roomId, list);
        });
        const calls: Call[] = [];
        for (const [roomId, found] of byRoom) {
            const room = client.getRoom(roomId);
            if (!room) continue;
            // Oldest first, as a timeline is, so a bridge's line can be matched to the call beside it.
            const events = [...found].sort((a, b) => a.getTs() - b.getTs());
            const ctx = roomContext(client, room);
            const covered = (event: MatrixEvent): boolean =>
                [...loaded.values()].some(
                    (call) =>
                        call.roomId === roomId &&
                        call.participants &&
                        event.getTs() >= call.ts - SESSION_GAP_MS &&
                        event.getTs() <= (call.endTs ?? Date.now()) + SESSION_GAP_MS,
                );
            // The index lists a call's events one by one, so they are grouped as a timeline's are - except
            // those a loaded call already accounts for, which would otherwise come back as a second entry.
            calls.push(
                ...sessionsIn(
                    room,
                    events.filter((event) => isRtcEvent(event) && !covered(event)),
                    ctx,
                    Date.now(),
                ),
            );
            events.forEach((event, at) => {
                if (isRtcEvent(event)) return;
                if (event.isRedacted() || (getActionMessage(event) && hasCallEventNear(events, at))) return;
                calls.push(loaded.get(event.getId()!) ?? readCall(room, [event], 0, ctx));
            });
        }
        // Loaded group calls come with the index's: the index only knows the events it was asked about.
        const seen = new Set(calls.map((c) => c.eventId));
        for (const call of loaded.values()) if (call.participants && !seen.has(call.eventId)) calls.push(call);
        return calls.sort((a, b) => b.ts - a.ts).slice(0, limit);
    } catch {
        return undefined;
    }
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
