/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, type JSX } from "react";
import classNames from "classnames";
import { Tooltip } from "@vector-im/compound-web";
import {
    ChevronUpIcon,
    ChevronDownIcon,
    CloseIcon,
    MentionIcon,
    FavouriteSolidIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { useI18n } from "../../../core/i18n/i18nContext";
import type { ImmediateScroll, TimelineViewActions, TimelineViewSnapshot } from "./types";
import styles from "./TimelineOverlayButtons.module.css";

interface TimelineOverlayButtonsProps {
    snapshot: TimelineViewSnapshot;
    vm: TimelineViewActions;
    /** Imperative scroll-to-anchor handle from the parent View; the VM invokes it
     * when the target is already loaded, else falls back to a pendingAnchor load. */
    scrollNow: ImmediateScroll;
}

/**
 * Absolutely-positioned overlay on top of the timeline list:
 * - **Unread bar** — shown when `canJumpToReadMarker` is `"above"`/`"below"`; a
 *   scroll-to-marker + mark-as-read pair at the top-right.
 * - **Jump stack** (bottom-right), from the bottom up as in Telegram iOS: jump-to-bottom (shown when not
 *   at the live bottom, with an optional unread badge and highlight colouring), then the unread-mention
 *   "@" button and the unread-reaction heart, each there only while something of its kind is unseen and
 *   each with the count of them. A button that is not offered gives up its place, so the ones above it
 *   settle down onto the bottom of the stack.
 */
export function TimelineOverlayButtons({ snapshot, vm, scrollNow }: TimelineOverlayButtonsProps): JSX.Element {
    const { translate: _t } = useI18n();

    const readMarkerDirection = snapshot.canJumpToReadMarker;
    const showJumpToBottom = !snapshot.atLiveEnd || !snapshot.isAtBottom;

    const onJumpToReadMarkerClick = useCallback(() => vm.onJumpToReadMarker(scrollNow), [vm, scrollNow]);
    const onJumpToLiveClick = useCallback(() => vm.onJumpToLive(scrollNow), [vm, scrollNow]);
    const onJumpToMentionClick = useCallback(() => vm.onJumpToUnreadMention(scrollNow), [vm, scrollNow]);
    const onJumpToReactionClick = useCallback(() => vm.onJumpToUnreadReaction(scrollNow), [vm, scrollNow]);

    return (
        // Non-interactive layer (pointer-events:none) so clicks fall through to the list;
        // only the buttons re-enable them. Must NOT be aria-hidden — these are AT-reachable.
        <div className={classNames(styles.overlay, "mx_TimelineOverlayButtons")}>
            {/* Top unread bar — marker is above the viewport */}
            {readMarkerDirection === "above" && (
                <div className={classNames(styles.topUnreadBar, "mx_TopUnreadMessagesBar")}>
                    <Tooltip description={_t("room|jump_read_marker")} placement="left">
                        <button
                            className={classNames(styles.topUnreadBarScrollUp, "mx_TopUnreadMessagesBar_scrollUp")}
                            aria-label={_t("room|jump_read_marker")}
                            onClick={onJumpToReadMarkerClick}
                            type="button"
                        >
                            <ChevronUpIcon />
                        </button>
                    </Tooltip>
                    <Tooltip description={_t("notifications|mark_all_read")} placement="left">
                        <button
                            className={classNames(styles.topUnreadBarMarkAsRead, "mx_TopUnreadMessagesBar_markAsRead")}
                            aria-label={_t("notifications|mark_all_read")}
                            onClick={() => vm.onMarkAllAsRead()}
                            type="button"
                        >
                            <CloseIcon />
                        </button>
                    </Tooltip>
                </div>
            )}

            {/* Unread bar — marker is below the viewport; sits at top-right like the above bar */}
            {readMarkerDirection === "below" && (
                <div className={classNames(styles.belowUnreadBar, "mx_TopUnreadMessagesBar")}>
                    <Tooltip description={_t("room|jump_read_marker")} placement="left">
                        <button
                            className={classNames(styles.belowUnreadBarScrollDown, "mx_TopUnreadMessagesBar_scrollUp")}
                            aria-label={_t("room|jump_read_marker")}
                            onClick={onJumpToReadMarkerClick}
                            type="button"
                        >
                            <ChevronDownIcon />
                        </button>
                    </Tooltip>
                    <Tooltip description={_t("notifications|mark_all_read")} placement="left">
                        <button
                            className={classNames(
                                styles.belowUnreadBarMarkAsRead,
                                "mx_TopUnreadMessagesBar_markAsRead",
                            )}
                            aria-label={_t("notifications|mark_all_read")}
                            onClick={() => vm.onMarkAllAsRead()}
                            type="button"
                        >
                            <CloseIcon />
                        </button>
                    </Tooltip>
                </div>
            )}

            {/* The corner stack. Each button stays in the page when it is not offered, so it can shrink away
                as it grew in; `inert` and hidden from everything but the transition while it is away. */}
            <div className={classNames(styles.jumpStack, "mx_TimelineJumpStack")}>
                <div
                    className={classNames(styles.jumpItem, "mx_JumpButton", "mx_JumpToBottomButton", {
                        [styles.away]: !showJumpToBottom,
                        [styles.highlight]: snapshot.hasHighlights,
                        mx_JumpToBottomButton_highlight: snapshot.hasHighlights,
                    })}
                    inert={!showJumpToBottom}
                >
                    <Tooltip description={_t("room|jump_to_bottom_button")} placement="left">
                        <button
                            className={classNames(
                                styles.jumpButton,
                                "mx_JumpButton_button",
                                "mx_JumpToBottomButton_scrollDown",
                            )}
                            aria-label={_t("room|jump_to_bottom_button")}
                            onClick={onJumpToLiveClick}
                            type="button"
                        >
                            <ChevronDownIcon />
                        </button>
                    </Tooltip>
                    {snapshot.numUnreadMessages > 0 && (
                        <div
                            className={classNames(
                                styles.jumpBadge,
                                "mx_JumpButton_badge",
                                "mx_JumpToBottomButton_badge",
                            )}
                        >
                            {snapshot.numUnreadMessages}
                        </div>
                    )}
                </div>

                <div
                    className={classNames(styles.jumpItem, "mx_JumpButton", "mx_JumpToMentionButton", {
                        [styles.away]: snapshot.unreadMentions <= 0,
                    })}
                    inert={snapshot.unreadMentions <= 0}
                >
                    <Tooltip description={_t("room|jump_to_mention")} placement="left">
                        <button
                            className={classNames(styles.jumpButton, "mx_JumpButton_button")}
                            aria-label={_t("room|jump_to_mention")}
                            onClick={onJumpToMentionClick}
                            type="button"
                        >
                            <MentionIcon />
                        </button>
                    </Tooltip>
                    {snapshot.unreadMentions > 0 && (
                        <div className={classNames(styles.jumpBadge, "mx_JumpButton_badge")}>
                            {snapshot.unreadMentions}
                        </div>
                    )}
                </div>

                <div
                    className={classNames(styles.jumpItem, "mx_JumpButton", "mx_JumpToReactionButton", {
                        [styles.away]: snapshot.unreadReactions <= 0,
                    })}
                    inert={snapshot.unreadReactions <= 0}
                >
                    <Tooltip description={_t("room|jump_to_reaction")} placement="left">
                        <button
                            className={classNames(styles.jumpButton, "mx_JumpButton_button")}
                            aria-label={_t("room|jump_to_reaction")}
                            onClick={onJumpToReactionClick}
                            type="button"
                        >
                            <FavouriteSolidIcon />
                        </button>
                    </Tooltip>
                    {snapshot.unreadReactions > 0 && (
                        <div className={classNames(styles.jumpBadge, "mx_JumpButton_badge")}>
                            {snapshot.unreadReactions}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
