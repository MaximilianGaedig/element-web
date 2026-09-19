/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Keeps the local message database (db.ts) up to date: every message Element sees, from the live sync,
 * from scrollback, or from the backfill, is written once. Encrypted messages are written as they came
 * from the server and classified again once they decrypt.
 */

import {
    type IRoomEvent,
    type MatrixClient,
    type MatrixEvent,
    MatrixEventEvent,
    type Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";

import { sharedMediaTab } from "../sharedMedia";
import { forgetEvents, storeEvents, type StoredEvent } from "./db";

/** Messages are written in batches, so a burst of sync or a backfill page is one write. */
const FLUSH_MS = 1000;

export function storedEventFor(event: MatrixEvent): StoredEvent | undefined {
    const eventId = event.getId();
    const roomId = event.getRoomId();
    if (!eventId || !roomId || eventId.startsWith("~")) return undefined; // not a local echo
    return {
        eventId,
        roomId,
        ts: event.getTs(),
        tab: sharedMediaTab(event),
        // The wire event: an encrypted room's messages stay encrypted in the database.
        raw: event.event as IRoomEvent,
    };
}

class HistoryIndexer {
    private client?: MatrixClient;
    private pending = new Map<string, StoredEvent>();
    private removed: string[] = [];
    private timer?: ReturnType<typeof setTimeout>;

    public start(client: MatrixClient): void {
        if (this.client) return;
        this.client = client;
        client.on(RoomEvent.Timeline, this.onTimeline);
        client.on(MatrixEventEvent.Decrypted, this.onDecrypted);
        client.on(RoomEvent.Redaction, this.onRedaction);
    }

    public stop(): void {
        this.client?.off(RoomEvent.Timeline, this.onTimeline);
        this.client?.off(MatrixEventEvent.Decrypted, this.onDecrypted);
        this.client?.off(RoomEvent.Redaction, this.onRedaction);
        this.client = undefined;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.pending.clear();
    }

    /** Writes these messages, e.g. a page the backfill just fetched. */
    public add(events: MatrixEvent[]): void {
        for (const event of events) this.queue(event);
    }

    private onTimeline = (event: MatrixEvent, _room: Room | undefined, _toStart?: boolean, removed?: boolean): void => {
        if (removed) {
            const id = event.getId();
            if (id) this.removed.push(id);
            this.schedule();
            return;
        }
        this.queue(event);
    };

    private onDecrypted = (event: MatrixEvent): void => this.queue(event);

    private onRedaction = (event: MatrixEvent): void => {
        const target = event.event.redacts;
        if (target) this.removed.push(target);
        this.schedule();
    };

    private queue(event: MatrixEvent): void {
        const stored = storedEventFor(event);
        if (!stored) return;
        this.pending.set(stored.eventId, stored);
        this.schedule();
    }

    private schedule(): void {
        this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
    }

    private async flush(): Promise<void> {
        this.timer = undefined;
        const events = [...this.pending.values()];
        const removed = this.removed;
        this.pending.clear();
        this.removed = [];
        await storeEvents(events);
        await forgetEvents(removed);
    }
}

export const historyIndexer = new HistoryIndexer();
