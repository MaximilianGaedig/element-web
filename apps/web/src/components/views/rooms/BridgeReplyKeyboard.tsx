/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useState } from "react";
import classNames from "classnames";
import { type MatrixEvent, MatrixEventEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { ChevronDownIcon, ChevronUpIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useTypedEventEmitter } from "../../../hooks/useEventEmitter";
import { type ActiveReplyKeyboard, findActiveReplyKeyboard } from "../../../utils/BridgeButtons";
import BridgeButton from "../messages/BridgeButton";
import AccessibleButton from "../elements/AccessibleButton";

/**
 * Event IDs of `single_use` reply keyboards that have already been used on this device. Kept at
 * module level so that the keyboard stays hidden when switching rooms and back.
 */
const usedSingleUseKeyboards = new Set<string>();

/** Test helper. */
export function resetUsedBridgeKeyboards(): void {
    usedSingleUseKeyboards.clear();
}

function computeActive(room: Room, myUserId: string | null): ActiveReplyKeyboard | null {
    try {
        return findActiveReplyKeyboard(room.getLiveTimeline().getEvents(), myUserId);
    } catch {
        return null;
    }
}

function useActiveReplyKeyboard(room: Room): ActiveReplyKeyboard | null {
    const cli = useMatrixClientContext();
    const [active, setActive] = useState(() => computeActive(room, cli.getUserId()));

    const update = useCallback(() => {
        setActive((prev) => {
            const next = computeActive(room, cli.getUserId());
            // Avoid re-rendering (and resetting the collapse state) for unrelated timeline events.
            if (
                prev &&
                next &&
                prev.event === next.event &&
                JSON.stringify(prev.keyboard) === JSON.stringify(next.keyboard)
            ) {
                return prev;
            }
            return next;
        });
    }, [room, cli]);
    useEffect(update, [update]);

    useTypedEventEmitter(room, RoomEvent.Timeline, update);
    useTypedEventEmitter(room, RoomEvent.TimelineReset, update);
    useTypedEventEmitter(room, RoomEvent.Redaction, update);
    const onEventChanged = useCallback(
        (ev: MatrixEvent) => {
            if (ev.getRoomId() === room.roomId) update();
        },
        [room, update],
    );
    useTypedEventEmitter(cli, MatrixEventEvent.Replaced, onEventChanged);
    useTypedEventEmitter(cli, MatrixEventEvent.Decrypted, onEventChanged);

    return active;
}

interface Props {
    room: Room;
    /** Reports the composer placeholder the bot asked for, or undefined for the default one. */
    onPlaceholderChange?: (placeholder: string | undefined) => void;
}

/**
 * A bridged Telegram bot "reply keyboard", rendered above the room's main composer.
 *
 * It's driven by the latest main-timeline event carrying a `fi.mau.telegram.buttons` field with
 * `keyboard` set to `reply`, `hide` or `force_reply` (see {@link findActiveReplyKeyboard}):
 * - `reply` shows the keyboard. `resize` makes the buttons compact, `single_use` hides it after one
 *   press (remembered locally), `placeholder` becomes the composer placeholder.
 * - `hide` hides it.
 * - `force_reply` only sets the composer placeholder, until the user sends a message.
 * `selective` is ignored: we can't map Telegram's "only for mentioned users" to Matrix users.
 */
export default function BridgeReplyKeyboard({ room, onPlaceholderChange }: Props): JSX.Element | null {
    const active = useActiveReplyKeyboard(room);
    const [, forceRender] = useState(0);
    const [collapsed, setCollapsed] = useState(false);

    const eventId = active?.event.getId();
    // A new keyboard from the bot should always be shown expanded.
    useEffect(() => setCollapsed(false), [eventId]);

    const used = !!eventId && usedSingleUseKeyboards.has(eventId);
    const kind = active?.keyboard.keyboard;
    const showKeyboard = kind === "reply" && !used;

    let placeholder: string | undefined;
    if (active && (showKeyboard || kind === "force_reply")) placeholder = active.keyboard.placeholder;
    useEffect(() => {
        onPlaceholderChange?.(placeholder);
    }, [onPlaceholderChange, placeholder]);
    useEffect(() => () => onPlaceholderChange?.(undefined), [onPlaceholderChange]);

    const onUsed = useCallback(() => {
        if (!eventId || !active?.keyboard.singleUse) return;
        usedSingleUseKeyboards.add(eventId);
        forceRender((n) => n + 1);
    }, [eventId, active]);

    if (!active || !showKeyboard) return null;
    const { keyboard } = active;

    return (
        <div
            className={classNames("mx_BridgeReplyKeyboard", {
                mx_BridgeReplyKeyboard_resize: keyboard.resize,
                mx_BridgeReplyKeyboard_collapsed: collapsed,
            })}
            role="group"
            aria-label={_t("timeline|bridge_buttons|reply_keyboard_label")}
        >
            <AccessibleButton
                className="mx_BridgeReplyKeyboard_toggle"
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                title={
                    collapsed
                        ? _t("timeline|bridge_buttons|reply_keyboard_show")
                        : _t("timeline|bridge_buttons|reply_keyboard_hide")
                }
            >
                {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </AccessibleButton>
            {!collapsed && (
                <div className="mx_BridgeButtons mx_BridgeReplyKeyboard_rows">
                    {keyboard.rows.map((row, r) => (
                        <div className="mx_BridgeButtons_row" key={r}>
                            {row.map((btn, c) => (
                                <BridgeButton key={c} button={btn} roomId={room.roomId} onUsed={onUsed} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
