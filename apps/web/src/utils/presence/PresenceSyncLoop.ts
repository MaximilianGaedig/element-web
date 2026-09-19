/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    ClientEvent,
    type IEvent,
    type MatrixClient,
    MatrixError,
    type MatrixEvent,
    Method,
    User,
} from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import SettingsStore from "../../settings/SettingsStore";
import { isPresenceEnabled } from "../presence";

const logger = rootLogger.getChild("PresenceSyncLoop");

/** A /sync filter that drops everything filterable except presence: no rooms, no account data. */
export const PRESENCE_ONLY_FILTER = {
    room: {
        rooms: [],
        account_data: { not_types: ["*"] },
        ephemeral: { not_types: ["*"] },
        state: { not_types: ["*"] },
        timeline: { not_types: ["*"], limit: 0 },
    },
    account_data: { not_types: ["*"] },
    presence: { types: ["m.presence"] },
};

export const LONG_POLL_TIMEOUT_MS = 30_000;
/** Slack on top of the server-side timeout before we give up on the HTTP request ourselves. */
const LOCAL_TIMEOUT_SLACK_MS = 30_000;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/**
 * How long to wait before asking again while to-device messages are pending for this device.
 * They belong to the sliding-sync connection; see the class comment.
 */
export const TO_DEVICE_HOLD_MS = 5_000;
/** Consecutive failures after which the fallback (the per-user PresencePoller) takes over. */
export const FAILURES_BEFORE_FALLBACK = 3;

interface PresenceSyncResponse {
    next_batch: string;
    presence?: { events?: Partial<IEvent>[] };
    to_device?: { events?: unknown[] };
}

export interface PresenceSyncLoopOptions {
    /** Called when the long-poll keeps failing; `active` false once it works again. */
    onFallback?: (active: boolean) => void;
}

/**
 * Feeds a raw m.presence event into the js-sdk User objects exactly like SyncApi does, so
 * UserEvent.Presence / LastPresenceTs / CurrentlyActive and ClientEvent.Event all fire.
 */
export function applyPresenceEvent(client: MatrixClient, raw: Partial<IEvent>): void {
    if (raw.type !== "m.presence" || typeof raw.sender !== "string") return;
    const event: MatrixEvent = client.getEventMapper()(raw);
    let user = client.store.getUser(raw.sender);
    if (user) {
        user.setPresenceEvent(event);
    } else {
        user = User.createUser(raw.sender, client);
        user.setPresenceEvent(event);
        client.store.storeUser(user);
    }
    client.emit(ClientEvent.Event, event);
}

/**
 * Simplified sliding sync has no presence extension. Instead of polling /presence per user, this
 * runs a second, tiny /sync long-poll that carries only presence (see PRESENCE_ONLY_FILTER), so
 * presence changes arrive as soon as the homeserver has them (it answers on its next wake-up, i.e.
 * any activity in our rooms, or after LONG_POLL_TIMEOUT_MS at the latest).
 *
 * To-device safety: to-device messages can't be filtered out, and a v2 /sync with `since`
 * deletes this device's to-device messages up to `since` on the server (tuwunel and Synapse both
 * do). Those messages (room keys!) belong to the sliding-sync connection. So `since` only ever
 * advances past a response whose `to_device` list was empty, i.e. proof that nothing was pending
 * up to that token. While messages are pending we keep the old `since` (deleting nothing new) and
 * ask again after TO_DEVICE_HOLD_MS, by which time sliding sync has consumed them. We never
 * process the to-device messages ourselves.
 *
 * `set_presence` is left at the default, as sliding sync sends it; anything else would make the
 * device's presence flap between the two connections.
 *
 * Only active with simplified sliding sync and presence enabled for the homeserver. Aborts while
 * the tab is hidden and resumes with a fresh request; backs off exponentially on errors and
 * signals `onFallback` after repeated failures.
 */
export class PresenceSyncLoop {
    private static current?: PresenceSyncLoop;

    /** Whether the loop should run for this client at all. */
    public static isApplicable(client: MatrixClient): boolean {
        return !!SettingsStore.getValue("feature_simplified_sliding_sync") && isPresenceEnabled(client);
    }

    /** Starts the loop for this client if applicable (stopping any previous loop). */
    public static start(client: MatrixClient, opts: PresenceSyncLoopOptions = {}): PresenceSyncLoop | undefined {
        PresenceSyncLoop.stop();
        if (!PresenceSyncLoop.isApplicable(client)) return undefined;
        PresenceSyncLoop.current = new PresenceSyncLoop(client, opts);
        PresenceSyncLoop.current.start();
        return PresenceSyncLoop.current;
    }

    public static stop(): void {
        PresenceSyncLoop.current?.stop();
        PresenceSyncLoop.current = undefined;
    }

    private running = false;
    private since?: string;
    private abort?: AbortController;
    private retryTimer?: number;
    private failures = 0;
    private backoffMs = 0;
    private inFallback = false;
    /** Bumped on every (re)start so a stale request's completion can't schedule a second loop. */
    private generation = 0;

    public constructor(
        private readonly client: MatrixClient,
        private readonly opts: PresenceSyncLoopOptions = {},
    ) {}

    public get isRunning(): boolean {
        return this.running;
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.kick();
    }

    public stop(): void {
        this.running = false;
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.halt();
        if (this.inFallback) {
            this.inFallback = false;
            this.opts.onFallback?.(false);
        }
    }

    private get hidden(): boolean {
        return document.visibilityState === "hidden";
    }

    private halt(): void {
        this.generation++;
        this.abort?.abort();
        this.abort = undefined;
        window.clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
    }

    /** Starts a fresh request now, cancelling any in-flight one or pending retry. */
    private kick(): void {
        this.halt();
        if (!this.running || this.hidden) return;
        void this.loop(this.generation);
    }

    private readonly onVisibilityChange = (): void => {
        if (!this.running) return;
        if (this.hidden) {
            this.halt();
        } else {
            this.kick();
        }
    };

    private async loop(generation: number): Promise<void> {
        while (this.running && !this.hidden && generation === this.generation) {
            const abort = new AbortController();
            this.abort = abort;
            let res: PresenceSyncResponse;
            try {
                res = await this.client.http.authedRequest<PresenceSyncResponse>(
                    Method.Get,
                    "/sync",
                    {
                        filter: JSON.stringify(PRESENCE_ONLY_FILTER),
                        // The first request returns immediately with current presence.
                        timeout: String(this.since ? LONG_POLL_TIMEOUT_MS : 0),
                        ...(this.since ? { since: this.since } : {}),
                    },
                    undefined,
                    { abortSignal: abort.signal, localTimeoutMs: LONG_POLL_TIMEOUT_MS + LOCAL_TIMEOUT_SLACK_MS },
                );
            } catch (e) {
                if (generation !== this.generation || abort.signal.aborted) return;
                this.onError(e, generation);
                return;
            }
            if (generation !== this.generation) return;
            this.onSuccess();
            for (const raw of res.presence?.events ?? []) {
                try {
                    applyPresenceEvent(this.client, raw);
                } catch (e) {
                    logger.warn("Ignoring bad presence event", e);
                }
            }
            if (res.to_device?.events?.length) {
                // Pending to-device messages: don't advance `since` (that would delete them).
                await this.sleep(TO_DEVICE_HOLD_MS, generation);
                continue;
            }
            if (res.next_batch) this.since = res.next_batch;
        }
    }

    private sleep(ms: number, generation: number): Promise<void> {
        return new Promise((resolve) => {
            this.retryTimer = window.setTimeout(() => {
                this.retryTimer = undefined;
                resolve();
            }, ms);
            // halt() clears the timer; the loop condition then sees the new generation.
            if (generation !== this.generation) resolve();
        });
    }

    private onSuccess(): void {
        this.failures = 0;
        this.backoffMs = 0;
        if (this.inFallback) {
            logger.info("Presence long-poll recovered; stopping fallback");
            this.inFallback = false;
            this.opts.onFallback?.(false);
        }
    }

    private onError(e: unknown, generation: number): void {
        this.failures++;
        let retryAfter: number | undefined;
        if (e instanceof MatrixError && (e.httpStatus === 429 || e.errcode === "M_LIMIT_EXCEEDED")) {
            retryAfter = typeof e.data?.retry_after_ms === "number" ? e.data.retry_after_ms : undefined;
        }
        this.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, this.backoffMs * 2));
        const delay = Math.max(retryAfter ?? 0, this.backoffMs);
        logger.warn(`Presence long-poll failed (${this.failures}x), retrying in ${delay}ms`, e);
        if (this.failures >= FAILURES_BEFORE_FALLBACK && !this.inFallback) {
            logger.warn("Presence long-poll keeps failing; falling back to polling");
            this.inFallback = true;
            this.opts.onFallback?.(true);
        }
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = undefined;
            if (generation === this.generation && this.running && !this.hidden) void this.loop(generation);
        }, delay);
    }
}
