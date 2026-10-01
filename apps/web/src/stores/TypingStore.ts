/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { Method } from "matrix-js-sdk/src/matrix";
import { encodeUri } from "matrix-js-sdk/src/utils";
import { logger } from "matrix-js-sdk/src/logger";

import { type SDKContextClass } from "../contexts/SDKContextClass";
import SettingsStore from "../settings/SettingsStore";
import { isLocalRoom } from "../utils/localRoom/isLocalRoom";
import Timer from "../utils/Timer";
import { TYPING_KIND_FIELD, TYPING_KINDS_FEATURE, type TypingActivity } from "../TypingKinds";

const TYPING_USER_TIMEOUT = 10000;
const TYPING_SERVER_TIMEOUT = 30000;
// An activity lasts as long as the recording or the upload does, which can be much longer than the
// server keeps a typing notification. It is sent again well before that.
const TYPING_ACTIVITY_REFRESH = 20000;

interface SelfActivity {
    /** What is being done in the room, oldest first. The newest is the one others are told. */
    holds: { kind: TypingActivity }[];
    /** What the server was last told, if it has been told of an activity at all. */
    sent?: TypingActivity;
    refresh?: ReturnType<typeof setInterval>;
}

/**
 * Tells the room what the user is doing there other than typing text, on the application's typing
 * store, until the returned function is called.
 *
 * The upload path and the voice recorder reach the store through this rather than through
 * SDKContextClass, whose imports are most of the application: putting those in front of theirs
 * makes an import cycle of the kind that has broken startup before.
 */
export function holdSelfTypingActivity(roomId: string, threadId: string | null, kind: TypingActivity): () => void {
    return TypingStore.current?.holdSelfActivity(roomId, threadId, kind) ?? ((): void => {});
}

/**
 * Tracks typing state for users.
 */
export default class TypingStore {
    /** The store most recently created, which is the application's one. */
    public static current?: TypingStore;

    private typingStates: {
        [roomId: string]: {
            isTyping: boolean;
            userTimer: Timer;
            serverTimer: Timer;
        };
    } = {};
    private activities = new Map<string, SelfActivity>();
    private kindsSupported?: Promise<boolean>;

    public constructor(private readonly context: SDKContextClass) {
        this.reset();
        TypingStore.current = this;
    }

    /**
     * Clears all cached typing states. Intended to be called when the
     * MatrixClientPeg client changes.
     */
    public reset(): void {
        this.typingStates = {
            // "roomId": {
            //     isTyping: bool,     // Whether the user is typing or not
            //     userTimer: Timer,   // Local timeout for "user has stopped typing"
            //     serverTimer: Timer, // Maximum timeout for the typing state
            // },
        };
        for (const activity of this.activities.values()) clearInterval(activity.refresh);
        this.activities = new Map();
        this.kindsSupported = undefined;
    }

    /**
     * Tells the room that the user is doing something other than typing text there (recording a voice
     * message, uploading a file) until the returned function is called. Does nothing on a server
     * that cannot say which: everybody would be told "typing", which is not what is happening.
     *
     * Several things can be held in a room at once; others are told the one started last. When the
     * last ends the user is back to typing text if they are, and otherwise to not typing.
     * @param roomId The room the activity is in.
     * @param threadId The thread it is in, if any: like typing, activities in threads are not sent.
     * @param kind What the user is doing.
     * @returns The function that ends the activity. Calling it again does nothing.
     */
    public holdSelfActivity(roomId: string, threadId: string | null, kind: TypingActivity): () => void {
        // The same rules as for typing: this is a typing notification, only a more exact one.
        if (isLocalRoom(roomId) || threadId) return () => {};
        if (!SettingsStore.getValue("sendTypingNotifications")) return () => {};
        if (SettingsStore.getValue("lowBandwidth")) return () => {};

        let activity = this.activities.get(roomId);
        if (!activity) this.activities.set(roomId, (activity = { holds: [] }));
        const hold = { kind };
        activity.holds.push(hold);
        void this.syncSelfActivity(roomId);

        return () => {
            const activity = this.activities.get(roomId);
            const index = activity?.holds.indexOf(hold) ?? -1;
            if (!activity || index === -1) return;
            activity.holds.splice(index, 1);
            void this.syncSelfActivity(roomId);
        };
    }

    private supportsKinds(): Promise<boolean> {
        this.kindsSupported ??= (async (): Promise<boolean> => {
            try {
                return (await this.context.client?.doesServerSupportUnstableFeature(TYPING_KINDS_FEATURE)) ?? false;
            } catch (e) {
                logger.warn("Could not tell whether the server relays typing kinds", e);
                return false;
            }
        })();
        return this.kindsSupported;
    }

    /** Brings what the server was told in line with what is held in the room now. */
    private async syncSelfActivity(roomId: string): Promise<void> {
        const supported = await this.supportsKinds();
        // Whatever was held when this was called may have ended while waiting for the answer, so the
        // state is only read now.
        const activity = this.activities.get(roomId);
        if (!activity) return;
        const kind = supported ? activity.holds.at(-1)?.kind : undefined;

        if (kind) {
            activity.refresh ??= setInterval(() => this.sendSelfActivity(roomId), TYPING_ACTIVITY_REFRESH);
            if (activity.sent !== kind) this.sendSelfActivity(roomId);
            return;
        }

        clearInterval(activity.refresh);
        this.activities.delete(roomId);
        if (!activity.sent) return;
        // The server still holds the activity: replace it with what the composer says, which was not
        // sent while the activity lasted.
        const isTyping = this.typingStates[roomId]?.isTyping ?? false;
        void this.context.client?.sendTyping(roomId, isTyping, TYPING_SERVER_TIMEOUT);
    }

    private sendSelfActivity(roomId: string): void {
        const client = this.context.client;
        const activity = this.activities.get(roomId);
        const kind = activity?.holds.at(-1)?.kind;
        const userId = client?.getUserId();
        // Guests cannot send typing notifications, as in MatrixClient.sendTyping.
        if (!client || !userId || !activity || !kind || client.isGuest()) return;

        activity.sent = kind;
        // MatrixClient.sendTyping has no room for the kind, so this is its request with one more field.
        const path = encodeUri("/rooms/$roomId/typing/$userId", { $roomId: roomId, $userId: userId });
        const body = { typing: true, timeout: TYPING_SERVER_TIMEOUT, [TYPING_KIND_FIELD]: kind };
        client.http.authedRequest(Method.Put, path, undefined, body).catch((e) => {
            logger.warn("Could not send what the user is doing in the room", e);
        });
    }

    /**
     * Changes the typing status for the MatrixClientPeg user.
     * @param {string} roomId The room ID to set the typing state in.
     * @param {boolean} isTyping Whether the user is typing or not.
     */
    public setSelfTyping(roomId: string, threadId: string | null, isTyping: boolean): void {
        // No typing notifications for local rooms
        if (isLocalRoom(roomId)) return;

        if (!SettingsStore.getValue("sendTypingNotifications")) return;
        if (SettingsStore.getValue("lowBandwidth")) return;
        // Disable typing notification for threads for the initial launch
        // before we figure out a better user experience for them
        if (threadId) return;

        let currentTyping = this.typingStates[roomId];
        if ((!isTyping && !currentTyping) || currentTyping?.isTyping === isTyping) {
            // No change in state, so don't do anything. We'll let the timer run its course.
            return;
        }

        if (!currentTyping) {
            currentTyping = this.typingStates[roomId] = {
                isTyping: isTyping,
                serverTimer: new Timer(TYPING_SERVER_TIMEOUT),
                userTimer: new Timer(TYPING_USER_TIMEOUT),
            };
        }

        currentTyping.isTyping = isTyping;

        if (isTyping) {
            if (!currentTyping.serverTimer.isRunning()) {
                void currentTyping.serverTimer
                    .restart()
                    .finished()
                    .then(() => {
                        const currentTyping = this.typingStates[roomId];
                        if (currentTyping) currentTyping.isTyping = false;

                        // The server will (should) time us out on typing, so we don't
                        // need to advertise a stop of typing.
                    });
            } else currentTyping.serverTimer.restart();

            if (!currentTyping.userTimer.isRunning()) {
                void currentTyping.userTimer
                    .restart()
                    .finished()
                    .then(() => {
                        this.setSelfTyping(roomId, threadId, false);
                    });
            } else currentTyping.userTimer.restart();
        }

        // While the server shows the user as recording or uploading, plain typing would replace that
        // and "stopped typing" would end it. The state above is sent when the activity ends.
        if (this.activities.get(roomId)?.sent) return;

        void this.context.client?.sendTyping(roomId, isTyping, TYPING_SERVER_TIMEOUT);
    }
}
