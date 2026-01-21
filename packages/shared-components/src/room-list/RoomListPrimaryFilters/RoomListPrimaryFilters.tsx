/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useId, useState } from "react";
import { ChatFilter, IconButton } from "@vector-im/compound-web";
import ChevronDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";

import { Flex } from "../../utils/Flex";
import { _t } from "../../utils/i18n";
import { useCollapseFilters } from "./useCollapseFilters";
import { useVisibleFilters, type Filter, type FilterId } from "./useVisibleFilters";
import styles from "./RoomListPrimaryFilters.module.css";

/**
 * Maps filter IDs to translation keys
 */
const filterIdToTranslationKey = {
    unread: "room_list|filters|unread",
    people: "room_list|filters|people",
    rooms: "room_list|filters|rooms",
    favourite: "room_list|filters|favourite",
    mentions: "room_list|filters|mentions",
    invites: "room_list|filters|invites",
    low_priority: "room_list|filters|low_priority",
} as const satisfies Record<FilterId, string>;

/**
 * Props for RoomListPrimaryFilters component
 */
export interface RoomListPrimaryFiltersProps {
    /** Array of filters to display */
    filters: Filter[];
    /** Callback when a filter is toggled */
    onToggleFilter: (filter: Filter) => void;
}

/**
 * The primary filters component for the room list.
 * Displays a collapsible list of filters with expand/collapse functionality.
 */
export const RoomListPrimaryFilters: React.FC<RoomListPrimaryFiltersProps> = ({
    filters,
    onToggleFilter,
}): JSX.Element | null => {
    const id = useId();
    const [isExpanded, setIsExpanded] = useState(false);

    const {
        ref,
        isWrapping: displayChevron,
        wrappingIndex,
    } = useCollapseFilters<HTMLUListElement>(isExpanded, "wrapping");
    const visibleFilters = useVisibleFilters(filters, wrappingIndex);

    return (
        <Flex
            className={styles.roomListPrimaryFilters}
            data-testid="primary-filters"
            gap="var(--cpd-space-3x)"
            direction="row-reverse"
            justify="space-between"
        >
            {displayChevron && (
                <IconButton
                    kind="secondary"
                    aria-expanded={isExpanded}
                    aria-controls={id}
                    className={styles.iconButton}
                    aria-label={isExpanded ? _t("room_list|collapse_filters") : _t("room_list|expand_filters")}
                    size="28px"
                    onClick={() => setIsExpanded((expanded) => !expanded)}
                >
                    <ChevronDownIcon />
                </IconButton>
            )}
            <Flex
                id={id}
                as="div"
                role="listbox"
                aria-label={_t("room_list|primary_filters")}
                align="center"
                gap="var(--cpd-space-2x)"
                wrap="wrap"
                className={styles.list}
                ref={ref}
            >
                {visibleFilters.map((filter, index) => (
                    <ChatFilter
                        key={`${filter.id}-${index}`}
                        role="option"
                        selected={filter.active}
                        onClick={() => onToggleFilter(filter)}
                    >
                        {_t(filterIdToTranslationKey[filter.id])}
                    </ChatFilter>
                ))}
            </Flex>
        </Flex>
    );
};
