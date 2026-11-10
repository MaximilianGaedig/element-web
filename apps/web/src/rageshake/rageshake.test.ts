/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, afterEach } from "vitest";

import { ConsoleLogger, IndexedDBLogStore } from "./rageshake";

/** A stand-in for `window.console` whose methods record their calls. */
function makeConsole(): Console {
    return {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    } as unknown as Console;
}

describe("ConsoleLogger", () => {
    it("keeps the in-memory buffer bounded when nothing flushes it", () => {
        // Without a log store (no IndexedDB, or none set up) nothing ever drains the buffer. On 2026-11-09 it reached
        // V8's maximum string length and every console call then threw "Invalid string length".
        const logger = new ConsoleLogger();
        const line = "x".repeat(1024 * 1024);
        for (let i = 0; i < 40; i++) {
            logger.log("I", `line ${i} ${line}`);
        }

        const logs = logger.flush(true);
        expect(logs.length).toBeLessThan(20 * 1024 * 1024);
        // The newest lines are the ones kept, cut at a line boundary.
        expect(logs).toContain("line 39 ");
        expect(logs).not.toContain("line 0 ");
        expect(logs.startsWith("20")).toBe(true);
    });

    it("never throws into the code that called console", () => {
        const fakeConsole = makeConsole();
        const original = fakeConsole.log;
        const logger = new ConsoleLogger();
        logger.monkeyPatch(fakeConsole);

        const unserialisable = {
            toJSON(): never {
                throw new RangeError("Invalid string length");
            },
        };
        expect(() => fakeConsole.log("pagination", unserialisable)).not.toThrow();
        // The message still reaches the real console.
        expect(original).toHaveBeenCalledWith("pagination", unserialisable);
    });

    it("puts the original console functions back when unpatched", () => {
        const fakeConsole = makeConsole();
        const original = fakeConsole.warn;
        const logger = new ConsoleLogger();
        logger.monkeyPatch(fakeConsole);
        expect(fakeConsole.warn).not.toBe(original);

        logger.unpatch();
        expect(fakeConsole.warn).toBe(original);
        fakeConsole.warn("after");
        expect(logger.flush()).toBe("");
    });
});

describe("IndexedDBLogStore", () => {
    let store: IndexedDBLogStore | undefined;
    afterEach(() => {
        store?.close();
        store = undefined;
    });

    it("keeps flushing after one flush fails", async () => {
        const logger = new ConsoleLogger();
        store = new IndexedDBLogStore(new IDBFactory(), logger);
        await store.connect();

        // A browser can close the connection under storage pressure; the next transaction() then throws.
        const db = (store as unknown as { db: IDBDatabase }).db;
        const transaction = vi.spyOn(db, "transaction").mockImplementationOnce(() => {
            throw new DOMException("The database connection is closing.", "InvalidStateError");
        });

        logger.log("I", "first");
        await expect(store.flush()).rejects.toThrow();

        // Before the fix the rejected flush stayed in `flushPromise`, so every later flush returned it and the
        // buffer was never drained again.
        logger.log("I", "second");
        await expect(store.flush()).resolves.toBeUndefined();
        expect(logger.flush(true)).toBe("");
        transaction.mockRestore();

        const stored = (await store.consume()).map((l) => l.lines).join("");
        expect(stored).toContain("second");
        // The lines of the failed flush were not dropped.
        expect(stored).toContain("first");
    });
});
