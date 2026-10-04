/*
Copyright 2024 New Vector Ltd.
Copyright 2021-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

export enum Filter {
    People,
    PublicRooms,
    PublicSpaces,
    /** What was said, across every chat: the search view's Messages group as a view of its own. */
    Messages,
}
