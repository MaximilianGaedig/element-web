/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Whether a build file is downloaded only once something asks for it, rather than with the rest of the app for
 * offline use: what only one choice of the reader's needs, like a wallpaper's pattern (half a megabyte, for a
 * wallpaper most never pick). The build leaves these out of its offline manifest; the service worker keeps each
 * one it has served from build to build, so a chosen one goes on working offline.
 */
export function isOnDemandAsset(path: string): boolean {
    return path.startsWith("img/tweb/");
}
