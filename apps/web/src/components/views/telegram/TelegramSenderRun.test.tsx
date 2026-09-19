/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import EventTile from "../rooms/EventTile";
import { groupSenderRuns, TelegramSenderRun } from "./TelegramSenderRun";

const ME = "@me:x";
const room = { getMember: () => null } as unknown as Room;
let n = 0;

function tile(sender: string, continuation: boolean, type = "m.room.message"): ReactElement {
    const ev = new MatrixEvent({
        type,
        event_id: `$e${++n}`,
        room_id: "!r:x",
        sender,
        origin_server_ts: n,
        content: { msgtype: "m.text", body: "hi" },
    });
    return <EventTile key={ev.getId()} mxEvent={ev} continuation={continuation} />;
}

function runsOf(nodes: React.ReactNode[]): Array<string[] | string> {
    return nodes.map((node) => {
        const el = node as ReactElement<any>;
        if (el.type === TelegramSenderRun)
            return el.props.tiles.map((t: ReactElement<any>) => t.props.mxEvent.getSender());
        return el.type === EventTile ? `own:${el.props.mxEvent.getSender()}` : "other";
    });
}

describe("groupSenderRuns", () => {
    it("groups consecutive incoming messages of one sender, like tweb's bubble groups", () => {
        const separator = <li key="sep">date</li>;
        const nodes = [
            tile("@a:x", false),
            tile("@a:x", true),
            tile("@b:x", true), // another sender starts a new group even if Element calls it a continuation
            tile(ME, false), // our own messages have no avatar
            tile("@b:x", false),
            separator, // anything that isn't a tile ends the group
            tile("@b:x", true),
        ];
        expect(runsOf(groupSenderRuns(nodes, ME, room))).toEqual([
            ["@a:x", "@a:x"],
            ["@b:x"],
            `own:${ME}`,
            ["@b:x"],
            "other",
            ["@b:x"],
        ]);
    });

    it("starts a new group where Element ends the continuation (e.g. a long pause)", () => {
        const runs = runsOf(groupSenderRuns([tile("@a:x", false), tile("@a:x", false)], ME, room));
        expect(runs).toEqual([["@a:x"], ["@a:x"]]);
    });

    it("leaves state events out of groups", () => {
        const runs = runsOf(groupSenderRuns([tile("@a:x", false, "m.room.topic")], ME, room));
        expect(runs).toEqual(["own:@a:x"]);
    });

    it("gives the group every tile's scroll token", () => {
        const [run] = groupSenderRuns([tile("@a:x", false), tile("@a:x", true)], ME, room) as ReactElement<any>[];
        const ids = run.props.tiles.map((t: ReactElement<any>) => t.props.mxEvent.getId());
        expect(ids).toHaveLength(2);
    });
});
