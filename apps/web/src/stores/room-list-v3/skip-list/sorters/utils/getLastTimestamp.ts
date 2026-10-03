/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    EventTimeline,
    EventType,
    M_POLL_START,
    MsgType,
    RelationType,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import { EffectiveMembership, getEffectiveMembership } from "../../../../../utils/membership";
import { rememberActivity, rememberedActivity } from "./lastActivity";

/*
 * Fork: what counts as activity in a room is somebody saying something - not everything Element can draw a
 * tile for. The unread rules count room name, topic and avatar changes too, and bridges send those whenever
 * they re-sync a chat's details, which reshuffled the list while nobody was talking.
 */
const ACTIVITY_TYPES = new Set<string>([
    EventType.RoomMessage,
    EventType.RoomMessageEncrypted,
    EventType.Sticker,
    M_POLL_START.name,
    M_POLL_START.altName,
    EventType.CallInvite,
    EventType.CallNotify,
    EventType.RTCNotification,
]);

/** Something said in the room, whoever or whatever said it: a message that is not an edit of another. */
/** Below this a bump_stamp is a position in the server's stream, not a time: 2001-09-09 in milliseconds. */
const MIN_TIMESTAMP = 1_000_000_000_000;

function isSaid(event: MatrixEvent): boolean {
    if (!ACTIVITY_TYPES.has(event.getType()) || event.isRedacted()) return false;
    // An edit changes something already said.
    return event.getRelation()?.rel_type !== RelationType.Replace;
}

function isActivity(event: MatrixEvent): boolean {
    // A notice is a bot talking, not a person.
    return isSaid(event) && event.getContent().msgtype !== MsgType.Notice;
}

function shouldCauseReorder(event: MatrixEvent): boolean {
    const type = event.getType();
    const content = event.getContent();
    const prevContent = event.getPrevContent();

    // Never ignore membership changes
    if (type === EventType.RoomMember && prevContent.membership !== content.membership) return true;

    // Ignore display name changes
    if (type === EventType.RoomMember && prevContent.displayname !== content.displayname) return false;
    // Ignore avatar changes
    if (type === EventType.RoomMember && prevContent.avatar_url !== content.avatar_url) return false;

    return true;
}

/**
 * For a given room, this function returns a timestamp that can be used for recency sorting.
 * @param r room for which the timestamp is calculated
 * @param userId mxId of the current user
 * @returns timestamp
 */
export const getLastTimestamp = (r: Room, userId: string): number => {
    const mainTimelineLastTs = ((): number => {
        const timeline = r.getLiveTimeline().getEvents();

        /*
         * Fork: MSC4186's bump_stamp only orders rooms the way the server sees them - by where the last
         * message sits in its stream, which a bridge catching up on old history moves forward too. It is a
         * floor below what the timeline says, and only when it is a time (our server sends the bumping
         * event's timestamp); a stream position cannot be set against the timestamps everything else here
         * is, and would sort every room that has one apart from every room that has not.
         */
        const bumpStamp = r.getBumpStamp();
        const bumpedAt = bumpStamp && bumpStamp >= MIN_TIMESTAMP ? bumpStamp : 0;

        // If the room hasn't been joined yet, it probably won't have a timeline to
        // parse. We'll still fall back to the timeline if this fails, but chances
        // are we'll at least have our own membership event to go off of.
        const effectiveMembership = getEffectiveMembership(r.getMyMembership());
        if (effectiveMembership !== EffectiveMembership.Join) {
            const membershipEvent = r
                .getLiveTimeline()
                .getState(EventTimeline.FORWARDS)
                ?.getStateEvents(EventType.RoomMember, userId);
            if (membershipEvent && !Array.isArray(membershipEvent)) {
                return membershipEvent.getTs();
            }
        }

        /*
         * Fork: the newest thing in the room that counts, by time rather than by position. Bridges append
         * backfilled history after what is already there, so the last counting event in the timeline can be
         * years older than one before it; taking it made the room drop down the list while a bridge caught up
         * on it, and jump back when something new arrived.
         *
         * The reader's own membership changes still count, but only in a room with no messages loaded: a
         * bridge creating a portal for an old chat joins the reader to it, and that join is not activity in
         * the chat - the messages it brings are.
         */
        let latest = 0;
        let latestNotice = 0;
        let ownMembership = 0;
        for (const ev of timeline) {
            const ts = ev.getTs();
            if (!ts) continue; // skip events that don't have timestamps (tests only?)
            if (isActivity(ev)) {
                latest = Math.max(latest, ts);
            } else if (isSaid(ev)) {
                latestNotice = Math.max(latestNotice, ts);
            } else if (ev.getSender() === userId && ev.getType() === EventType.RoomMember && shouldCauseReorder(ev)) {
                ownMembership = Math.max(ownMembership, ts);
            }
        }

        /*
         * What was seen before is a floor, not a fallback only: events older than it arriving later
         * (backfill again) must not move the room down.
         */
        const remembered = rememberedActivity(r.roomId);
        if (latest) {
            rememberActivity(r.roomId, latest);
            return Math.max(latest, remembered ?? 0, bumpedAt);
        }
        if (remembered !== undefined) return Math.max(remembered, bumpedAt);
        if (bumpedAt) return bumpedAt;
        /*
         * Nothing a person said, but something was said: a notice. It does not move a room up when it
         * arrives - that is what not counting it as activity is for - but where nothing else is known it
         * is when the room was last heard from, which the reader's own join is not. A bridge making a
         * portal for a chat whose history is one system message ("item bought") joined the reader today,
         * and the chat sorted as today's, above chats written in this morning.
         */
        if (latestNotice) return latestNotice;
        if (ownMembership) return ownMembership;

        /*
         * Fork: nothing loaded counts - only renames, bridge bookkeeping and the like. The room's last
         * activity is older than all of it, so the oldest loaded event is a guess that is always too recent:
         * a burst of ghost renames put rooms silent for years at the top. If there is history before this
         * window, how old the room is is not known, and it goes to the bottom rather than above rooms that
         * are known to be active.
         */
        if (r.getLiveTimeline().getPaginationToken(EventTimeline.BACKWARDS)) return 0;

        // The whole room is loaded and nothing in it counts (a room just created, say): its own events are
        // all there is to go by.
        return timeline[0]?.getTs() ?? 0;
    })();

    const threadLastEventTimestamps = r.getThreads().map((thread) => {
        const event = thread.replyToEvent ?? thread.rootEvent;
        return event?.getTs() ?? 0;
    });

    return Math.max(mainTimelineLastTs, ...threadLastEventTimestamps);
};
