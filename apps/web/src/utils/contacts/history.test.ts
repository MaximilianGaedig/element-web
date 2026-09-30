/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    HISTORY_EVENT_TYPE,
    KEEP,
    KEEP_BYTES,
    type Revision,
    changedFields,
    deleteRevision,
    forgetHistory,
    historyFor,
    recordRevision,
} from "./history";
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

/** A client whose account data is whatever was last written to it, as the real one behaves after a sync. */
function clientWith(history: Record<string, Revision[]> = {}): MatrixClient {
    let content: unknown = { history };
    return {
        getAccountData: (type: string) => (type === HISTORY_EVENT_TYPE ? { getContent: () => content } : undefined),
        setAccountData: vi.fn(async (_type: string, next: unknown) => {
            content = next;
        }),
    } as unknown as MatrixClient;
}

const revision = (ts: number, was = {}): Revision => ({ ts, source: "edit", was });

describe("a contact's history", () => {
    it("is found through whichever of their accounts it was kept against", () => {
        const client = clientWith({ "@ada:e": [revision(1, { firstName: "Ada" })] });
        expect(historyFor(client, person("@tg_ada:e", "@ada:e"))).toHaveLength(1);
    });

    /* Versions, newest first: the stack a password manager keeps, not a log to read forwards. */
    it("puts the previous version on top", async () => {
        const client = clientWith({ "@ada:e": [revision(1, { firstName: "Ada" })] });
        await recordRevision(client, person("@ada:e"), { firstName: "Augusta" }, "import");
        const history = historyFor(client, person("@ada:e"));
        expect(history[0]).toMatchObject({ source: "import", was: { firstName: "Augusta" } });
        expect(history[1].was).toEqual({ firstName: "Ada" });
    });

    /* A save that changed nothing must not push a real version out of a bounded window. */
    it("records nothing when the card did not change", async () => {
        const client = clientWith({ "@ada:e": [revision(1, { firstName: "Ada" })] });
        await recordRevision(client, person("@ada:e"), { firstName: "Ada" }, "edit");
        expect(client.setAccountData).not.toHaveBeenCalled();
    });

    it("keeps the record against every one of their accounts, so unmerging does not lose it", async () => {
        const client = clientWith();
        await recordRevision(client, person("@tg_ada:e", "@wa_ada:e"), { firstName: "Ada" }, "merge");
        expect(historyFor(client, person("@wa_ada:e"))).toHaveLength(1);
        expect(historyFor(client, person("@tg_ada:e"))).toHaveLength(1);
    });

    it("drops the oldest past the count it keeps", async () => {
        const client = clientWith({
            "@ada:e": Array.from({ length: KEEP }, (_, index) => revision(KEEP - index, { nickname: `v${index}` })),
        });
        await recordRevision(client, person("@ada:e"), { nickname: "newest" }, "edit");
        const history = historyFor(client, person("@ada:e"));
        expect(history).toHaveLength(KEEP);
        expect(history[0].was).toEqual({ nickname: "newest" });
        // The one that was last is the one that went.
        expect(history.some((one) => (one.was as { nickname?: string }).nickname === `v${KEEP - 1}`)).toBe(false);
    });

    /*
     * The size bound, which the count alone does not give: this is account data, synced to every device on
     * every login, and a card with a long note pasted into it reaches the event size limit well inside twenty
     * versions.
     */
    it("drops the oldest past the bytes it keeps, whatever the count", async () => {
        const big = { notes: "x".repeat(KEEP_BYTES / 4) };
        const client = clientWith({ "@ada:e": [revision(3, big), revision(2, big), revision(1, big)] });
        await recordRevision(client, person("@ada:e"), { ...big, nickname: "newest" }, "edit");
        const history = historyFor(client, person("@ada:e"));
        expect(history.length).toBeLessThan(4);
        expect(JSON.stringify(history).length).toBeLessThanOrEqual(KEEP_BYTES);
    });

    /* Better one version too big than none: the version with the note is the one somebody wants back. */
    it("keeps the newest version even when it is bigger than the bound on its own", async () => {
        const client = clientWith();
        await recordRevision(client, person("@ada:e"), { notes: "x".repeat(KEEP_BYTES * 2) }, "edit");
        expect(historyFor(client, person("@ada:e"))).toHaveLength(1);
    });

    describe("throwing versions away", () => {
        it("removes just the one asked for", async () => {
            const client = clientWith({ "@ada:e": [revision(3), revision(2), revision(1)] });
            await deleteRevision(client, person("@ada:e"), 2);
            expect(historyFor(client, person("@ada:e")).map((one) => one.ts)).toEqual([3, 1]);
        });

        it("writes nothing when there is no such version", async () => {
            const client = clientWith({ "@ada:e": [revision(3)] });
            await deleteRevision(client, person("@ada:e"), 9);
            expect(client.setAccountData).not.toHaveBeenCalled();
        });

        /* An empty list left behind under their ID would make the card show a history section with nothing
           in it, and would be synced for as long as the account exists. */
        it("leaves nothing behind when the last version goes", async () => {
            const client = clientWith({ "@ada:e": [revision(3)] });
            await deleteRevision(client, person("@ada:e"), 3);
            expect(client.setAccountData).toHaveBeenCalledWith(HISTORY_EVENT_TYPE, { history: {} });
        });

        it("empties the lot on request, for every account of theirs", async () => {
            const client = clientWith({ "@tg_ada:e": [revision(1)], "@wa_ada:e": [revision(1)] });
            await forgetHistory(client, person("@tg_ada:e", "@wa_ada:e"));
            expect(historyFor(client, person("@tg_ada:e", "@wa_ada:e"))).toEqual([]);
        });
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
