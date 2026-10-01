/*
 * Copyright 2026 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { render } from "test-utils-rtl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient, Room } from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { WarmupOnRest } from "./WarmupOnRest";
import { RoomWarmup } from "../../../../utils/room/roomWarmup";

describe("<WarmupOnRest />", () => {
    let client: MatrixClient;
    let room: Room;
    let warmup: RoomWarmup;

    /** The row as the shared room list draws it, with the app's part of it inside. */
    const renderInRow = (): { row: HTMLElement; unmount: () => void } => {
        const { container, unmount } = render(
            <button className="mx_RoomListItemView">
                <WarmupOnRest client={client} room={room} />
            </button>,
        );
        return { row: container.querySelector<HTMLElement>(".mx_RoomListItemView")!, unmount };
    };

    const pointer = (type: string, pointerType: string): Event =>
        Object.assign(new Event(type), { pointerType }) as Event;

    beforeEach(() => {
        client = createTestClient();
        room = new Room("!room:example.org", client, "@alice:example.org");
        warmup = RoomWarmup.for(client);
        vi.spyOn(warmup, "rest").mockImplementation(() => {});
        vi.spyOn(warmup, "leave").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("draws nothing", () => {
        const { row } = renderInRow();
        expect(row.textContent).toBe("");
        expect(row.querySelector("span")!.style.display).toBe("none");
    });

    it("has the room warmed up while the mouse is on its row, and not after it has left", () => {
        const { row } = renderInRow();

        row.dispatchEvent(pointer("pointerenter", "mouse"));
        expect(warmup.rest).toHaveBeenCalledExactlyOnceWith(room);

        row.dispatchEvent(pointer("pointerleave", "mouse"));
        expect(warmup.leave).toHaveBeenCalledExactlyOnceWith(room);
    });

    it("warms the room up at once for a finger, and gives up when the finger scrolls instead", () => {
        const { row } = renderInRow();

        row.dispatchEvent(pointer("pointerenter", "touch"));
        expect(warmup.rest).not.toHaveBeenCalled();
        row.dispatchEvent(new Event("touchstart"));
        expect(warmup.rest).toHaveBeenCalledExactlyOnceWith(room, 0);

        row.dispatchEvent(new Event("touchmove"));
        expect(warmup.leave).toHaveBeenCalledExactlyOnceWith(room);
    });

    it("warms the room up while the keyboard is on its row", () => {
        const { row } = renderInRow();

        row.dispatchEvent(new Event("focusin"));
        expect(warmup.rest).toHaveBeenCalledExactlyOnceWith(room);
        row.dispatchEvent(new Event("focusout"));
        expect(warmup.leave).toHaveBeenCalledExactlyOnceWith(room);
    });

    it("counts a row that has gone from the list as left", () => {
        const { unmount } = renderInRow();

        unmount();
        expect(warmup.leave).toHaveBeenCalledExactlyOnceWith(room);
    });

    it("does nothing outside a row", () => {
        // The copy of a row that follows the pointer while it is dragged.
        expect(() => render(<WarmupOnRest client={client} room={room} />).unmount()).not.toThrow();
        expect(warmup.leave).not.toHaveBeenCalled();
    });
});
