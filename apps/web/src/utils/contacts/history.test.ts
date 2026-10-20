/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Revision, changedFields, historyFor, loadHistory } from "./history";
import { LEGACY_HISTORY_TYPE } from "./addressBook";
import { type Person } from "./people";

const person = (...mxids: string[]): Person =>
    ({
        id: "p",
        name: "Ada",
        accounts: mxids.map((mxid) => ({ mxid })),
        keys: [],
        rooms: [],
        saved: false,
        details: [],
    }) as unknown as Person;

/** A client that has not moved its cards yet: the history is the old account data event. */
function legacyClient(history: Record<string, Revision[]> = {}): MatrixClient {
    return {
        getAccountData: (type: string) =>
            type === LEGACY_HISTORY_TYPE ? { getContent: () => ({ history }) } : undefined,
    } as unknown as MatrixClient;
}

const revision = (ts: number, was = {}): Revision => ({ ts, source: "edit", was });

/* The room-backed history (saves, deleting, emptying) is tested with the room, in addressBook.test.ts. */
describe("a contact's history before the move", () => {
    it("is found through whichever of their accounts it was kept against", async () => {
        const client = legacyClient({ "@ada:e": [revision(1, { firstName: "Ada" })] });
        expect(historyFor(client, person("@tg_ada:e", "@ada:e"))).toHaveLength(1);
        expect(await loadHistory(client, person("@tg_ada:e", "@ada:e"))).toHaveLength(1);
    });

    it("is empty for somebody with none", () => {
        expect(historyFor(legacyClient(), person("@ada:e"))).toEqual([]);
    });
});

describe("what changed between two versions", () => {
    it("names the fields and not the values", () => {
        expect(changedFields({ firstName: "Ada", nickname: "A" }, { firstName: "Augusta", nickname: "A" })).toEqual([
            "firstName",
        ]);
    });

    it("counts a field that appeared and one that went", () => {
        expect(changedFields({ nickname: "A" }, { notes: "hi" }).sort()).toEqual(["nickname", "notes"]);
    });
});
