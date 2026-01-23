/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { MessageSelectionStore } from "../../../src/stores/MessageSelectionStore";
import { UPDATE_EVENT } from "../../../src/stores/AsyncStore";

describe("MessageSelectionStore", () => {
    let store: MessageSelectionStore;

    beforeEach(() => {
        store = MessageSelectionStore.instance;
        store.exitSelectionMode();
    });

    it("should enter selection mode", () => {
        const spy = jest.fn();
        store.on(UPDATE_EVENT, spy);

        store.enterSelectionMode("!room:id", "$event:1");

        expect(store.isSelecting).toBe(true);
        expect(store.currentRoomId).toBe("!room:id");
        expect(store.selectedIds).toEqual(["$event:1"]);
        expect(spy).toHaveBeenCalled();
    });

    it("should toggle selection", () => {
        store.enterSelectionMode("!room:id");
        store.toggleSelection("$event:1");
        expect(store.isSelected("$event:1")).toBe(true);

        store.toggleSelection("$event:1");
        expect(store.isSelected("$event:1")).toBe(false);
    });

    it("should exit selection mode", () => {
        store.enterSelectionMode("!room:id", "$event:1");
        store.exitSelectionMode();

        expect(store.isSelecting).toBe(false);
        expect(store.currentRoomId).toBeNull();
        expect(store.selectedIds).toEqual([]);
    });

    it("should clear selection", () => {
        store.enterSelectionMode("!room:id", "$event:1");
        store.toggleSelection("$event:2");
        store.clearSelection();

        expect(store.isSelecting).toBe(true);
        expect(store.selectedIds).toEqual([]);
    });
});
