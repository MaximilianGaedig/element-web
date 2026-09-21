/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import { type Detected } from "./entities";

/**
 * An arrangement still to come, relative to whenever this runs.
 *
 * Not a fixed date: "what is coming" is a comparison with now, so a literal in the test passes until the
 * day it is written about and then fails for a reason that has nothing to do with the code.
 */
const soon = (): Date => new Date(Date.now() + 24 * 60 * 60 * 1000);

function fakeEvent(id: string, ts = Date.now()): any {
    return {
        getId: () => id,
        getRoomId: () => "!room:example.org",
        getTs: () => ts,
        getSender: () => "@ania:example.org",
    };
}

const aDate = (start = 0, date = soon()): Detected =>
    ({ kind: "datetime", text: "jutro o 18:00", start, end: start + 13, date, hasTime: true }) as Detected;

const aParcel = (start = 0): Detected =>
    ({
        kind: "parcel",
        text: "00159812345678901234",
        start,
        end: start + 20,
        carrier: "InPost",
        url: "https://inpost.pl/x",
    }) as Detected;

/**
 * A fresh module (and so a fresh handle) per test, against a fresh in-memory database.
 *
 * `self` is set as well as `indexedDB`, because that is how the app reaches the factory
 * (utils/StorageAccess.ts, which prefers `self` so that service workers work). In a browser `self` is
 * always there; here it is not declared at all, and merely naming it throws a ReferenceError straight
 * into that helper's own catch - so without this the store quietly has no database and every one of
 * these tests passes or fails for the wrong reason.
 */
async function freshStore(): Promise<typeof import("./collected")> {
    vi.resetModules();
    const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
    const factory = new IDBFactory();
    (globalThis as any).self = globalThis;
    (globalThis as any).indexedDB = factory;
    // A browser has this as a global; node does not, and the store uses it as one, as browser code does.
    (globalThis as any).IDBKeyRange = IDBKeyRange;
    return import("./collected");
}

describe("what the chats turned out to contain", () => {
    let store: typeof import("./collected");
    const me = "@me:example.org";

    beforeEach(async () => {
        store = await freshStore();
    });

    it("keeps what was found and reads it back by kind", async () => {
        await store.remember(me, fakeEvent("$one"), [aParcel()]);
        const parcels = await store.collectedOf(me, "parcel");
        expect(parcels).toHaveLength(1);
        expect(parcels[0]).toMatchObject({
            event: "$one",
            room: "!room:example.org",
            kind: "parcel",
            extra: "InPost",
            text: "00159812345678901234",
        });
    });

    it("sorts arrangements by when they are, and keeps the ones that have passed apart", async () => {
        const sooner = new Date(Date.now() + 60 * 60 * 1000);
        const later = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const gone = new Date(Date.now() - 48 * 60 * 60 * 1000);
        await store.remember(me, fakeEvent("$a"), [aDate(0, later)]);
        await store.remember(me, fakeEvent("$b"), [aDate(0, sooner)]);
        await store.remember(me, fakeEvent("$c"), [aDate(0, gone)]);

        // What is coming, soonest first - and nothing that has already happened.
        const coming = await store.collectedOf(me, "datetime");
        expect(coming.map((row) => row.event)).toEqual(["$b", "$a"]);

        const past = await store.collectedOf(me, "datetime", { past: true });
        expect(past.map((row) => row.event)).toEqual(["$c"]);
    });

    it("holds several findings from one message apart", async () => {
        await store.remember(me, fakeEvent("$both"), [aDate(0), aParcel(40)]);
        expect(await store.collectedOf(me, "datetime")).toHaveLength(1);
        expect(await store.collectedOf(me, "parcel")).toHaveLength(1);
    });

    it("counts a message with nothing in it as read, so it is never read again", async () => {
        // The bug this guards: "have we read this?" answered by looking for rows about it is "no" forever
        // for the great majority of messages, and the sweep then reads the whole history on every start.
        await store.remember(me, fakeEvent("$empty"), []);
        expect(await store.unread(me, ["$empty"])).toEqual([]);
        expect(await store.unread(me, ["$never"])).toEqual(["$never"]);
    });

    it("lets a redacted message take its findings with it", async () => {
        await store.remember(me, fakeEvent("$gone"), [aParcel()]);
        expect(await store.collectedOf(me, "parcel")).toHaveLength(1);
        await store.forget(me, "$gone");
        expect(await store.collectedOf(me, "parcel")).toEqual([]);
    });

    it("keeps one account's findings out of another's", async () => {
        await store.remember(me, fakeEvent("$mine"), [aParcel()]);
        expect(await store.collectedOf("@someone-else:example.org", "parcel")).toEqual([]);
    });

    it("says how many of each kind there are", async () => {
        await store.remember(me, fakeEvent("$one"), [aParcel()]);
        await store.remember(me, fakeEvent("$two"), [aDate()]);
        expect(await store.counts(me)).toMatchObject({ parcel: 1, datetime: 1 });
    });
});
