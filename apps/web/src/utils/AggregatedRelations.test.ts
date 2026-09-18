/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { type MatrixEvent, MatrixEventEvent, Relations, RelationsEvent } from "matrix-js-sdk/src/matrix";

import { AggregatedRelations } from "./AggregatedRelations";
import { mkEvent, stubClient } from "test-utils";

const ROOM = "!room:example.org";

function mkReaction(target: string, key: string, sender: string): MatrixEvent {
    return mkEvent({
        event: true,
        type: "m.reaction",
        room: ROOM,
        user: sender,
        content: { "m.relates_to": { rel_type: "m.annotation", event_id: target, key } },
    });
}

function mkImage(id: string): MatrixEvent {
    return mkEvent({
        event: true,
        type: "m.room.message",
        room: ROOM,
        user: "@alice:example.org",
        id,
        content: { msgtype: "m.image", body: "a.jpg", url: "mxc://a/b" },
    });
}

describe("AggregatedRelations", () => {
    const client = stubClient();
    let store: Map<string, Relations>;
    const getBase = (eventId: string, relType: string, eventType: string): Relations | undefined =>
        relType === "m.annotation" && eventType === "m.reaction" ? store.get(eventId) : undefined;

    beforeEach(() => {
        store = new Map();
    });

    async function react(target: MatrixEvent, key: string, sender: string): Promise<MatrixEvent> {
        let relations = store.get(target.getId()!);
        const created = !relations;
        if (!relations) {
            relations = new Relations("m.annotation", "m.reaction", client);
            store.set(target.getId()!, relations);
        }
        const reaction = mkReaction(target.getId()!, key, sender);
        await relations.addEvent(reaction);
        if (created) target.emit(MatrixEventEvent.RelationsCreated, "m.annotation", "m.reaction");
        return reaction;
    }

    it("merges reactions of all items, keyed and by sender", async () => {
        const a = mkImage("$a");
        const b = mkImage("$b");
        await react(a, "👍", "@x:s");
        await react(b, "👍", "@y:s");
        await react(b, "🎉", "@x:s");

        const agg = new AggregatedRelations(getBase);
        agg.setItems([a, b]);

        const byKey = agg.getSortedAnnotationsByKey()!;
        expect(byKey.map(([k, evs]) => [k, evs.size])).toEqual([
            ["👍", 2],
            ["🎉", 1],
        ]);
        const bySender = agg.getAnnotationsBySender()!;
        expect(bySender["@x:s"].size).toBe(2);
        expect(bySender["@y:s"].size).toBe(1);
        expect(agg.getRelations()).toHaveLength(3);
    });

    it("emits when any item gains a reaction, including items without reactions yet", async () => {
        const a = mkImage("$a");
        const b = mkImage("$b");
        const agg = new AggregatedRelations(getBase);
        agg.setItems([a, b]);
        expect(agg.getSortedAnnotationsByKey()).toBeNull();

        const onChange = vi.fn();
        agg.on(RelationsEvent.Add, onChange);
        await react(b, "❤️", "@x:s");
        expect(onChange).toHaveBeenCalled();
        expect(agg.getSortedAnnotationsByKey()!.map(([k]) => k)).toEqual(["❤️"]);

        onChange.mockClear();
        await react(b, "❤️", "@y:s");
        expect(onChange).toHaveBeenCalled();
    });

    it("drops the reactions of removed (e.g. redacted) items", async () => {
        const a = mkImage("$a");
        const b = mkImage("$b");
        await react(a, "👍", "@x:s");
        await react(b, "😂", "@x:s");
        const agg = new AggregatedRelations(getBase);
        agg.setItems([a, b]);
        const onChange = vi.fn();
        agg.on(RelationsEvent.Add, onChange);

        agg.setItems([a]);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(agg.getSortedAnnotationsByKey()!.map(([k]) => k)).toEqual(["👍"]);

        // same items again: no spurious change
        agg.setItems([a]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
