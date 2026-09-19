/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The Telegram-style column layout: a chat list whose edge is dragged like Telegram Web K's
 * (src/helpers/installColumnResize.ts + src/helpers/updateColumnWidths.ts, GPL-3.0), collapsing to the
 * 80px avatars-only column below MIN_SIDEBAR_WIDTH × SIDEBAR_COLLAPSE_FACTOR.
 */

import React, {
    type CSSProperties,
    type JSX,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { _t } from "../../../../languageHandler";
import type ResizeNotifier from "../../../../utils/ResizeNotifier";
import {
    createLeftPreferencePersister,
    isEffectivelyCollapsed,
    type LeftColumnPreference,
    loadLeftPreference,
    preferenceForDrag,
    visualLeftWidth,
} from "../../../../utils/beeper/tgLayout/columnWidths";
import { ScreenSize, useScreenSize, viewportWidth } from "../../../../utils/beeper/tgLayout/mediaSizes";

interface TgColumnsProps {
    /** The spaces bar, rendered at the outer edge of the chat-list column. */
    spacePanel: ReactNode;
    /** The chat list. */
    leftPanel: ReactNode;
    /** The page shown beside (or, on handhelds, over) the chat list. */
    children: ReactNode;
    resizeNotifier: ResizeNotifier;
}

export function TgColumns({ spacePanel, leftPanel, children, resizeNotifier }: TgColumnsProps): JSX.Element {
    const screen = useScreenSize();
    const [pref, setPref] = useState<LeftColumnPreference>(() => loadLeftPreference());
    const [resizing, setResizing] = useState(false);
    const persist = useMemo(() => createLeftPreferencePersister(), []);
    useEffect(() => () => persist.flush(), [persist]);

    const columnRef = useRef<HTMLDivElement>(null);

    const onPointerDown = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
            setResizing(true);
            resizeNotifier.startResizing();
        },
        [resizeNotifier],
    );

    const onPointerMove = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            if (!resizing || !columnRef.current) return;
            // installColumnResize.ts: width is the distance from the column's OUTER edge to the pointer.
            const rect = columnRef.current.getBoundingClientRect();
            const next = preferenceForDrag(Math.round(ev.clientX - rect.left));
            setPref((prev) => (prev.collapsed === next.collapsed && prev.width === next.width ? prev : next));
            persist(next);
            resizeNotifier.notifyLeftHandleResized();
        },
        [resizing, persist, resizeNotifier],
    );

    const onPointerUp = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            if (!resizing) return;
            ev.currentTarget.releasePointerCapture?.(ev.pointerId);
            setResizing(false);
            persist.flush();
            resizeNotifier.stopResizing();
        },
        [resizing, persist, resizeNotifier],
    );

    const collapsed = isEffectivelyCollapsed(pref, screen);
    const style = {
        "--TgColumns-left-width": `${visualLeftWidth(pref, screen, viewportWidth())}px`,
    } as CSSProperties;

    return (
        <div
            className="mx_TgColumns"
            data-screen={screen}
            data-collapsed={collapsed || undefined}
            data-resizing={resizing || undefined}
            style={style}
        >
            <div className="mx_TgColumns_left">
                {spacePanel}
                <div className="mx_TgColumns_list" ref={columnRef}>
                    {leftPanel}
                </div>
                {screen === ScreenSize.large && (
                    <div
                        className="mx_TgColumns_resizeHandle"
                        data-active={resizing || undefined}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={_t("tg_layout|resize_chat_list")}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        data-testid="tg-resize-handle"
                    />
                )}
            </div>
            <div className="mx_TgColumns_center">{children}</div>
        </div>
    );
}
