/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Getting ready for the settings before they are asked for.
 *
 * The page and every section's code are one chunk that is only fetched when the settings are first opened
 * (LoggedInView), and the sessions section then starts asking the server for the devices only once it has
 * drawn: the two waits one after the other, where the dialog these replaced had at least the chunk already
 * on its way. The bar's Settings entry and the settings' list are the two places that know the settings
 * are coming, so they start both.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { prefetchOwnDevices } from "./devices/useOwnDevices";

let chunk: Promise<unknown> | undefined;

/** The code of the page and its sections; harmless to ask for twice, and to ask for when it fails. */
export function preloadSettingsPage(): void {
    chunk ??= import("./UserSettingsPage").catch(() => {
        chunk = undefined;
    });
}

/** What the sessions section shows first: the devices, fetched while the page is still being drawn. */
export function preloadSettingsData(client: MatrixClient | undefined): void {
    preloadSettingsPage();
    if (client?.getDeviceId()) prefetchOwnDevices(client);
}
