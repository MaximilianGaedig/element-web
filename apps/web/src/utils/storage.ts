/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What chats take up on the homeserver (`im.mxg.storage`): per chat, for the account, and, for a server
 * admin, for the server itself. "Stored" is what is kept on the server; "on demand" is what a bridge
 * serves from its network when someone opens it, which takes no room until then.
 */

import { Method, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

export interface Storage {
    events: number;
    media_stored: number;
    media_on_demand: number;
}

export interface RoomStorage {
    room_id: string;
    name?: string;
    messages: number;
    storage: Storage;
}

export interface StorageOverview {
    rooms: RoomStorage[];
    room_count: number;
    account: Storage;
    /** Only present for a server admin. */
    server?: { database: number; media: number };
    /** When all the account's messages were sent: per month, and per hour of the week in UTC. */
    by_month?: Array<{ month: string; count: number }>;
    by_hour_of_week?: number[];
}

const FEATURE = "im.mxg.storage";
const PATH = "/_matrix/client/unstable/im.mxg.stats/storage";

/** What is kept on the server for this: messages and stored media. */
export function storedBytes(storage: Storage): number {
    return storage.events + storage.media_stored;
}

/** The overview, or undefined when the homeserver doesn't report storage. */
export async function fetchStorageOverview(client: MatrixClient, rooms = 100): Promise<StorageOverview | undefined> {
    try {
        if (!(await client.doesServerSupportUnstableFeature(FEATURE))) return undefined;
        return await client.http.authedRequest<StorageOverview>(
            Method.Get,
            PATH,
            { rooms: String(rooms) },
            undefined,
            { prefix: "" },
        );
    } catch (e) {
        logger.warn("Could not load storage use", e);
        return undefined;
    }
}
