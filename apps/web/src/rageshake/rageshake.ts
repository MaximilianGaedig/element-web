/*
Copyright 2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2018 New Vector Ltd
Copyright 2017 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// This module contains all the code needed to log the console, persist it to
// disk and submit bug reports. Rationale is as follows:
//  - Monkey-patching the console is preferable to having a log library because
//    we can catch logs by other libraries more easily, without having to all
//    depend on the same log framework / pass the logger around.
//  - We use IndexedDB to persists logs because it has generous disk space
//    limits compared to local storage. IndexedDB does not work in incognito
//    mode, in which case this module will not be able to write logs to disk.
//    However, the logs will still be stored in-memory, so can still be
//    submitted in a bug report should the user wish to: we can also store more
//    logs in-memory than in local storage, which does work in incognito mode.
//    We also need to handle the case where there are 2+ tabs. Each JS runtime
//    generates a random string which serves as the "ID" for that tab/session.
//    These IDs are stored along with the log lines.
//  - Bug reports are sent as a POST over HTTPS: it purposefully does not use
//    Matrix as bug reports may be made when Matrix is not responsive (which may
//    be the cause of the bug). We send the most recent N MB of UTF-8 log data,
//    starting with the most recent, which we know because the "ID"s are
//    actually timestamps. We then purge the remaining logs. We also do this
//    purge on startup to prevent logs from accumulating.

// the frequency with which we flush to indexeddb
import { logger } from "matrix-js-sdk/src/logger";
import { secureRandomString } from "matrix-js-sdk/src/randomstring";

import { getCircularReplacer } from "../utils/JSON";

const FLUSH_RATE_MS = 30 * 1000;

/** the length of log data we keep in indexeddb (and include in the reports), if there are more than 24 hours of logs */
const MAX_LOG_SIZE = 1024 * 1024 * 5; // 5 MB

/** the length of log data we keep in indexeddb (and include in the reports), if there are less than 24 hours of logs */
const MAX_LOG_SIZE_24H = 1024 * 1024 * 100; // 100 MB

/**
 * The most log text kept in memory. The buffer is trimmed back to this once it is twice as long, oldest lines first.
 *
 * Only a log store drains the buffer, and there is none without IndexedDB or while it is not set up: unbounded, the
 * buffer once reached V8's maximum string length, after which every console call threw "Invalid string length".
 */
export const MAX_IN_MEMORY_LOG_SIZE = 1024 * 1024 * 5; // 5 MB

type LogFunction = (...args: (Error | DOMException | object | string)[]) => void;
const consoleFunctionsToLevels = {
    log: "I",
    info: "I",
    warn: "W",
    error: "E",
    debug: "D",
} as const;
type LogFunctionName = keyof typeof consoleFunctionsToLevels;

// A class which monkey-patches the global console and stores log lines.
export class ConsoleLogger {
    private logs = "";
    private originalFunctions: { [key in LogFunctionName]?: LogFunction } = {};
    /** The console's own functions, unbound, to put back as they were. */
    private unpatchedFunctions: { [key in LogFunctionName]?: LogFunction } = {};
    private patchedConsole?: Console;

    public monkeyPatch(consoleObj: Console): void {
        // Monkey-patch console logging
        (Object.keys(consoleFunctionsToLevels) as LogFunctionName[]).forEach((fnName: LogFunctionName) => {
            const level = consoleFunctionsToLevels[fnName];
            this.unpatchedFunctions[fnName] = consoleObj[fnName];
            const originalFn = consoleObj[fnName].bind(consoleObj);
            this.originalFunctions[fnName] = originalFn;
            consoleObj[fnName] = (...args) => {
                try {
                    this.log(level, ...args);
                } catch {
                    // Keeping a copy of a line must never break the code that logged it.
                }
                originalFn(...args);
            };
        });
        this.patchedConsole = consoleObj;
    }

    /** Put back the console functions replaced by {@link monkeyPatch}, and drop what is buffered. */
    public unpatch(): void {
        const consoleObj = this.patchedConsole;
        if (consoleObj) {
            for (const [fnName, fn] of Object.entries(this.unpatchedFunctions) as [LogFunctionName, LogFunction][]) {
                consoleObj[fnName] = fn;
            }
        }
        this.patchedConsole = undefined;
        this.originalFunctions = {};
        this.unpatchedFunctions = {};
        this.logs = "";
    }

    public bypassRageshake(fnName: LogFunctionName, ...args: (Error | DOMException | object | string)[]): void {
        this.originalFunctions[fnName]?.(...args);
    }

    public log(level: string, ...args: (Error | DOMException | object | string)[]): void {
        // We don't know what locale the user may be running so use ISO strings
        const ts = new Date().toISOString();

        // Convert objects and errors to helpful things
        args = args.map((arg) => {
            if (arg instanceof DOMException) {
                return arg.message + ` (${arg.name} | ${arg.code})`;
            } else if (arg instanceof Error) {
                return arg.message + (arg.stack ? `\n${arg.stack}` : "");
            } else if (typeof arg === "object") {
                return JSON.stringify(arg, getCircularReplacer());
            } else {
                return arg;
            }
        });

        // Some browsers support string formatting which we're not doing here
        // so the lines are a little more ugly but easy to implement / quick to
        // run.
        // Example line:
        // 2017-01-18T11:23:53.214Z W Failed to set badge count
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        let line = `${ts} ${level} ${args.join(" ")}\n`;
        // Do some cleanup
        line = line.replace(/token=[a-zA-Z0-9-]+/gm, "token=xxxxx");
        if (line.length > MAX_IN_MEMORY_LOG_SIZE) {
            line = line.slice(0, MAX_IN_MEMORY_LOG_SIZE) + "\n";
        }
        // Using + really is the quickest way in JS
        // http://jsperf.com/concat-vs-plus-vs-join
        this.logs += line;
        if (this.logs.length > 2 * MAX_IN_MEMORY_LOG_SIZE) {
            this.trim();
        }
    }

    /**
     * Put lines taken by {@link flush} back in front of the buffer, when they could not be written.
     */
    public unflush(lines: string): void {
        this.logs = lines + this.logs;
        if (this.logs.length > 2 * MAX_IN_MEMORY_LOG_SIZE) {
            this.trim();
        }
    }

    /** Drop the oldest lines so that at most {@link MAX_IN_MEMORY_LOG_SIZE} is left, starting at a line. */
    private trim(): void {
        const cut = this.logs.length - MAX_IN_MEMORY_LOG_SIZE;
        const lineStart = this.logs.indexOf("\n", cut);
        this.logs = this.logs.slice(lineStart === -1 ? cut : lineStart + 1);
    }

    /**
     * Retrieve log lines to flush to disk.
     * @param {boolean} keepLogs True to not delete logs after flushing.
     * @returns {string} \n delimited log lines to flush.
     */
    public flush(keepLogs?: boolean): string {
        // The ConsoleLogger doesn't care how these end up on disk, it just
        // flushes them to the caller.
        if (keepLogs) {
            return this.logs;
        }
        const logsToFlush = this.logs;
        this.logs = "";
        return logsToFlush;
    }
}

// A class which stores log lines in an IndexedDB instance.
export class IndexedDBLogStore {
    private id: string;
    private index = 0;
    private db: IDBDatabase | null = null;
    private flushPromise: Promise<void> | null = null;
    private flushAgainPromise: Promise<void> | null = null;
    private flushInterval?: number;

    public constructor(
        private indexedDB: IDBFactory,
        private logger: ConsoleLogger,
    ) {
        this.id = "instance-" + secureRandomString(16);
    }

    /**
     * @returns {Promise} Resolves when the store is ready.
     */
    public connect(): Promise<void> {
        const req = this.indexedDB.open("logs");
        return new Promise((resolve, reject) => {
            req.onsuccess = () => {
                this.db = req.result;
                // The browser may close the connection (storage pressure, the database being deleted).
                this.db.onclose = () => {
                    this.db = null;
                };
                this.db.onversionchange = () => {
                    this.db?.close();
                    this.db = null;
                };
                // Periodically flush logs to local storage / indexeddb. A failed flush has been reported already;
                // the lines stay buffered (bounded) for the next one.
                this.flushInterval = window.setInterval(() => {
                    this.flush().catch(() => {});
                }, FLUSH_RATE_MS);
                resolve();
            };

            req.onerror = () => {
                const err = "Failed to open log database: " + req.error?.name;
                logger.error(err);
                reject(new Error(err));
            };

            // First time: Setup the object store
            req.onupgradeneeded = () => {
                const db = req.result;
                const logObjStore = db.createObjectStore("logs", {
                    keyPath: ["id", "index"],
                });
                // Keys in the database look like: [ "instance-148938490", 0 ]
                // Later on we need to query everything based on an instance id.
                // In order to do this, we need to set up indexes "id".
                logObjStore.createIndex("id", "id", { unique: false });

                logObjStore.add(this.generateLogEntry(new Date() + " ::: Log database was created."));

                const lastModifiedStore = db.createObjectStore("logslastmod", {
                    keyPath: "id",
                });
                lastModifiedStore.add(this.generateLastModifiedTime());
            };
        });
    }

    /**
     * Flush logs to disk.
     *
     * There are guards to protect against race conditions in order to ensure
     * that all previous flushes have completed before the most recent flush.
     * Consider without guards:
     *  - A calls flush() periodically.
     *  - B calls flush() and wants to send logs immediately afterwards.
     *  - If B doesn't wait for A's flush to complete, B will be missing the
     *    contents of A's flush.
     * To protect against this, we set 'flushPromise' when a flush is ongoing.
     * Subsequent calls to flush() during this period will chain another flush,
     * then keep returning that same chained flush.
     *
     * This guarantees that we will always eventually do a flush when flush() is
     * called.
     *
     * @returns {Promise} Resolved when the logs have been flushed.
     */
    public flush(): Promise<void> {
        // check if a flush() operation is ongoing
        if (this.flushPromise) {
            if (this.flushAgainPromise) {
                // this is the 3rd+ time we've called flush() : return the same promise.
                return this.flushAgainPromise;
            }
            // queue up a flush to occur immediately after the pending one completes, whether or not that one worked.
            this.flushAgainPromise = this.flushPromise
                .catch(() => {})
                .then(() => {
                    this.flushAgainPromise = null;
                    return this.flush();
                });
            return this.flushAgainPromise;
        }
        // there is no flush promise or there was but it has finished, so do
        // a brand new one, destroying the chain which may have been built up.
        // A failed flush must not stay in `flushPromise`: every later flush would return it, and nothing would drain
        // the buffer again.
        this.flushPromise = new Promise<void>((resolve, reject) => {
            if (!this.db) {
                // not connected yet or user rejected access for us to r/w to the db.
                reject(new Error("No connected database"));
                return;
            }
            if (this.logger.flush(true).length === 0) {
                resolve();
                return;
            }
            // Open the transaction before taking the lines: it throws if the connection is closing.
            const txn = this.db.transaction(["logs", "logslastmod"], "readwrite");
            const lines = this.logger.flush();
            const objStore = txn.objectStore("logs");
            let failed = false;
            const fail = (): void => {
                if (failed) return;
                failed = true;
                this.logger.unflush(lines);
                logger.error("Failed to flush logs : ", txn.error);
                reject(new Error("Failed to write logs: " + txn.error?.message));
            };
            txn.oncomplete = () => {
                resolve();
            };
            txn.onerror = fail;
            txn.onabort = fail;
            objStore.add(this.generateLogEntry(lines));
            const lastModStore = txn.objectStore("logslastmod");
            lastModStore.put(this.generateLastModifiedTime());
        }).finally(() => {
            this.flushPromise = null;
        });
        return this.flushPromise;
    }

    /** Stop flushing and close the database. */
    public close(): void {
        window.clearInterval(this.flushInterval);
        this.flushInterval = undefined;
        this.db?.close();
        this.db = null;
    }

    /**
     * Consume the most recent logs and return them. Older logs which are not
     * returned are deleted at the same time, so this can be called at startup
     * to do house-keeping to keep the logs from growing too large.
     *
     * @returns {Promise<Object[]>} Resolves to an array of objects. The array is
     * sorted in time (oldest first) based on when the log file was created (the
     * log ID). The objects have said log ID in an "id" field and "lines" which
     * is a big string with all the new-line delimited logs.
     */
    public async consume(): Promise<{ lines: string; id: string }[]> {
        const allLogIds = await this.fetchLogIds();
        let removeLogIds: string[] = [];
        const logs: { lines: string; id: string }[] = [];
        let size = 0;
        for (let i = 0; i < allLogIds.length; i++) {
            const instanceId = allLogIds[i];
            const { lines, truncated } = await this.fetchLogs(instanceId, size);

            // always add the returned logs: fetchLogs will truncate once it hits the size limit,
            // so we'll go over the max but only by one fragment's worth.
            logs.push({ lines, id: instanceId });
            size += lines.length;

            // If fetchLogs truncated we'll now be at or over the size limit,
            // in which case we should stop and remove the rest of the log files.
            if (truncated) {
                logger.log(
                    `rageshake: reached size limit while processing instance ${i + 1}/${
                        allLogIds.length
                    } (${instanceId}), with ${size} bytes of logs: will drop further instances`,
                );
                // the remaining log IDs should be removed. If we go out of
                // bounds this is just []
                removeLogIds = allLogIds.slice(i + 1);
                break;
            }
        }
        if (removeLogIds.length > 0) {
            logger.log(`rageshake: removing logs: ${removeLogIds}`);
            // Don't await this because it's non-fatal if we can't clean up
            // logs.
            Promise.all(removeLogIds.map((id) => this.deleteLogs(id))).then(
                () => {
                    logger.log(`Removed ${removeLogIds.length} old logs.`);
                },
                (err) => {
                    logger.error(err);
                },
            );
        }
        return logs;
    }

    /**
     * Fetch all the application instance names from the database.
     */
    private fetchLogIds(): Promise<string[]> {
        const db = this.db;
        if (!db) return Promise.reject("DB unavailable");

        // To gather all the log IDs, query for all records in logslastmod.
        const o = db.transaction("logslastmod", "readonly").objectStore("logslastmod");
        return selectQuery(o, undefined, (cursor) => {
            return {
                id: cursor.value.id,
                ts: cursor.value.ts,
            };
        }).then((res) => {
            // Sort IDs by timestamp (newest first)
            return res
                .sort((a, b) => {
                    return b.ts - a.ts;
                })
                .map((a) => a.id);
        });
    }

    /**
     * Fetch logs for a given application instance from the database, stopping once we hit the size limit.
     *
     * @param id - Application instance to fetch logs for.
     * @param sizeSoFar - Amount of logs we have already retrieved from other instances.
     *
     * @returns An object with the properties:
     *  * `lines`: the concatenated logs for this ID
     *  * `truncated`: whether the output was truncated due to hitting the size limit.
     */
    private fetchLogs(
        id: string,
        sizeSoFar: number,
    ): Promise<{
        lines: string;
        truncated: boolean;
    }> {
        const db = this.db;
        if (!db) return Promise.reject("DB unavailable");

        const objectStore = db.transaction("logs", "readonly").objectStore("logs");

        /** Determine whether we should stop collecting logs after this batch.
         *
         * @param sizeSoFar - The total amount of logs collected so far.
         * @param logBatchTimestamp - The timestamp of the most recent batch of logs collected.
         *
         * @returns `true` if we should stop after this batch.
         */
        function shouldTruncateAfterLogBatch(sizeSoFar: number, logBatchTimestamp: number): boolean {
            // First check if we have exceeded the absolute limit
            if (sizeSoFar >= MAX_LOG_SIZE_24H) {
                return true;
            }

            // Otherwise, check if the most recent batch is more than 24H old, and we have exceeded the limit for logs over 24H
            if (Date.now() - logBatchTimestamp >= 24 * 3600 * 1000 && sizeSoFar >= MAX_LOG_SIZE) {
                return true;
            }

            // Otherwise, we're good.
            return false;
        }

        return new Promise((resolve, reject) => {
            const query = objectStore.index("id").openCursor(IDBKeyRange.only(id), "prev");
            let lines = "";
            query.onerror = () => {
                reject(new Error("Query failed: " + query.error?.message));
            };
            query.onsuccess = () => {
                const cursor = query.result;
                if (!cursor) {
                    // end of results
                    resolve({ lines, truncated: false });
                    return;
                }
                const newLines = cursor.value.lines;
                // The query returns log chunks in reverse time order, so prepend this new chunk to the buffer.
                lines = newLines + lines;
                sizeSoFar += newLines.length;

                // If we have now exceeded the size limit, stop.
                if (shouldTruncateAfterLogBatch(sizeSoFar, cursor.value.ts ?? 0)) {
                    resolve({ lines, truncated: true });
                } else {
                    cursor.continue();
                }
            };
        });
    }

    /**
     * Delete logs for a given application instance.
     *
     * @param id - Application instance to delete logs for.
     */
    private deleteLogs(id: string): Promise<void> {
        const db = this.db;
        if (!db) return Promise.reject("DB unavailable");

        return new Promise<void>((resolve, reject) => {
            const txn = db.transaction(["logs", "logslastmod"], "readwrite");
            const o = txn.objectStore("logs");
            // only load the key path, not the data which may be huge
            const query = o.index("id").openKeyCursor(IDBKeyRange.only(id));
            query.onsuccess = () => {
                const cursor = query.result;
                if (!cursor) {
                    return;
                }
                o.delete(cursor.primaryKey);
                cursor.continue();
            };
            txn.oncomplete = () => {
                resolve();
            };
            txn.onerror = () => {
                reject(new Error(`Failed to delete logs for '${id}' : ${query.error?.message}`));
            };
            // delete last modified entries
            const lastModStore = txn.objectStore("logslastmod");
            lastModStore.delete(id);
        });
    }

    /** Generate the object to be stored in the `logs` store */
    private generateLogEntry(lines: string): { id: string; lines: string; index: number; ts: number } {
        return {
            id: this.id,
            lines: lines,
            index: this.index++,
            /** The timestamp at which the line was *flushed* (not necessarily when it was written). */
            ts: Date.now(),
        };
    }

    private generateLastModifiedTime(): { id: string; ts: number } {
        return {
            id: this.id,
            ts: Date.now(),
        };
    }
}

/**
 * Helper method to collect results from a Cursor and promiseify it.
 * @param {ObjectStore|Index} store The store to perform openCursor on.
 * @param {IDBKeyRange=} keyRange Optional key range to apply on the cursor.
 * @param {Function} resultMapper A function which is repeatedly called with a
 * Cursor.
 * Return the data you want to keep.
 * @returns {Promise<T[]>} Resolves to an array of whatever you returned from
 * resultMapper.
 */
function selectQuery<T>(
    store: IDBIndex | IDBObjectStore,
    keyRange: IDBKeyRange | undefined,
    resultMapper: (cursor: IDBCursorWithValue) => T,
): Promise<T[]> {
    const query = store.openCursor(keyRange);
    return new Promise((resolve, reject) => {
        const results: T[] = [];
        query.onerror = () => {
            reject(new Error("Query failed: " + query.error?.message));
        };
        // collect results
        query.onsuccess = () => {
            const cursor = query.result;
            if (!cursor) {
                resolve(results);
                return; // end of results
            }
            results.push(resultMapper(cursor));
            cursor.continue();
        };
    });
}

let onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | undefined;

/**
 * Configure rage shaking support for sending bug reports.
 * Modifies globals.
 * @param {boolean} setUpPersistence When true (default), the persistence will
 * be set up immediately for the logs.
 * @returns {Promise} Resolves when set up.
 */
export function init(setUpPersistence = true): Promise<void> {
    if (global.mx_rage_initPromise) {
        return global.mx_rage_initPromise;
    }
    const consoleLogger = new ConsoleLogger();
    global.mx_rage_logger = consoleLogger;
    consoleLogger.monkeyPatch(window.console);

    // log unhandled rejections in the rageshake
    onUnhandledRejection = (event): void => {
        consoleLogger.log("error", `Unhandled promise rejection: ${event.reason}`);
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    if (setUpPersistence) {
        global.mx_rage_initPromise = tryInitStorage();
        return global.mx_rage_initPromise;
    }

    global.mx_rage_initPromise = Promise.resolve();
    return global.mx_rage_initPromise;
}

/** Whether console output is being kept for bug reports. */
export function isEnabled(): boolean {
    return !!global.mx_rage_logger;
}

/**
 * Stop keeping console output: put the console back, drop the in-memory logs and delete the stored ones.
 */
export async function disable(): Promise<void> {
    const hadStore = !!global.mx_rage_store || !!global.mx_rage_initStoragePromise;
    await global.mx_rage_initStoragePromise?.catch(() => {});
    global.mx_rage_logger?.unpatch();
    global.mx_rage_store?.close();
    if (onUnhandledRejection) {
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
        onUnhandledRejection = undefined;
    }
    global.mx_rage_logger = undefined;
    global.mx_rage_store = undefined;
    global.mx_rage_initPromise = undefined;
    global.mx_rage_initStoragePromise = undefined;

    if (hadStore) {
        await deleteLogDatabase();
    }
}

function deleteLogDatabase(): Promise<void> {
    let indexedDB: IDBFactory | undefined;
    try {
        indexedDB = window.indexedDB;
    } catch {}
    if (!indexedDB) return Promise.resolve();
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("logs");
        // Another tab may still hold it open: the deletion then waits for that tab, so do not wait here.
        req.onsuccess = req.onerror = req.onblocked = (): void => resolve();
    });
}

/**
 * Try to start up the rageshake storage for logs. If not possible (client unsupported)
 * then this no-ops.
 * @returns {Promise} Resolves when complete.
 */
export function tryInitStorage(): Promise<void> {
    if (global.mx_rage_initStoragePromise) {
        return global.mx_rage_initStoragePromise;
    }
    const consoleLogger = global.mx_rage_logger;
    if (!consoleLogger) {
        // Logging is off: there is nothing to store.
        return Promise.resolve();
    }

    logger.log("Configuring rageshake persistence...");

    // just *accessing* indexedDB throws an exception in firefox with
    // indexeddb disabled.
    let indexedDB;
    try {
        indexedDB = window.indexedDB;
    } catch {}

    if (indexedDB) {
        const store = new IndexedDBLogStore(indexedDB, consoleLogger);
        global.mx_rage_store = store;
        global.mx_rage_initStoragePromise = store.connect();

        // Fire off a task in the background which will clean up old logs in the store
        void global.mx_rage_initStoragePromise.then(() => {
            store.consume().catch((e) => {
                logger.error("Error cleaning up rageshake store", e);
            });
        });

        return global.mx_rage_initStoragePromise;
    }
    global.mx_rage_initStoragePromise = Promise.resolve();
    return global.mx_rage_initStoragePromise;
}

export function flush(): void {
    if (!global.mx_rage_store) {
        return;
    }
    global.mx_rage_store.flush().catch(() => {});
}

/**
 * Clean up old logs.
 *
 * @deprecated There is no need to call this explicitly: it will be done as a side-effect of {@link tryInitStorage},
 * or {@link init} with `setUpPersistence: true`.
 *
 * @returns {Promise} Resolves if cleaned logs.
 */
export async function cleanup(): Promise<void> {
    if (!global.mx_rage_store) {
        return;
    }
    await global.mx_rage_store.consume();
}

/**
 * Get a recent snapshot of the logs, ready for attaching to a bug report
 *
 * @returns {Array<{lines: string, id, string}>}  list of log data; empty while diagnostic logging is off
 */
export async function getLogsForReport(): Promise<{ lines: string; id: string }[]> {
    if (!global.mx_rage_logger) {
        // Diagnostic logging is off, so there are no logs to send.
        return [];
    }
    // If in incognito mode, store is null, but we still want bug report
    // sending to work going off the in-memory console logs.
    if (global.mx_rage_store) {
        // flush most recent logs
        try {
            await global.mx_rage_store.flush();
            return await global.mx_rage_store.consume();
        } catch (e) {
            logger.warn("rageshake: could not read the stored logs, sending the in-memory ones", e);
        }
    }
    return [
        {
            lines: global.mx_rage_logger.flush(true),
            id: "-",
        },
    ];
}
