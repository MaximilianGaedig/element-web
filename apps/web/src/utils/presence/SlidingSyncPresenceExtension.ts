/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { type Extension, ExtensionState, type SlidingSync } from "matrix-js-sdk/src/sliding-sync";

import { isPresenceEnabled } from "../presence";
import { setSlidingSyncPresenceActive } from "../sync/slidingSyncActive";
import { applyPresenceEvent } from "./PresenceSyncLoop";

const logger = rootLogger.getChild("SlidingSyncPresenceExtension");

/** The key of the extension in the request and the response. */
export const PRESENCE_EXTENSION_NAME = "im.mxg.presence";
/** What the homeserver advertises in `unstable_features` when it has the extension. */
export const PRESENCE_EXTENSION_FEATURE = "im.mxg.msc4186.presence";

interface PresenceExtensionRequest {
    enabled: boolean;
}

interface PresenceExtensionResponse {
    events?: Partial<IEvent>[];
}

/**
 * Presence inside simplified sliding sync, where the homeserver offers it: the same `m.presence` events a
 * v2 /sync carries, so one connection delivers everything. The first response holds everyone's current
 * presence; later ones only what changed.
 */
export class SlidingSyncPresenceExtension implements Extension<PresenceExtensionRequest, PresenceExtensionResponse> {
    public constructor(private readonly client: MatrixClient) {}

    public name(): string {
        return PRESENCE_EXTENSION_NAME;
    }

    public when(): ExtensionState {
        return ExtensionState.PostProcess;
    }

    public async onRequest(): Promise<PresenceExtensionRequest> {
        return { enabled: true };
    }

    public async onResponse(data: PresenceExtensionResponse): Promise<void> {
        for (const raw of data.events ?? []) {
            try {
                applyPresenceEvent(this.client, raw);
            } catch (e) {
                logger.warn("Ignoring bad presence event", e);
            }
        }
    }
}

/**
 * Registers the presence extension on a sliding sync connection that has not started yet, when the server
 * advertises it and presence is enabled for it.
 *
 * @returns whether presence now arrives with the connection. Otherwise the caller keeps the old way.
 */
export async function registerSlidingSyncPresence(slidingSync: SlidingSync, client: MatrixClient): Promise<boolean> {
    if (!isPresenceEnabled(client)) return false;
    let supported = false;
    try {
        supported = await client.doesServerSupportUnstableFeature(PRESENCE_EXTENSION_FEATURE);
    } catch (e) {
        logger.warn("Could not tell whether the server has the presence extension", e);
    }
    if (!supported) return false;
    slidingSync.registerExtension(new SlidingSyncPresenceExtension(client));
    setSlidingSyncPresenceActive(true);
    logger.info("Presence arrives with sliding sync");
    return true;
}
