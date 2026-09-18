/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type MatrixEvent, MatrixEventEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

/** Sent by bridges into the room to report whether they delivered one of our events to the remote network. */
export const MESSAGE_SEND_STATUS_EVENT_TYPE = "com.beeper.message_send_status";
/** Content key on a message that re-sends one that failed. */
export const MESSAGE_SEND_RETRY_KEY = "com.beeper.message_send_retry";

export type MessageSendStatusValue = "SUCCESS" | "PENDING" | "FAIL_RETRIABLE" | "FAIL_PERMANENT";

/** Content of com.beeper.message_send_status (mautrix-go event.BeeperMessageStatusEventContent). */
export interface MessageSendStatus {
    status: MessageSendStatusValue;
    /** Machine-readable reason, e.g. m.foreign_network_error, com.beeper.unsupported_event. */
    reason?: string;
    /** Human-readable explanation meant for the UI. */
    message?: string;
    network?: string;
    /** If set, the users the message has been delivered to on the remote network. */
    delivered_to_users?: string[];
    /** Timestamp of the status event, used to keep only the latest one. */
    ts: number;
}

const STATUSES: MessageSendStatusValue[] = ["SUCCESS", "PENDING", "FAIL_RETRIABLE", "FAIL_PERMANENT"];

/** Extracts (target event id, status) from a message send status event, or undefined if it isn't one. */
export function parseMessageSendStatus(ev: MatrixEvent): [string, MessageSendStatus] | undefined {
    if (ev.getType() !== MESSAGE_SEND_STATUS_EVENT_TYPE) return undefined;
    const content = ev.getContent();
    const target = content["m.relates_to"]?.event_id;
    if (typeof target !== "string" || !STATUSES.includes(content.status)) return undefined;
    const status: MessageSendStatus = { status: content.status, ts: ev.getTs() };
    if (typeof content.reason === "string") status.reason = content.reason;
    if (typeof content.message === "string" && content.message) status.message = content.message;
    if (typeof content.network === "string" && content.network) status.network = content.network;
    if (Array.isArray(content.delivered_to_users)) {
        status.delivered_to_users = content.delivered_to_users.filter((u: unknown) => typeof u === "string");
    }
    return [target, status];
}

type Listener = () => void;

/**
 * Collects message send status events for one client. Status events are hidden from the timeline,
 * so tiles look their status up here, keyed by the event id the status refers to.
 */
export class MessageSendStatusStore {
    private static readonly instances = new WeakMap<MatrixClient, MessageSendStatusStore>();

    public static forClient(client: MatrixClient): MessageSendStatusStore {
        let store = this.instances.get(client);
        if (!store) {
            store = new MessageSendStatusStore(client);
            this.instances.set(client, store);
        }
        return store;
    }

    private readonly statuses = new Map<string, MessageSendStatus>();
    private readonly scannedRooms = new Set<string>();
    private readonly listeners = new Map<string, Set<Listener>>();

    private constructor(private readonly client: MatrixClient) {
        client.on(RoomEvent.Timeline, this.onEvent);
        client.on(MatrixEventEvent.Decrypted, this.onEvent);
    }

    private readonly onEvent = (ev: MatrixEvent): void => {
        this.record(ev);
    };

    private record(ev: MatrixEvent): void {
        const parsed = parseMessageSendStatus(ev);
        if (!parsed) return;
        const [target, status] = parsed;
        const existing = this.statuses.get(target);
        if (existing && existing.ts > status.ts) return;
        this.statuses.set(target, status);
        this.listeners.get(target)?.forEach((l) => l());
    }

    /** Picks up status events that arrived before anyone asked about this room. */
    private scanRoom(room: Room): void {
        if (this.scannedRooms.has(room.roomId)) return;
        this.scannedRooms.add(room.roomId);
        for (const ev of room.getLiveTimeline().getEvents()) this.record(ev);
    }

    public get(eventId: string, roomId?: string): MessageSendStatus | undefined {
        const room = roomId ? this.client.getRoom(roomId) : null;
        if (room) this.scanRoom(room);
        return this.statuses.get(eventId);
    }

    public subscribe(eventId: string, listener: Listener): () => void {
        let set = this.listeners.get(eventId);
        if (!set) {
            set = new Set();
            this.listeners.set(eventId, set);
        }
        set.add(listener);
        return () => {
            set.delete(listener);
            if (set.size === 0) this.listeners.delete(eventId);
        };
    }
}

/**
 * Re-sends a message the bridge failed to deliver, tagged with com.beeper.message_send_retry so the
 * bridge can correlate it with the original.
 */
export async function retryFailedMessage(client: MatrixClient, mxEvent: MatrixEvent): Promise<void> {
    const roomId = mxEvent.getRoomId();
    const eventId = mxEvent.getId();
    if (!roomId || !eventId) return;
    const content = { ...mxEvent.getOriginalContent() };
    const previous = content[MESSAGE_SEND_RETRY_KEY];
    const originalEventId = typeof previous?.original_event_id === "string" ? previous.original_event_id : eventId;
    const retryCount = typeof previous?.retry_count === "number" ? previous.retry_count + 1 : 1;
    content[MESSAGE_SEND_RETRY_KEY] = { original_event_id: originalEventId, retry_count: retryCount };
    await client.sendEvent(roomId, mxEvent.getType() as any, content);
}
