/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Reading what is already here, in the gaps.
 *
 * A message that has been on screen has been read for dates and numbers anyway, because that is what puts
 * the chips under it (views/messages/DetectedActions.tsx). But most of what the client holds has never
 * been on screen: a chat opened once a week is a thousand messages nobody looked at twice, and the parcel
 * number in it is exactly the thing worth having in a list.
 *
 * So the rest is read too - a few messages per idle turn, newest chats first, never on the render path,
 * and each message only ever once. It is the same detection, the same results, written to the same place
 * (collected.ts); this only decides when.
 *
 * Nothing here fetches anything. It reads what has already been synced, so a chat whose history has not
 * been loaded contributes nothing until something loads it.
 */

import { type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { forget, remember, unread } from "./collected";

/**
 * Nothing without a digit in it can name a time, a number, a house, a flight or a parcel - and that is
 * most messages. The one cheap test worth doing before waking anything expensive.
 */
export const mightHold = (text: string): boolean => /\d/.test(text);

/**
 * Runs `work` when the browser is next idle, or soon, where that is not offered.
 *
 * Through the globals rather than through `window`: this is called from a component, from the sweep and
 * from a test, and a timer is a timer in all three. Reaching through `window` meant the one environment
 * without the timers hung off it failed on the cancel rather than on the call.
 */
export function whenIdle(work: () => void): () => void {
    if (typeof requestIdleCallback === "function") {
        const handle = requestIdleCallback(work, { timeout: 2000 });
        return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(work, 500);
    return () => clearTimeout(handle);
}

/**
 * How much is done per idle turn.
 *
 * Detection is a parse per message across fourteen locales plus the Polish one, so it is measured in
 * milliseconds rather than microseconds: a handful per turn keeps each turn inside the frame the browser
 * offered, and the sweep finishes in the background over a minute or two rather than in one long stall.
 */
const PER_TURN = 8;

/** How many timeline events an idle turn may inspect while looking for its next batch. */
const SCANNED_PER_TURN = 100;

/** How far back into a chat is worth reading. Past this, a list of what is coming is a list of history. */
const DEEPEST = 1000;

const textOf = (event: MatrixEvent): string | undefined => {
    if (event.getType() !== "m.room.message" || event.isRedacted()) return undefined;
    const body = event.getContent().body;
    return typeof body === "string" && mightHold(body) ? body : undefined;
};

/**
 * Starts reading, and keeps up with what arrives.
 *
 * Returns the way to stop, which matters on logout: the next account's sweep must not be walking the last
 * one's rooms.
 */
export function startCollecting(client: MatrixClient): () => void {
    const userId = client.getSafeUserId();
    let stopped = false;
    let cancelIdle: (() => void) | undefined;

    /** What is waiting to be read: the backlog once, then whatever arrives. */
    let queue: MatrixEvent[] = [];
    let rooms: Room[] | undefined;
    let roomAt = 0;
    let eventAt = -1;

    /**
     * Fills one batch from the initially loaded history without ever making a list of every loaded event.
     * A large account can hold tens of thousands of events: walking all of them in one idle callback still
     * blocks the renderer, even though the detection itself is deferred.
     */
    const fillFromHistory = (): boolean => {
        if (!rooms) {
            rooms = [...client.getVisibleRooms()].sort(
                (a, b) => (b.getLastLiveEvent()?.getTs() ?? 0) - (a.getLastLiveEvent()?.getTs() ?? 0),
            );
        }
        let scanned = 0;
        while (queue.length < PER_TURN && roomAt < rooms.length && scanned < SCANNED_PER_TURN) {
            const events = rooms[roomAt].getLiveTimeline().getEvents();
            if (eventAt < 0) eventAt = events.length - 1;
            if (eventAt < Math.max(0, events.length - DEEPEST)) {
                roomAt++;
                eventAt = -1;
                continue;
            }
            const event = events[eventAt--];
            scanned++;
            if (textOf(event)) queue.push(event);
        }
        return roomAt >= rooms.length;
    };

    const read = async (events: MatrixEvent[]): Promise<void> => {
        const texts = new Map(events.map((event) => [event.getId()!, textOf(event)!]));
        const todo = await unread(userId, [...texts.keys()]);
        if (!todo.length || stopped) return;
        const { detectEntities } = await import("./entities");
        for (const eventId of todo) {
            if (stopped) return;
            const event = events.find((one) => one.getId() === eventId);
            if (!event) continue;
            const found = await detectEntities(texts.get(eventId)!);
            // Written down either way: the empty result is what stops this message being read again.
            await remember(userId, event, found);
        }
    };

    const turn = (): void => {
        if (stopped) return;
        const complete = fillFromHistory();
        if (!queue.length) {
            if (!complete) cancelIdle = whenIdle(turn);
            return;
        }
        const batch = queue.splice(0, PER_TURN);
        void read(batch).finally(() => {
            if (!stopped && (queue.length || !complete)) cancelIdle = whenIdle(turn);
        });
    };

    const onTimeline = (event: MatrixEvent, room: Room | undefined, toStartOfTimeline?: boolean): void => {
        if (stopped || toStartOfTimeline || !room || !textOf(event)) return;
        queue.push(event);
        cancelIdle?.();
        cancelIdle = whenIdle(turn);
    };

    /** A message that is gone takes what was found in it with it. */
    const onRedaction = (event: MatrixEvent): void => {
        const target = event.getAssociatedId();
        if (target) void forget(userId, target);
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.Redaction, onRedaction);
    cancelIdle = whenIdle(turn);

    return () => {
        stopped = true;
        cancelIdle?.();
        client.off(RoomEvent.Timeline, onTimeline);
        client.off(RoomEvent.Redaction, onRedaction);
    };
}
