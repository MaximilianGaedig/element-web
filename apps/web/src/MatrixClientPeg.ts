/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2023 The Matrix.org Foundation C.I.C.
Copyright 2017, 2018 , 2019 New Vector Ltd
Copyright 2017 Vector Creations Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { BACKFILL_EVENT_TYPE } from "./utils/chatHistory";
import { BRIDGE_LOGIN_EVENT_TYPE } from "./utils/bridgeLogins";
import { ROOM_LIST_STATE_TYPES } from "./utils/sync/roomListState";
import { forgetLegacySyncStore, SlidingSyncCacheStore } from "./utils/sync/slidingSyncCache";
import { rememberSlidingSyncSupport } from "./utils/createMatrixClient";
import { setSlidingSyncActive } from "./utils/sync/slidingSyncActive";
import { type IStartClientOpts, type MatrixClient, MemoryStore, PendingEventOrdering } from "matrix-js-sdk/src/matrix";
import * as utils from "matrix-js-sdk/src/utils";
import { logger } from "matrix-js-sdk/src/logger";
import type { X509ClientInitOpts } from "@element-hq/element-web-module-api";

import SettingsStore from "./settings/SettingsStore";
import MatrixActionCreators from "./actions/MatrixActionCreators";
import Modal from "./Modal";
import MatrixClientBackedSettingsHandler from "./settings/handlers/MatrixClientBackedSettingsHandler";
import * as StorageManager from "./utils/StorageManager";
import { SlidingSyncManager } from "./SlidingSyncManager";
import { _t, UserFriendlyError } from "./languageHandler";
import MatrixClientBackedController from "./settings/controllers/MatrixClientBackedController";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import PlatformPeg from "./PlatformPeg";
import SdkConfig from "./SdkConfig";
import { setDeviceIsolationMode } from "./settings/controllers/DeviceIsolationModeController.ts";
import { initialiseDehydrationIfEnabled } from "./utils/device/dehydration";
import { historyIndexer } from "./utils/history/indexer";
import { bootMark, savedSyncSize } from "./utils/bootTimings";

export interface MatrixClientPegAssignOpts {
    /**
     * If we are using Rust crypto, a key with which to encrypt the indexeddb.
     *
     * If provided, it must be exactly 32 bytes of data. If both this and
     * {@link MatrixClientPegAssignOpts.rustCryptoStorePassword} are undefined,
     * the store will be unencrypted.
     */
    rustCryptoStoreKey?: Uint8Array;

    /**
     * If we are using Rust crypto, a password which will be used to derive a key to encrypt the store with.
     *
     * An alternative to {@link MatrixClientPegAssignOpts.rustCryptoStoreKey}. Ignored if `rustCryptoStoreKey` is set.
     *
     * Deriving a key from a password is (deliberately) a slow operation, so prefer to pass a `rustCryptoStoreKey`
     * directly where possible.
     */
    rustCryptoStorePassword?: string;

    /**
     * Options for X.509 signing.
     */
    x509?: X509ClientInitOpts;
}

/**
 * Holds the current instance of the `MatrixClient` to use across the codebase.
 * Looking for an `MatrixClient`? Just look for the `MatrixClientPeg` on the peg
 * board. "Peg" is the literal meaning of something you hang something on. So
 * you'll find a `MatrixClient` hanging on the `MatrixClientPeg`.
 */
export interface IMatrixClientPeg {
    /**
     * The opts used to start the client
     */
    opts: IStartClientOpts;

    /**
     * Get the current MatrixClient, if any
     */
    get(): MatrixClient | null;

    /**
     * Get the current MatrixClient, throwing an error if there isn't one
     */
    safeGet(): MatrixClient;

    /**
     * Sets the current MatrixClient.
     * @param client The MatrixClient instance to set
     */
    set(client: MatrixClient): void;

    /**
     * Unset the current MatrixClient
     */
    unset(): void;

    /**
     * Prepare the MatrixClient for use, including initialising the store and crypto, but do not start it.
     */
    assign(opts?: MatrixClientPegAssignOpts): Promise<IStartClientOpts>;

    /**
     * Prepare the MatrixClient for use, including initialising the store and crypto, and start it.
     */
    start(opts?: MatrixClientPegAssignOpts): Promise<void>;

    /**
     * If we've registered a user ID we set this to the ID of the
     * user we've just registered. If they then go & log in, we
     * can send them to the welcome user (obviously this doesn't
     * guarantee they'll get a chat with the welcome user).
     *
     * @param {string} uid The user ID of the user we've just registered
     */
    setJustRegisteredUserId(uid: string | null): void;

    /**
     * Returns true if the current user has just been registered by this
     * client as determined by setJustRegisteredUserId()
     *
     * @returns {bool} True if user has just been registered
     */
    currentUserIsJustRegistered(): boolean;

    /**
     * If the current user has been registered by this device then this
     * returns a boolean of whether it was within the last N hours given.
     */
    userRegisteredWithinLastHours(hours: number): boolean;

    /**
     * If the current user has been registered by this device then this
     * returns a boolean of whether it was after a given timestamp.
     */
    userRegisteredAfter(date: Date): boolean;
}

/**
 * Wrapper object for handling the js-sdk Matrix Client object in the react-sdk
 * Handles the creation/initialisation of client objects.
 * This module provides a singleton instance of this class so the 'current'
 * Matrix Client object is available easily.
 */
class MatrixClientPegClass implements IMatrixClientPeg {
    // These are the default options used when when the
    // client is started in 'start'. These can be altered
    // at any time up to after the 'will_start_client'
    // event is finished processing.
    public opts: IStartClientOpts = {
        initialSyncLimit: 20,
    };

    private matrixClient: MatrixClient | null = null;
    private justRegisteredUserId: string | null = null;

    public get(): MatrixClient | null {
        return this.matrixClient;
    }

    public safeGet(): MatrixClient {
        if (!this.matrixClient) {
            throw new UserFriendlyError("error_user_not_logged_in");
        }
        return this.matrixClient;
    }

    public set(client: MatrixClient): void {
        this.matrixClient = client;
    }

    public unset(): void {
        this.matrixClient = null;
        setSlidingSyncActive(false);

        MatrixActionCreators.stop();
    }

    public setJustRegisteredUserId(uid: string | null): void {
        this.justRegisteredUserId = uid;
        if (uid) {
            const registrationTime = Date.now().toString();
            window.localStorage.setItem("mx_registration_time", registrationTime);
        }
    }

    public currentUserIsJustRegistered(): boolean {
        return !!this.matrixClient && this.matrixClient.credentials.userId === this.justRegisteredUserId;
    }

    public userRegisteredWithinLastHours(hours: number): boolean {
        if (hours <= 0) {
            return false;
        }

        try {
            const registrationTime = parseInt(window.localStorage.getItem("mx_registration_time")!, 10);
            const diff = Date.now() - registrationTime;
            return diff / 36e5 <= hours;
        } catch {
            return false;
        }
    }

    public userRegisteredAfter(timestamp: Date): boolean {
        try {
            const registrationTime = parseInt(window.localStorage.getItem("mx_registration_time")!, 10);
            return timestamp.getTime() <= registrationTime;
        } catch {
            return false;
        }
    }

    private onUnexpectedStoreClose = async (): Promise<void> => {
        if (!this.matrixClient) return;
        this.matrixClient.stopClient(); // stop the client as the database has failed
        void this.matrixClient.store.destroy();

        if (!this.matrixClient.isGuest()) {
            // If the user is not a guest then prompt them to reload rather than doing it for them
            // For guests this is likely to happen during e-mail verification as part of registration

            const brand = SdkConfig.get().brand;
            const platform = PlatformPeg.get()?.getHumanReadableName();

            // Determine the description based on the platform
            const description =
                platform === "Web Platform"
                    ? _t("error_database_closed_description|for_web", { brand })
                    : _t("error_database_closed_description|for_desktop");

            const [reload] = await Modal.createDialog(ErrorDialog, {
                title: _t("error_database_closed_title", { brand }),
                description,
                button: _t("action|reload"),
            }).finished;

            if (!reload) return;
        }

        PlatformPeg.get()?.reload();
    };

    /**
     * Implementation of {@link IMatrixClientPeg.assign}.
     */
    public async assign(assignOpts: MatrixClientPegAssignOpts = {}): Promise<IStartClientOpts> {
        if (!this.matrixClient) {
            throw new Error("createClient must be called first");
        }

        // The two stores are separate databases and neither needs the other, so they open side by side:
        // the saved sync is read (in the store's worker) while the crypto WASM loads and its store opens.
        // Both are needed before the client starts - the saved sync holds events to decrypt - so the
        // start still waits for whichever takes longer, rather than for one after the other.
        const cryptoReady = SettingsStore.getValue("lowBandwidth")
            ? Promise.resolve()
            : this.initClientCrypto(assignOpts);
        // Awaited below; until then a failure must not count as unhandled while the sync store opens.
        cryptoReady.catch(() => {});

        for (const dbType of ["indexeddb", "memory"]) {
            try {
                const promise = this.matrixClient.store.startup();
                logger.log("MatrixClientPeg: waiting for MatrixClient store to initialise");
                await promise;
                break;
            } catch (err) {
                if (dbType === "indexeddb") {
                    logger.error("Error starting matrixclient store - falling back to memory store", err);
                    this.matrixClient.store = new MemoryStore({
                        localStorage: localStorage,
                    });
                } else {
                    logger.error("Failed to start memory store!", err);
                    throw err;
                }
            }
        }
        bootMark("store_opened");
        this.matrixClient.store.on?.("closed", this.onUnexpectedStoreClose);

        // try to initialise e2e on the new client
        await cryptoReady;
        bootMark("crypto_opened");

        const opts = utils.deepCopy(this.opts);
        // the react sdk doesn't work without this, so don't allow
        opts.pendingEventOrdering = PendingEventOrdering.Detached;
        opts.lazyLoadMembers = true;
        // Poll the user's `<server_name>/.well-known/matrix/client` for client config unless disabled by config.
        // Leaving `clientWellKnownPollPeriod` unset stops the SDK fetching it.
        if (SdkConfig.get("enable_client_well_known_lookups")) {
            opts.clientWellKnownPollPeriod = 2 * 60 * 60; // 2 hours
        }
        opts.threadSupport = true;
        // Start with each room's latest events only (enough for the room list); the room about to be shown
        // gets its stored history, and every other room reads it back from the store when opened.
        opts.savedSyncTrim = {
            tail: SAVED_SYNC_TAIL,
            fullRoomIds: roomsShownAtStartup(),
            fullRoomTags: ["m.favourite"], // favourites are replayed in full too
            listStateTypes: ROOM_LIST_STATE_TYPES,
            skipTimelineTypes: BOOKKEEPING_STATE_TYPES,
            userId: this.matrixClient.getUserId() ?? undefined,
        };
        if (SettingsStore.getValue("feature_user_status")) {
            opts.unstableMSC4429SyncUserProfileFields = ["org.matrix.msc4426.status", "org.matrix.msc4426.call"];
        }

        if (SettingsStore.getValue("feature_sliding_sync")) {
            throw new UserFriendlyError("sliding_sync_legacy_no_longer_supported");
        }

        // Sliding sync where the server has it (it is the default); the other sync where it has not. With it,
        // the last session's rooms are shown at once from what it kept (utils/sync/slidingSyncCache), and
        // the trimmed replay of the stored /sync, which is for the other, is not used.
        const slidingSyncWanted = SettingsStore.getValue("feature_simplified_sliding_sync");
        const slidingSyncSupported =
            slidingSyncWanted && (await SlidingSyncManager.instance.nativeSlidingSyncSupport(this.matrixClient));
        if (slidingSyncWanted) rememberSlidingSyncSupport(this.matrixClient.baseUrl, slidingSyncSupported);
        if (slidingSyncSupported) {
            SlidingSyncManager.serverSupportsSlidingSync = true;
            const slidingSync = await SlidingSyncManager.instance.setup(this.matrixClient);
            if (slidingSync) {
                const cache = new SlidingSyncCacheStore(this.matrixClient.getSafeUserId());
                cache.record(slidingSync, this.matrixClient);
                opts.slidingSync = slidingSync;
                opts.slidingSyncCache = cache;
                delete opts.savedSyncTrim;
                void forgetLegacySyncStore();
            }
        } else {
            void SlidingSyncManager.instance.checkSupport(this.matrixClient);
        }
        setSlidingSyncActive(!!opts.slidingSync);

        // Connect the matrix client to the dispatcher and setting handlers
        MatrixActionCreators.start(this.matrixClient);
        MatrixClientBackedSettingsHandler.matrixClient = this.matrixClient;
        MatrixClientBackedController.matrixClient = this.matrixClient;

        return opts;
    }

    /**
     * Attempt to initialize the crypto layer on a newly-created MatrixClient.
     */
    private async initClientCrypto(opts: MatrixClientPegAssignOpts): Promise<void> {
        if (!this.matrixClient) {
            throw new Error("createClient must be called first");
        }

        if (!opts.rustCryptoStoreKey && !opts.rustCryptoStorePassword) {
            logger.error("Warning! Not using an encryption key for rust crypto store.");
        }

        await this.matrixClient.initRustCrypto({
            storageKey: opts.rustCryptoStoreKey,
            storagePassword: opts.rustCryptoStorePassword,
            caCertsPem: opts.x509?.userVerificationCaCertsPem,
            x509Signer: opts.x509?.signer,
            x509Validity: opts.x509?.validity,
        });

        StorageManager.setCryptoInitialised(true);

        setDeviceIsolationMode(this.matrixClient, SettingsStore.getValue("feature_exclude_insecure_devices"));

        // Start dehydration. This code is only for the case where the client
        // gets restarted, so we only do this if we already have the dehydration
        // key cached, and we don't have to try to rehydrate a device. If this
        // is a new login, we will start dehydration after Secret Storage is
        // unlocked.
        // It takes a dozen requests and an upload, so it runs alongside the client starting rather than
        // before it: the cached rooms must not wait on the network (or, offline, on it failing).
        void initialiseDehydrationIfEnabled(this.matrixClient, { onlyIfKeyCached: true, rehydrate: false }).catch(
            (e) => {
                // We may get an error dehydrating, such as if cross-signing and
                // SSSS are not set up yet.  Just log the error and continue.
                // If SSSS gets set up later, we will re-try dehydration.
                console.log("Error starting device dehydration", e);
            },
        );
    }

    /**
     * Implementation of {@link IMatrixClientPeg.start}.
     */
    public async start(assignOpts?: MatrixClientPegAssignOpts): Promise<void> {
        const opts = await this.assign(assignOpts);

        markSavedSyncLoaded(this.matrixClient!);
        logger.log(`MatrixClientPeg: really starting MatrixClient`);
        await this.matrixClient!.startClient(opts);
        logger.log(`MatrixClientPeg: MatrixClient started`);
        bootMark("client_started");
        // Keep what we have seen (utils/history), so the shared-media tabs don't scan the room again
        // on the next visit.
        historyIndexer.start(this.matrixClient!);
    }
}

/**
 * Startup timing (utils/bootTimings.ts): note when the saved sync reaches the main thread, and how much of
 * it there is to replay. The sync loop asks the store for it exactly once, when the client starts; the
 * store gets its own method back as soon as that call returns.
 */
function markSavedSyncLoaded(client: MatrixClient): void {
    const store = client.store;
    // Called with the store as `this` below, and put back as it was.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const getSavedSync = store?.getSavedSync;
    if (typeof getSavedSync !== "function") return;
    store.getSavedSync = async (...args: Parameters<typeof getSavedSync>) => {
        store.getSavedSync = getSavedSync;
        const saved = await getSavedSync.apply(store, args);
        bootMark("saved_sync_loaded", savedSyncSize(saved));
        return saved;
    };
}

/**
 * State a bridge rewrites as things change, which is only ever read as the room's current state. Keeping
 * it out of the replayed timeline leaves those few events for real messages: with a bridge per network
 * and hundreds of chats, this was over a third of everything replayed.
 */
const BOOKKEEPING_STATE_TYPES: string[] = [BACKFILL_EVENT_TYPE, BRIDGE_LOGIN_EVENT_TYPE];

/** How many of each room's latest stored events are replayed at startup. */
const SAVED_SYNC_TAIL = 3;

/** The room the app will open: the one in the URL, else the last one viewed. */
function roomsShownAtStartup(): string[] {
    const rooms: string[] = [];
    const match = /^#\/room\/(![^/?]+)/.exec(window.location.hash);
    if (match) rooms.push(decodeURIComponent(match[1]));
    const last = window.localStorage?.getItem("mx_last_room_id");
    if (last && !rooms.includes(last)) rooms.push(last);
    return rooms;
}

/**
 * Note: You should be using a React context with access to a client rather than
 * using this, as in a multi-account world this will not exist!
 */
export const MatrixClientPeg: IMatrixClientPeg = new MatrixClientPegClass();

if (!window.mxMatrixClientPeg) {
    window.mxMatrixClientPeg = MatrixClientPeg;
}
