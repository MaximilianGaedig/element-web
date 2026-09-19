/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type MouseEvent } from "react";
import { ClientEvent, SyncState } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type RoomListSearchViewSnapshot,
    type RoomListSearchViewModel as RoomListSearchViewModelInterface,
} from "@element-hq/web-shared-components";

import { IS_MAC, Key } from "../../Keyboard";
import { _t } from "../../languageHandler";
import { ALTERNATE_KEY_NAME } from "../../accessibility/KeyboardShortcuts";
import { shouldShowComponent } from "../../customisations/helpers/UIComponents";
import { UIComponent } from "../../settings/UIFeature";
import { MetaSpace } from "../../stores/spaces";
import { Action } from "../../dispatcher/actions";
import PosthogTrackers from "../../PosthogTrackers";
import defaultDispatcher from "../../dispatcher/dispatcher";
import type LegacyCallHandler from "../../LegacyCallHandler";
import { LegacyCallHandlerEvent } from "../../LegacyCallHandler";
import { MatrixClientPeg } from "../../MatrixClientPeg";

/** tweb connectionStatus.ts CHANGE_STATE_DELAY: a status only appears after this long (no flicker). */
const STATUS_CHANGE_DELAY_MS = 400;

export interface Props {
    /**
     * Current active space
     * The explore button is only displayed in the Home meta space
     */
    activeSpace: string;

    /**
     * Reference to the LegacyCallHandler instance
     */
    legacyCallHandler: LegacyCallHandler;
}

/**
 * ViewModel for the room list search component.
 * Manages the state and actions for the search bar, dial pad, and explore buttons.
 */
export class RoomListSearchViewModel
    extends BaseViewModel<RoomListSearchViewSnapshot, Props>
    implements RoomListSearchViewModelInterface
{
    private displayDialButton = false;
    /** The connection status shown in the search field (tweb's chat list), if any. */
    private status: string | undefined;
    private statusTimer: number | undefined;
    private hadConnect = false;

    /**
     * Computes the snapshot based on the current props and PSTN support state.
     */
    private static readonly computeSnapshot = (
        activeSpace: string,
        supportsPstn: boolean,
        status?: string,
    ): RoomListSearchViewSnapshot => {
        const displayExploreButton = activeSpace === MetaSpace.Home && shouldShowComponent(UIComponent.ExploreRooms);
        const searchShortcut = IS_MAC ? "⌘ K" : _t(ALTERNATE_KEY_NAME[Key.CONTROL]) + " K";
        return {
            displayExploreButton,
            displayDialButton: supportsPstn,
            searchShortcut,
            ...(status ? { status } : {}),
        };
    };

    public constructor(props: Props) {
        const supportsPstn = props.legacyCallHandler.getSupportsPstnProtocol();
        super(props, RoomListSearchViewModel.computeSnapshot(props.activeSpace, supportsPstn));
        this.displayDialButton = supportsPstn;

        // Connection status like tweb's chat list (connectionStatus.ts): "Waiting for network…" before the
        // first connection, "Reconnecting…" after losing it, "Updating…" while catching up.
        const client = MatrixClientPeg.get();
        if (client) {
            this.disposables.trackListener(client, ClientEvent.Sync, this.onSync);
        }
        window.addEventListener("online", this.onSync);
        window.addEventListener("offline", this.onSync);
        this.disposables.track(() => {
            window.removeEventListener("online", this.onSync);
            window.removeEventListener("offline", this.onSync);
            window.clearTimeout(this.statusTimer);
        });
        this.onSync();

        // Listen for changes in PSTN protocol support
        this.disposables.trackListener(
            props.legacyCallHandler,
            LegacyCallHandlerEvent.ProtocolSupport,
            this.onProtocolSupportChange,
        );
    }

    /**
     * Handles changes in protocol support (PSTN).
     */
    private readonly onProtocolSupportChange = (): void => {
        const supportsPstn = this.props.legacyCallHandler.getSupportsPstnProtocol();
        this.displayDialButton = supportsPstn;
        this.snapshot.set(RoomListSearchViewModel.computeSnapshot(this.props.activeSpace, supportsPstn, this.status));
    };

    /** The status text for the client's sync state, or undefined while connected. */
    private computeStatus(): string | undefined {
        const state = MatrixClientPeg.get()?.getSyncState();
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (!offline && (state === SyncState.Syncing || state === SyncState.Prepared)) {
            this.hadConnect = true;
            return undefined;
        }
        if (!offline && state === SyncState.Catchup) return _t("tg_layout|connection_updating");
        if (!offline && (state === null || state === undefined)) return undefined; // not started yet
        return this.hadConnect ? _t("tg_layout|connection_reconnecting") : _t("tg_layout|connection_waiting");
    }

    /** tweb setState: a new status shows after CHANGE_STATE_DELAY unless one is already showing. */
    private readonly onSync = (): void => {
        const next = this.computeStatus();
        window.clearTimeout(this.statusTimer);
        const apply = (): void => {
            if (next === this.status) return;
            this.status = next;
            this.snapshot.set(
                RoomListSearchViewModel.computeSnapshot(this.props.activeSpace, this.displayDialButton, next),
            );
        };
        if (this.status) apply();
        else this.statusTimer = window.setTimeout(apply, STATUS_CHANGE_DELAY_MS);
    };

    /**
     * Handles the search button click event.
     * Opens the spotlight search dialog.
     */
    public onSearchClick = (): void => {
        defaultDispatcher.fire(Action.OpenSpotlight);
    };

    /**
     * Handles the dial pad button click event.
     * Opens the dial pad dialog.
     */
    public onDialPadClick = (): void => {
        defaultDispatcher.fire(Action.OpenDialPad);
    };

    /**
     * Handles the explore button click event.
     * Opens the room directory and tracks the interaction.
     */
    public onExploreClick = (ev: MouseEvent<HTMLButtonElement>): void => {
        defaultDispatcher.fire(Action.ViewRoomDirectory);
        PosthogTrackers.trackInteraction("WebLeftPanelExploreRoomsButton", ev);
    };

    /**
     * Sets the active space and updates the snapshot accordingly.
     * @param activeSpace - The new active space ID.
     */
    public setActiveSpace(activeSpace: string): void {
        if (activeSpace === this.props.activeSpace) return;

        this.props.activeSpace = activeSpace;
        this.snapshot.set(RoomListSearchViewModel.computeSnapshot(activeSpace, this.displayDialButton, this.status));
    }
}
