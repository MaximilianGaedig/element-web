/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, afterEach } from "vitest";
import { act, renderHook } from "test-utils-rtl";

import { roomListPanelView, setRoomListPanelView, useRoomListPanelView } from "./roomListPanelView";

afterEach(() => setRoomListPanelView("rooms"));

describe("roomListPanelView", () => {
    it("starts on the room list", () => {
        expect(roomListPanelView()).toBe("rooms");
    });

    it("re-renders whoever is reading it when the view changes", () => {
        const { result } = renderHook(() => useRoomListPanelView());
        expect(result.current).toBe("rooms");

        act(() => setRoomListPanelView("contacts"));
        expect(result.current).toBe("contacts");

        act(() => setRoomListPanelView("rooms"));
        expect(result.current).toBe("rooms");
    });

    it("stops listening once the reader is gone", () => {
        const { unmount } = renderHook(() => useRoomListPanelView());
        unmount();
        // Nothing to assert but that this does not throw into a dead subscriber.
        expect(() => setRoomListPanelView("contacts")).not.toThrow();
    });
});
