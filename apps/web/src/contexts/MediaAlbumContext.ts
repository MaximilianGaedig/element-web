/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { createContext } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Provided by the MediaAlbumGrouper around the tile of an album's anchor (its first event in timeline order).
 * MessageEvent renders the album grid instead of the anchor's own body when `anchor` is its event
 * and the album holds more than one item.
 */
export interface MediaAlbumContextValue {
    /** the event whose tile renders the album */
    anchor: MatrixEvent;
    /** all members of the album, in timeline order (redacted items already removed) */
    items: MatrixEvent[];
}

export const MediaAlbumContext = createContext<MediaAlbumContextValue | null>(null);
MediaAlbumContext.displayName = "MediaAlbumContext";
