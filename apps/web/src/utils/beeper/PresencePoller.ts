/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ClientEvent, type MatrixClient, MatrixError, MatrixEvent, User } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import SettingsStore from "../../settings/SettingsStore";
import DMRoomMap from "../DMRoomMap";
import { isPresenceEnabled } from "../presence";
import { getBridgedDmUserId } from "./bridgeInfo";

const logger = rootLogger.getChild("PresencePoller");

export const OPEN_DM_INTERVAL_MS = 30_000;
export const DM_LIST_INTERVAL_MS = 90_000;
/** How often to check whether the open room changed, so a newly opened DM is fetched promptly. */
const OPEN_ROOM_CHECK_MS = 5_000;
export const MAX_USERS_PER_CYCLE = 50;
export const MAX_CONCURRENCY = 4;
const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface PresencePollerOptions {
    /** The currently open room, if any. */
    getOpenRoomId: () => string | null | undefined;
}

/**
 * Simplified sliding sync has no presence extension, so with it Element never receives m.presence
 * and presence dots / "last seen" stay empty. This polls GET /presence/{userId}/status for DM
 * partners instead — the open DM every 30s, recent DMs every 90s — and feeds the results into the
 * js-sdk User objects exactly like /sync would, so all existing presence UI updates.
 *
 * Only active with simplified sliding sync and presence enabled for the homeserver. Pauses while
 * the tab is hidden, caps work per cycle, and backs off on errors / rate limiting.
 */
export class PresencePoller {
    private static current?: PresencePoller;

    /** Starts polling for this client if applicable (stopping any previous poller). */
    public static start(client: MatrixClient, opts: PresencePollerOptions): void {
        PresencePoller.stop();
        if (!SettingsStore.getValue("feature_simplified_sliding_sync") || !isPresenceEnabled(client)) return;
        PresencePoller.current = new PresencePoller(client, opts);
        PresencePoller.current.start();
    }

    public static stop(): void {
        PresencePoller.current?.stop();
        PresencePoller.current = undefined;
    }

    private readonly timers = new Map<"open" | "list", number>();
    private backoffUntil = 0;
    private backoffMs = 0;
    private running = false;
    private lastOpenPoll = { roomId: undefined as string | null | undefined, at: 0 };

    public constructor(
        private readonly client: MatrixClient,
        private readonly opts: PresencePollerOptions,
    ) {}

    public start(): void {
        if (this.running) return;
        this.running = true;
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.schedule("open", 0);
        this.schedule("list", 0);
    }

    public stop(): void {
        this.running = false;
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        for (const id of this.timers.values()) window.clearTimeout(id);
        this.timers.clear();
    }

    private get hidden(): boolean {
        return document.visibilityState === "hidden";
    }

    private readonly onVisibilityChange = (): void => {
        if (!this.running) return;
        if (this.hidden) {
            for (const id of this.timers.values()) window.clearTimeout(id);
            this.timers.clear();
        } else {
            // Coming back: refresh right away rather than showing stale presence.
            this.lastOpenPoll.at = 0;
            this.schedule("open", 0);
            this.schedule("list", 0);
        }
    };

    private schedule(loop: "open" | "list", delay: number): void {
        const existing = this.timers.get(loop);
        if (existing !== undefined) window.clearTimeout(existing);
        this.timers.set(
            loop,
            window.setTimeout(() => void this.runLoop(loop), delay),
        );
    }

    private async runLoop(loop: "open" | "list"): Promise<void> {
        this.timers.delete(loop);
        if (!this.running || this.hidden) return;
        if (Date.now() >= this.backoffUntil) {
            if (loop === "list") {
                await this.poll(this.dmListUsers());
            } else {
                const roomId = this.opts.getOpenRoomId();
                const due = Date.now() - this.lastOpenPoll.at >= OPEN_DM_INTERVAL_MS;
                if (due || roomId !== this.lastOpenPoll.roomId) {
                    this.lastOpenPoll = { roomId, at: Date.now() };
                    await this.poll(this.openDmUsers());
                }
            }
        }
        if (this.running && !this.hidden) {
            this.schedule(loop, loop === "open" ? OPEN_ROOM_CHECK_MS : DM_LIST_INTERVAL_MS);
        }
    }

    private dmUserForRoom(roomId: string): string | undefined {
        const room = this.client.getRoom(roomId);
        if (!room || room.getMyMembership() !== "join") return undefined;
        return DMRoomMap.shared()?.getUserIdForRoomId(roomId) ?? getBridgedDmUserId(room);
    }

    /** The other member of the open DM, if the open room is a DM. */
    public openDmUsers(): string[] {
        const roomId = this.opts.getOpenRoomId();
        const userId = roomId ? this.dmUserForRoom(roomId) : undefined;
        return userId ? [userId] : [];
    }

    /** Partners of the most recently active DMs, most recent first, capped per cycle. */
    public dmListUsers(): string[] {
        const rooms = this.client
            .getVisibleRooms()
            .slice()
            .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
        const users: string[] = [];
        for (const room of rooms) {
            const userId = this.dmUserForRoom(room.roomId);
            if (userId && !users.includes(userId)) users.push(userId);
            if (users.length >= MAX_USERS_PER_CYCLE) break;
        }
        return users;
    }

    /** Fetches presence for the users with bounded concurrency; stops the cycle when backing off. */
    public async poll(userIds: string[]): Promise<void> {
        const queue = [...new Set(userIds)].slice(0, MAX_USERS_PER_CYCLE);
        const worker = async (): Promise<void> => {
            while (queue.length && this.running && Date.now() >= this.backoffUntil) {
                const userId = queue.shift()!;
                try {
                    const status = await this.client.getPresence(userId);
                    this.apply(userId, status as unknown as Record<string, unknown>);
                    this.backoffMs = 0;
                } catch (e) {
                    this.onError(userId, e);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, worker));
    }

    private onError(userId: string, e: unknown): void {
        const status = e instanceof MatrixError ? e.httpStatus : undefined;
        if (status === 404 || status === 403) {
            // No presence for this user (or not allowed to see it); nothing to back off from.
            logger.debug(`No presence for ${userId}`, status);
            return;
        }
        let retryAfter: number | undefined;
        if (e instanceof MatrixError && (status === 429 || e.errcode === "M_LIMIT_EXCEEDED")) {
            retryAfter = typeof e.data?.retry_after_ms === "number" ? e.data.retry_after_ms : undefined;
        }
        this.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, this.backoffMs * 2));
        this.backoffUntil = Date.now() + Math.max(retryAfter ?? 0, this.backoffMs);
        logger.warn(`Presence polling backing off for ${this.backoffUntil - Date.now()}ms`, e);
    }

    /** Applies a /presence status response as if an m.presence event had arrived via /sync. */
    private apply(userId: string, status: Record<string, unknown>): void {
        const content: Record<string, unknown> = { presence: status.presence ?? "offline" };
        for (const key of ["status_msg", "last_active_ago", "currently_active"]) {
            if (status[key] !== undefined) content[key] = status[key];
        }
        const event = new MatrixEvent({ type: "m.presence", sender: userId, content });
        let user = this.client.getUser(userId);
        if (user) {
            user.setPresenceEvent(event);
        } else {
            user = User.createUser(userId, this.client);
            user.setPresenceEvent(event);
            this.client.store.storeUser(user);
        }
        this.client.emit(ClientEvent.Event, event);
    }
}
