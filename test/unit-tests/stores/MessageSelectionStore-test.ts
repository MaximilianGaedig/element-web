/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { MessageSelectionStore } from "../../../src/stores/MessageSelectionStore";
import { UPDATE_EVENT } from "../../../src/stores/AsyncStore";

describe("MessageSelectionStore", () => {
    let store: MessageSelectionStore;
    const roomId = "!room:id";

    beforeEach(() => {
        store = MessageSelectionStore.instance;
        store.exitSelectionMode(roomId);
    });

    it("should enter selection mode", () => {
        const spy = jest.fn();
        store.on(UPDATE_EVENT, spy);

        store.enterSelectionMode(roomId, "$event:1");

        expect(store.isSelecting(roomId)).toBe(true);
        expect(store.getSelectedIds(roomId)).toEqual(["$event:1"]);
        expect(spy).toHaveBeenCalled();
    });

    it("should toggle selection", () => {
        store.enterSelectionMode(roomId);
        store.toggleSelection(roomId, "$event:1");
        expect(store.isSelected(roomId, "$event:1")).toBe(true);

        store.toggleSelection(roomId, "$event:1");
        expect(store.isSelected(roomId, "$event:1")).toBe(false);
    });

    it("should exit selection mode", () => {
        store.enterSelectionMode(roomId, "$event:1");
        store.exitSelectionMode(roomId);

        expect(store.isSelecting(roomId)).toBe(false);
        expect(store.getSelectedIds(roomId)).toEqual([]);
    });

    it("should clear selection", () => {
        store.enterSelectionMode(roomId, "$event:1");
        store.toggleSelection(roomId, "$event:2");
        store.clearSelection(roomId);

        expect(store.isSelecting(roomId)).toBe(true);
        expect(store.getSelectedIds(roomId)).toEqual([]);
    });

    it("should support independent room selections", () => {
        const otherRoomId = "!other:id";
        store.enterSelectionMode(roomId, "$event:r1");
        store.enterSelectionMode(otherRoomId, "$event:o1");

        expect(store.getSelectedIds(roomId)).toEqual(["$event:r1"]);
        expect(store.getSelectedIds(otherRoomId)).toEqual(["$event:o1"]);

        store.exitSelectionMode(roomId);
        expect(store.isSelecting(roomId)).toBe(false);
        expect(store.isSelecting(otherRoomId)).toBe(true);
    });
});
