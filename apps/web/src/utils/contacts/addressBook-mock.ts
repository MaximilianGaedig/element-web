/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A homeserver in memory, for the address book's tests: global account data, rooms with a timeline of state
 * events, /state, /messages, redactions and uploads - and the auth rule that refuses a state key naming
 * another user, which the real server applies and an unprefixed Matrix ID would trip.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

export interface FakeEvent {
    event_id: string;
    type: string;
    state_key?: string;
    content: Record<string, unknown>;
    origin_server_ts: number;
    sender: string;
}

export interface FakeServer {
    client: MatrixClient;
    account: Map<string, unknown>;
    rooms: Map<string, FakeEvent[]>;
    media: Map<string, Blob>;
    /** Changes what the next state event sent with this key says, as a server bug would. */
    corrupt: (stateKey: string) => void;
    /** Refuses writes to a room, as the server does once the reader has left it. */
    forbid: (roomId: string) => void;
}

export function fakeBookServer(userId = "@me:e"): FakeServer {
    const account = new Map<string, unknown>();
    const rooms = new Map<string, FakeEvent[]>();
    const media = new Map<string, Blob>();
    const corrupted = new Set<string>();
    const forbidden = new Set<string>();
    let serial = 0;
    const event = (type: string, content: Record<string, unknown>, stateKey?: string): FakeEvent => ({
        event_id: `$${++serial}`,
        type,
        ...(stateKey === undefined ? {} : { state_key: stateKey }),
        content,
        origin_server_ts: 1_000_000 + serial,
        sender: userId,
    });
    const timelineOf = (roomId: string): FakeEvent[] => {
        const timeline = rooms.get(roomId);
        if (!timeline) throw Object.assign(new Error("no such room"), { errcode: "M_NOT_FOUND", httpStatus: 404 });
        return timeline;
    };
    const currentState = (roomId: string): FakeEvent[] => {
        const latest = new Map<string, FakeEvent>();
        for (const one of timelineOf(roomId)) {
            if (one.state_key !== undefined) latest.set(`${one.type}\u0000${one.state_key}`, one);
        }
        return [...latest.values()];
    };

    const client = {
        getSafeUserId: () => userId,
        getUserId: () => userId,
        isInitialSyncComplete: () => true,
        getAccountData: (type: string) =>
            account.has(type) ? { getType: () => type, getContent: () => account.get(type) } : undefined,
        setAccountData: async (type: string, content: unknown) => {
            account.set(type, content);
            return {};
        },
        setAccountDataRaw: async (type: string, content: unknown) => {
            account.set(type, content);
            return {};
        },
        createRoom: async (options: { creation_content?: { type?: string }; name?: string }) => {
            const roomId = `!book${++serial}:e`;
            rooms.set(roomId, [
                event("m.room.create", { type: options.creation_content?.type, room_version: "12" }, ""),
                event("m.room.member", { membership: "join" }, userId),
            ]);
            return { room_id: roomId };
        },
        setRoomTag: async () => ({}),
        sendStateEvent: async (roomId: string, type: string, content: Record<string, unknown>, stateKey = "") => {
            if (forbidden.has(roomId)) {
                throw Object.assign(new Error("not in the room"), { errcode: "M_FORBIDDEN", httpStatus: 403 });
            }
            if (stateKey.startsWith("@") && stateKey !== userId) {
                throw Object.assign(new Error("state_key matches another user's ID"), {
                    errcode: "M_FORBIDDEN",
                    httpStatus: 403,
                });
            }
            const sent = corrupted.delete(stateKey) ? { ...content, card: { firstName: "corrupted" } } : content;
            const one = event(type, structuredClone(sent), stateKey);
            timelineOf(roomId).push(one);
            return { event_id: one.event_id };
        },
        roomState: async (roomId: string) => structuredClone(currentState(roomId)),
        uploadContent: async (file: Blob) => {
            const url = `mxc://e/media${++serial}`;
            media.set(url, file);
            return { content_uri: url };
        },
        http: {
            authedRequest: async (method: string, path: string, query?: Record<string, string>) => {
                const messages = /^\/rooms\/([^/]+)\/messages$/.exec(path);
                if (messages && method === "GET") {
                    const roomId = decodeURIComponent(messages[1]);
                    const types: string[] | undefined = query?.filter ? JSON.parse(query.filter).types : undefined;
                    const all = timelineOf(roomId)
                        .filter((one) => !types || types.includes(one.type))
                        .reverse();
                    // Two pages, so the reader has to follow `end`.
                    const from = query?.from ? Number(query.from) : 0;
                    const limit = Math.min(Number(query?.limit ?? 10), 3);
                    const chunk = structuredClone(all.slice(from, from + limit));
                    return { chunk, ...(from + limit < all.length ? { end: String(from + limit) } : {}) };
                }
                const redact = /^\/rooms\/([^/]+)\/redact\/([^/]+)\/[^/]+$/.exec(path);
                if (redact && method === "PUT") {
                    const roomId = decodeURIComponent(redact[1]);
                    const target = timelineOf(roomId).find((one) => one.event_id === decodeURIComponent(redact[2]));
                    if (target) target.content = {};
                    const one = event("m.room.redaction", {});
                    timelineOf(roomId).push(one);
                    return { event_id: one.event_id };
                }
                throw new Error(`fake server: no ${method} ${path}`);
            },
        },
    } as unknown as MatrixClient;

    return {
        client,
        account,
        rooms,
        media,
        corrupt: (stateKey) => corrupted.add(stateKey),
        forbid: (roomId) => forbidden.add(roomId),
    };
}
