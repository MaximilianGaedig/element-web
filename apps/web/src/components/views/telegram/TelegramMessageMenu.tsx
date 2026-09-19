/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Telegram Web K's message context menu shell (GPL-3.0, https://github.com/morethanwords/tweb):
 * a `.btn-menu` opened at the pointer by helpers/positionMenu.ts, scaled in from 0.8 around the
 * corner nearest the pointer (scss/partials/_button.scss, --btn-menu-transition), with the
 * reactions bar above the items (components/chat/contextMenu.ts appendReactionsMenu).
 */

import React, { type JSX, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";

import { TgIcon } from "./TelegramIcons";
import { type TgIconName } from "./tgIconPaths";
import { getReactionsMenuPadding, positionMenu } from "../../../utils/telegram/telegramMenu";
import { Key } from "../../../Keyboard";
import UIStore from "../../../stores/UIStore";

export interface TelegramMenuItem {
    key: string;
    icon: TgIconName;
    label: string;
    onClick: (ev: React.MouseEvent | React.KeyboardEvent) => void;
    /** tweb's `.danger` items (delete). */
    danger?: boolean;
    /** Act on mousedown, so that a text selection survives (copy/quote selected text). */
    triggerOnMouseDown?: boolean;
    /** Render as a link. */
    href?: string;
}

interface Props {
    /** Where the menu was asked for: the pointer or the long-press point (client coordinates). */
    point: { x: number; y: number };
    items: TelegramMenuItem[];
    /** The reactions bar, if the message can be reacted to; `close` closes the menu with its transition. */
    reactions?: (close: () => void) => ReactNode;
    /** Replaces the bar and the items, e.g. the full reaction picker. */
    expanded?: (close: () => void) => ReactNode;
    onFinished: () => void;
}

/** --btn-menu-transition: .2s cubic-bezier(.4, 0, .2, 1). */
const TRANSITION_MS = 200;
/** mediaSizes.isMobile: tweb's handheld breakpoint. */
const MOBILE_MAX_WIDTH = 600;

function isTouchDevice(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

export default function TelegramMessageMenu({ point, items, reactions, expanded, onFinished }: Props): JSX.Element {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ left: number; top: number; className: string }>();
    const [active, setActive] = useState(false);
    const closing = useRef(false);

    // Close with tweb's reverse transition, then unmount.
    const close = useCallback(() => {
        if (closing.current) return;
        closing.current = true;
        setActive(false);
        window.setTimeout(onFinished, TRANSITION_MS);
    }, [onFinished]);

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const { windowWidth, windowHeight } = UIStore.instance;
        const isMobile = windowWidth <= MOBILE_MAX_WIDTH;
        setPosition(
            positionMenu(
                point,
                { width: menu.scrollWidth, height: menu.scrollHeight },
                { width: document.body.clientWidth || windowWidth, height: windowHeight },
                {
                    isMobile,
                    isRtl: document.dir === "rtl",
                    padding: reactions && !expanded ? getReactionsMenuPadding(isTouchDevice()) : undefined,
                },
            ),
        );
    }, [point, reactions, expanded]);

    useEffect(() => {
        // One frame at scale(.8)/opacity 0 first, so the transition runs.
        const id = window.requestAnimationFrame(() => setActive(true));
        return () => window.cancelAnimationFrame(id);
    }, []);

    useEffect(() => {
        if (active) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    }, [active]);

    const onKeyDown = (ev: React.KeyboardEvent): void => {
        if (ev.key === Key.ESCAPE) {
            ev.stopPropagation();
            close();
            return;
        }
        if (ev.key !== Key.ARROW_DOWN && ev.key !== Key.ARROW_UP) return;
        ev.preventDefault();
        const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
        const i = all.indexOf(document.activeElement as HTMLElement);
        const next = ev.key === Key.ARROW_DOWN ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
        all[next]?.focus();
    };

    const renderItem = (item: TelegramMenuItem): JSX.Element => {
        const act = (ev: React.MouseEvent | React.KeyboardEvent): void => {
            item.onClick(ev);
            close();
        };
        const props = {
            "key": item.key,
            "role": "menuitem",
            "tabIndex": -1,
            "className": classNames("mx_TgMenu_item", { mx_TgMenu_item_danger: item.danger }),
            "onMouseDown": item.triggerOnMouseDown
                ? (ev: React.MouseEvent) => {
                      ev.preventDefault();
                      act(ev);
                  }
                : undefined,
            "onClick": item.triggerOnMouseDown ? undefined : act,
            "onKeyDown": (ev: React.KeyboardEvent) => {
                if (ev.key === Key.ENTER || ev.key === Key.SPACE) {
                    ev.preventDefault();
                    act(ev);
                }
            },
            "data-testid": `tg-menu-${item.key}`,
        };
        const content = (
            <>
                <TgIcon name={item.icon} className="mx_TgMenu_itemIcon" />
                <span className="mx_TgMenu_itemText">{item.label}</span>
            </>
        );
        return item.href ? (
            <a {...props} href={item.href} target="_blank" rel="noreferrer noopener">
                {content}
            </a>
        ) : (
            <div {...props}>{content}</div>
        );
    };

    return createPortal(
        <div className="mx_TgMenu_wrapper" onKeyDown={onKeyDown}>
            {/* Pointer-only backdrop; Escape closes the menu from the keyboard. */}
            {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events */}
            <div
                className="mx_TgMenu_background"
                onClick={close}
                onContextMenu={(ev) => {
                    ev.preventDefault();
                    close();
                }}
            />
            <div
                ref={menuRef}
                role="menu"
                className={classNames("mx_TgMenu", position?.className, {
                    mx_TgMenu_active: active,
                    mx_TgMenu_expanded: !!expanded,
                    mx_TgMenu_hasReactions: !!reactions && !expanded,
                })}
                style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
                data-testid="tg-message-menu"
            >
                {expanded?.(close) ?? (
                    <>
                        {reactions?.(close)}
                        <div className="mx_TgMenu_items">{items.map(renderItem)}</div>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}
