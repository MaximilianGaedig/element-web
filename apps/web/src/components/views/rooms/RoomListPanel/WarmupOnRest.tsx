/*
 * Copyright 2026 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useEffect, useRef, type JSX } from "react";

import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";
import { ENCRYPTED_ROW_ATTRIBUTE } from "../../../../utils/startup/lastScreen";
import { RoomWarmup } from "../../../../utils/room/roomWarmup";

/** The room list's row, which the shared view draws and this sits inside. */
const ROW_SELECTOR = ".mx_RoomListItemView";

interface Props {
    client: MatrixClient;
    room: Room;
}

/**
 * Gets a room ready to open while the pointer rests on its row in the room list, a finger lands on
 * it or the keyboard focuses it, so that the click that follows finds nothing left to load (see
 * utils/room/roomWarmup).
 *
 * The row belongs to the shared room list view, which knows nothing of Matrix and has no hook for
 * this; the avatar is the part of a row the app draws. So this is drawn with the avatar, shows
 * nothing, and listens on the row it finds itself in.
 */
export function WarmupOnRest({ client, room }: Props): JSX.Element {
    const marker = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        // Outside a row (the copy of it that follows the pointer while dragging) there is nothing to do.
        const row = marker.current?.closest<HTMLElement>(ROW_SELECTOR);
        if (!row) return;
        const warmup = RoomWarmup.for(client);

        const rest = (): void => warmup.rest(room);
        const leave = (): void => warmup.leave(room);
        // A touch arrives as a pointer too, and has its own handling below.
        const onPointerEnter = (e: PointerEvent): void => {
            if (e.pointerType !== "touch") rest();
        };
        // There is no hovering with a finger: by the time it is down on a room, it has arrived.
        const onTouchStart = (): void => warmup.rest(room, 0);

        row.addEventListener("pointerenter", onPointerEnter);
        row.addEventListener("pointerleave", leave);
        row.addEventListener("focusin", rest);
        row.addEventListener("focusout", leave);
        row.addEventListener("touchstart", onTouchStart, { passive: true });
        // The finger was scrolling the list, not choosing this room.
        row.addEventListener("touchmove", leave, { passive: true });
        row.addEventListener("touchcancel", leave);
        return () => {
            row.removeEventListener("pointerenter", onPointerEnter);
            row.removeEventListener("pointerleave", leave);
            row.removeEventListener("focusin", rest);
            row.removeEventListener("focusout", leave);
            row.removeEventListener("touchstart", onTouchStart);
            row.removeEventListener("touchmove", leave);
            row.removeEventListener("touchcancel", leave);
            // The list recycles rows as it scrolls: one that has gone is no longer being pointed at.
            leave();
        };
    }, [client, room]);

    // Says, too, whether the room is encrypted: the picture kept of the screen for the next start leaves
    // such a room's last message out, and the row itself is not ours to mark (utils/startup/lastScreen).
    const encrypted = room.hasEncryptionStateEvent() ? { [ENCRYPTED_ROW_ATTRIBUTE]: "" } : undefined;
    return <span ref={marker} style={{ display: "none" }} {...encrypted} />;
}
