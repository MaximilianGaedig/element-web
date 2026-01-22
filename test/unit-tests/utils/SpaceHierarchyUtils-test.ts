/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { Room } from "matrix-js-sdk/src/matrix";

import { getSpacePath } from "../../../src/utils/SpaceHierarchyUtils";
import SpaceStore from "../../../src/stores/spaces/SpaceStore";
import { stubClient } from "../../test-utils";

describe("SpaceHierarchyUtils", () => {
    stubClient();

    describe("getSpacePath()", () => {
        let room: Room;
        let space1: Room;
        let space2: Room;

        beforeEach(() => {
            room = new Room("!room:server", {} as any, "@user:server");
            space1 = new Room("!space1:server", {} as any, "@user:server");
            (space1 as any).name = "Space 1";
            space2 = new Room("!space2:server", {} as any, "@user:server");
            (space2 as any).name = "Space 2";

            jest.spyOn(SpaceStore.instance, "getParents").mockImplementation((roomId) => {
                if (roomId === room.roomId) return [space2];
                if (roomId === space2.roomId) return [space1];
                return [];
            });

            jest.spyOn(SpaceStore.instance, "getCanonicalParent").mockReturnValue(null);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("should return the full path for a room", () => {
            const path = getSpacePath(room);
            expect(path).toHaveLength(2);
            expect(path[0].id).toBe(space1.roomId);
            expect(path[1].id).toBe(space2.roomId);
        });

        it("should respect activeSpace relative pruning", () => {
            // If space1 is active, the path should only contain space2
            const path = getSpacePath(room, space1.roomId);
            expect(path).toHaveLength(1);
            expect(path[0].id).toBe(space2.roomId);
        });

        it("should return empty path if room has no parents", () => {
            const path = getSpacePath(space1);
            expect(path).toHaveLength(0);
        });

        it("should detect cycles and stop", () => {
            jest.spyOn(SpaceStore.instance, "getParents").mockImplementation((roomId) => {
                if (roomId === room.roomId) return [space2];
                if (roomId === space2.roomId) return [space1];
                if (roomId === space1.roomId) return [space2]; // Cycle
                return [];
            });

            const path = getSpacePath(room);
            // Should not crash and should contain [space1, space2] once
            expect(path.length).toBeLessThan(5);
        });
    });
});
