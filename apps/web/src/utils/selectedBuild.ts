/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** The cookie the server sets when `/?build=<id>` selects another build of the app (see docs/preview.md). */
const BUILD_COOKIE = "mxg_build";

/** The ids the server routes: lower-case letters, digits and dashes. */
const BUILD_ID = /^[a-z0-9-]{1,40}$/;

/**
 * The build selected by `/?build=<id>`, or undefined when the production build is running.
 *
 * @param cookies - `document.cookie`
 */
export function getSelectedBuild(cookies: string): string | undefined {
    for (const cookie of cookies.split(";")) {
        const [name, ...value] = cookie.trim().split("=");
        if (name !== BUILD_COOKIE) continue;
        const id = value.join("=");
        return BUILD_ID.test(id) && id !== "prod" ? id : undefined;
    }
    return undefined;
}
