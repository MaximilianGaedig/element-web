/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { act, fireEvent, render } from "test-utils-rtl";
import { stubClient } from "test-utils";

import { useDragSelect } from "./NewTimelinePanel";
import { MessageSelectionStore } from "../../stores/MessageSelectionStore";

const ROOM = "!r:x";
const IDS = ["$a", "$b", "$c", "$d"];

describe("useDragSelect", () => {
    const client = stubClient();
    const room = new Room(ROOM, client, client.getSafeUserId());
    IDS.forEach((id, i) =>
        room.getUnfilteredTimelineSet().addLiveEvent(
            new MatrixEvent({
                type: "m.room.message",
                event_id: id,
                room_id: ROOM,
                sender: "@ada:x",
                origin_server_ts: i,
                content: { msgtype: "m.text", body: id },
            }),
            { addToState: false },
        ),
    );

    function Rows(): React.ReactNode {
        const ref = useRef<HTMLDivElement | null>(null);
        useDragSelect(ref, room, client, MessageSelectionStore.instance.isSelecting(ROOM));
        return (
            <div ref={ref}>
                {IDS.map((id) => (
                    <div key={id} data-event-id={id} data-testid={id} />
                ))}
            </div>
        );
    }

    afterEach(() => {
        act(() => MessageSelectionStore.instance.exitSelectionMode(ROOM));
        vi.restoreAllMocks();
    });

    /* Picking ten messages took ten clicks; Telegram takes one drag. */
    it("takes in every message dragged across, and the first decides ticking or unticking", () => {
        MessageSelectionStore.instance.enterSelectionMode(ROOM, "$d");
        const { getByTestId } = render(<Rows />);
        const over = vi.spyOn(document, "elementFromPoint");

        fireEvent.pointerDown(getByTestId("$a"), { button: 0, pointerType: "mouse", clientX: 0, clientY: 0 });
        over.mockReturnValue(getByTestId("$c"));
        fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
        fireEvent.pointerUp(window);

        expect(MessageSelectionStore.instance.getSelectedIds(ROOM).sort()).toEqual(["$a", "$b", "$c", "$d"]);

        // From a picked one, the drag unticks.
        fireEvent.pointerDown(getByTestId("$b"), { button: 0, pointerType: "mouse", clientX: 0, clientY: 20 });
        over.mockReturnValue(getByTestId("$c"));
        fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
        fireEvent.pointerUp(window);

        expect(MessageSelectionStore.instance.getSelectedIds(ROOM).sort()).toEqual(["$a", "$d"]);
    });
});
