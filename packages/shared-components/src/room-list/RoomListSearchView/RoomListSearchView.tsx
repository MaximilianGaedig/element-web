/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type MouseEventHandler } from "react";
import { Button } from "@vector-im/compound-web";
import ExploreIcon from "@vector-im/compound-design-tokens/assets/web/icons/explore";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import DialPadIcon from "@vector-im/compound-design-tokens/assets/web/icons/dial-pad";

import styles from "./RoomListSearchView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { useI18n } from "../../core/i18n/i18nContext";

export interface RoomListSearchViewSnapshot {
    /**
     * Whether to display the explore button.
     */
    displayExploreButton: boolean;
    /**
     * Whether to display the dial pad button.
     */
    displayDialButton: boolean;
    /**
     * The keyboard shortcut text to display for the search action.
     * For example: "⌘ K" on macOS or "Ctrl K" on other platforms.
     */
    searchShortcut: string;
    /**
     * Connection state shown in place of "Search" with a spinner, like Telegram Web's chat list
     * ("Waiting for network…", "Reconnecting…", "Updating…"); unset while connected.
     */
    status?: string;
}

export interface RoomListSearchViewActions {
    /**
     * Handles the click event on the search button.
     */
    onSearchClick: MouseEventHandler<HTMLButtonElement>;
    /**
     * Handles the click event on the dial pad button.
     */
    onDialPadClick: MouseEventHandler<HTMLButtonElement>;
    /**
     * Handles the click event on the explore button.
     */
    onExploreClick: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The view model for the room list search component.
 */
export type RoomListSearchViewModel = ViewModel<RoomListSearchViewSnapshot, RoomListSearchViewActions>;

interface RoomListSearchViewProps {
    /**
     * The view model for the room list search component.
     */
    vm: RoomListSearchViewModel;
}

/**
 * A search component to be displayed at the top of the room list.
 * The component provides search functionality, optional dial pad access, and optional room exploration.
 *
 * @example
 * ```tsx
 * <RoomListSearchView vm={roomListSearchViewModel} />
 * ```
 */
/** A small spinner in the search icon's place while the connection status shows. */
function StatusSpinner(props: React.SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg {...props} viewBox="0 0 24 24" className={styles["status_spinner"]} aria-hidden>
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="36 60" />
        </svg>
    );
}

export function RoomListSearchView({ vm }: Readonly<RoomListSearchViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const { displayExploreButton, displayDialButton, searchShortcut, status } = useViewModel(vm);

    return (
        <Flex
            data-testid="room-list-search"
            className={styles.view}
            role="search"
            gap="var(--cpd-space-2x)"
            align="center"
        >
            <Button
                id="room-list-search-button"
                className={styles.search}
                kind="secondary"
                size="md"
                Icon={status ? StatusSpinner : SearchIcon}
                onClick={vm.onSearchClick}
                data-status={status ? "" : undefined}
            >
                <Flex className={styles["search_container"]} as="span" justify="space-between">
                    <span className={styles["search_text"]} aria-live="polite">
                        {status ?? _t("action|search")}
                    </span>
                    {!status && <kbd>{searchShortcut}</kbd>}
                </Flex>
            </Button>
            {displayDialButton && (
                <Button
                    kind="secondary"
                    size="md"
                    Icon={DialPadIcon}
                    iconOnly={true}
                    aria-label={_t("left_panel|open_dial_pad")}
                    onClick={vm.onDialPadClick}
                />
            )}
            {displayExploreButton && (
                <Button
                    kind="secondary"
                    size="md"
                    Icon={ExploreIcon}
                    iconOnly={true}
                    aria-label={_t("action|explore_rooms")}
                    onClick={vm.onExploreClick}
                />
            )}
        </Flex>
    );
}
