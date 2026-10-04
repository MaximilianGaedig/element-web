/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _td, type UserStatus } from "@element-hq/web-shared-components";
import { type MatrixClient, MatrixError } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../languageHandler";

// MSC4426 defines the maximum length of a status to be 256 bytes of UTF-8,
// so we truncate anything longer than that.
const MAX_STATUS_TEXT_BYTES = 256;

// We don't use the actual UserStatus type here as we want to translate the string at runtime,
// so we can make the types reflect the fact it's not ready for human consumption.
const ON_A_CALL_STATUS = {
    emoji: "📞",
    textKey: _td("user_status|on_a_call"),
};

// Static Intl.Segmenter for grabbing the first grapheme of a user status emoji.
// We make one and keep it for performance.
const intlSegmenter = new Intl.Segmenter();

/**
 * Checks if a given text is within the maximum allowed length for a user status.
 * @param text The text to check.
 * @returns True if the text is within the maximum length, false otherwise.
 */
export function userStatusTextWithinMaxLength(text: string): boolean {
    const textEncoder = new TextEncoder();
    return textEncoder.encode(text).length <= MAX_STATUS_TEXT_BYTES;
}

/**
 * Validates an object from a user profile and returns a UserStatus object if it contains a valid user status.
 * @param rawUserStatus The raw user status object to validate.
 * @returns A UserStatus object if valid, otherwise undefined.
 */
function validateUserStatus(rawUserStatus: unknown): UserStatus | undefined {
    if (typeof rawUserStatus !== "object" || rawUserStatus === null) {
        return undefined;
    }
    if ("emoji" in rawUserStatus === false || typeof rawUserStatus.emoji !== "string" || !rawUserStatus.emoji) {
        return undefined;
    }
    if ("text" in rawUserStatus === false || typeof rawUserStatus.text !== "string" || !rawUserStatus.text) {
        return undefined;
    }
    return {
        emoji: [...intlSegmenter.segment(rawUserStatus.emoji)][0]?.segment,
        text: userStatusTextWithinMaxLength(rawUserStatus.text)
            ? rawUserStatus.text
            : `${rawUserStatus.text.slice(0, MAX_STATUS_TEXT_BYTES)}…`,
    };
}

/**
 * Takes the raw result from getExtendedProfileProperty for m.call, validates it and
 * returns true a UserStatus object reflect it, undefined if there is no status or it
 * does not say that the user is on a call.
 * Designed to be the same API as validateUserStatus for simplicty.
 * @param rawCallStatus
 */
function validateMCallStatus(rawCallStatus: unknown): UserStatus | undefined {
    if (!rawCallStatus || typeof rawCallStatus !== "object") return undefined;
    if (!("call_joined_ts" in rawCallStatus) || typeof rawCallStatus.call_joined_ts !== "number") return undefined;
    if (rawCallStatus.call_joined_ts > 0) return { emoji: ON_A_CALL_STATUS.emoji, text: _t(ON_A_CALL_STATUS.textKey) };

    return undefined;
}

/**
 * Takes both MSC4426 user status fields (m.status and m.call) and returns a UserStatus
 * object that reflects the information they represent.
 */
function userStatusFromProfile(userStatus: unknown, callStatus: unknown): UserStatus | undefined {
    const validatedUserStatus = validateUserStatus(userStatus);
    if (validatedUserStatus) return validatedUserStatus;

    const validatedCallStatus = validateMCallStatus(callStatus);
    if (validatedCallStatus) return validatedCallStatus;

    return undefined;
}

/**
 * Fetch the MSC4426 user status of the given user, taking into account m.call if present.
 * Returns undefined if the server does not support extended profiles, the user has no
 * (valid) status, or the status could not be fetched.
 *
 * @param client The Matrix client to fetch the status with.
 * @param userId The ID of the user whose status is being fetched.
 */
export async function fetchUserStatus(
    client: MatrixClient,
    userId: string,
    { fresh = false }: { fresh?: boolean } = {},
): Promise<UserStatus | undefined> {
    const statusCache = cacheFor(client);
    const key = userId;
    const cached = statusCache.get(key);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (cached && (offline || (!fresh && Date.now() < cached.until))) return cached.value;
    if (offline) return undefined;
    const value = fetchUserStatusUncached(client, userId).then(({ status, failed }) => {
        // Kept for a while either way, a status nobody set (a 404) included: rows asked again every time they
        // were drawn. A lookup that failed is tried again sooner.
        const entry = statusCache.get(key);
        if (entry?.value === value) entry.until = Date.now() + (failed ? STATUS_RETRY_MS : STATUS_TTL_MS);
        return status;
    });
    // Until it answers, others asking share this request.
    statusCache.set(key, { value, until: Number.POSITIVE_INFINITY });
    return value;
}

/**
 * Statuses fetched, per client and user. Every chat-list row and card asked the server for its person's
 * status and call (two requests) each time it was drawn: 478 requests for 21 people in 11 minutes, half of
 * them 404s for people with no status, and the rest while offline.
 */
const statusCaches = new WeakMap<
    MatrixClient,
    Map<string, { value: Promise<UserStatus | undefined>; until: number }>
>();
function cacheFor(client: MatrixClient): Map<string, { value: Promise<UserStatus | undefined>; until: number }> {
    let cache = statusCaches.get(client);
    if (!cache) {
        cache = new Map();
        statusCaches.set(client, cache);
    }
    return cache;
}
const STATUS_TTL_MS = 5 * 60_000;
const STATUS_RETRY_MS = 30_000;

/** Forgets the statuses fetched with this client, so the next ask goes to the server (tests sharing a client). */
export function clearUserStatusCache(client: MatrixClient): void {
    statusCaches.delete(client);
}

async function fetchUserStatusUncached(
    client: MatrixClient,
    userId: string,
): Promise<{ status: UserStatus | undefined; failed: boolean }> {
    if ((await client.doesServerSupportExtendedProfiles()) === false) {
        return { status: undefined, failed: false };
    }

    let rawUserStatus: unknown;
    let rawCallStatus: unknown;
    let failed = false;

    try {
        // nb. one of these may be redundant since one takes precedence over the other, but the two
        // are fetched in the same call by the js-sdk anyway so it will only be one API call and this
        // is simpler and duplicates less logic.
        rawUserStatus = await client.getExtendedProfileProperty(userId, "org.matrix.msc4426.status");
    } catch (ex) {
        if (!(ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND")) {
            logger.warn(`Failed to get user status for ${userId}`, ex);
            failed = true;
        }
    }

    try {
        rawCallStatus = await client.getExtendedProfileProperty(userId, "org.matrix.msc4426.call");
    } catch (ex) {
        if (!(ex instanceof MatrixError && ex.errcode === "M_NOT_FOUND")) {
            logger.warn(`Failed to get call status for ${userId}`, ex);
            failed = true;
        }
    }
    return { status: userStatusFromProfile(rawUserStatus, rawCallStatus), failed };
}

/**
 * Sets the MSC4426 user status for the given user.
 *
 * @param client The Matrix client to use.
 * @param userStatus The user status to set.
 */
export function setUserStatus(client: MatrixClient, userStatus: UserStatus): Promise<void> {
    cacheFor(client).delete(client.getSafeUserId());
    return client.setExtendedProfileProperty("org.matrix.msc4426.status", {
        emoji: userStatus.emoji,
        text: userStatus.text,
    });
}

/**
 * Clears all MSC4426 user status for the given user, including their m.status and m.call status,
 * if anything is set in those fields.
 *
 * @param client The Matrix client to use.
 * @throws If either request fails, in which case the other may also not have been cleared.
 */
export async function clearAllUserStatus(client: MatrixClient): Promise<void> {
    const rawUserStatus = await client.getExtendedProfileProperty(client.getSafeUserId(), "org.matrix.msc4426.status");
    if (rawUserStatus) {
        await client.setExtendedProfileProperty("org.matrix.msc4426.status", null);
    }

    const rawCallStatus = await client.getExtendedProfileProperty(client.getSafeUserId(), "org.matrix.msc4426.call");
    if (rawCallStatus) {
        await setUserOnCall(client, false);
    }
}

/**
 * Sets or clears the user's m.call status to represent that they are currently on a call or not.
 * If onCall is true, the status will be set to show that they joined the call at the time when this
 * function is called.
 * @param client The matrix client to use
 * @param onCall Whether the user is currently on a call.
 */
export function setUserOnCall(client: MatrixClient, onCall: boolean): Promise<void> {
    return client.setExtendedProfileProperty(
        "org.matrix.msc4426.call",
        onCall
            ? {
                  call_joined_ts: Date.now(),
              }
            : null,
    );
}
