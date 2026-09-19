/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The Telegram-style column layout, ported from Telegram Web K (GPL-3.0):
 *   - a chat list whose edge is dragged like tweb's (src/helpers/installColumnResize.ts +
 *     src/helpers/updateColumnWidths.ts), collapsing to the 80px avatars-only column below
 *     MIN_SIDEBAR_WIDTH × SIDEBAR_COLLAPSE_FACTOR;
 *   - on handhelds (≤600px, src/helpers/mediaSizes.ts) a single pane: the chat list fills the screen
 *     and a chat slides over it (src/scss/partials/_chat.scss #column-center, _leftSidebar.scss
 *     #column-left: 100vw / -25vw with --tabs-transition), with a back button and tweb's edge swipe
 *     back (src/helpers/dom/handleHorizontalSwipe.ts, handleTabSwipe.ts), the --vh viewport height
 *     (src/index.ts) and long-press context menus (src/helpers/dom/attachContextMenuListener.ts).
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
import {
    beginSwipeBack,
    moveSwipeBack,
    shouldPreventScroll,
    type SwipeBackState,
} from "../../../../utils/beeper/tgLayout/swipeBack";
import { installViewportHeight } from "../../../../utils/beeper/tgLayout/viewportHeight";
import {
    attachLongPressContextMenu,
    cancelContextMenuOpening,
    needsLongPressEmulation,
} from "../../../../utils/beeper/tgLayout/longPress";
import { TABS_TRANSITION_MS } from "../../../../utils/beeper/tgLayout/constants";
import { type TgNavigation, TgNavigationContext } from "./TgNavigation";

interface TgColumnsProps {
    /** The spaces bar, rendered at the outer edge of the chat-list column. */
    spacePanel: ReactNode;
    /** The chat list. */
    leftPanel: ReactNode;
    /** The page shown beside (or, on handhelds, over) the chat list. */
    children: ReactNode;
    resizeNotifier: ResizeNotifier;
    /** Whether a chat (room or user page) is open, i.e. what a handheld shows instead of the list. */
    chatOpen?: boolean;
    /** Identifies the open chat, so a pending back navigation never closes a newer one. */
    chatKey?: string;
    /** Leave the open chat; called once the handheld slide-out has finished. */
    onBack?: () => void;
}

/** The attribute on <html> that lets overlays (dialogs, menus) follow the tier. */
export const SCREEN_ATTRIBUTE = "data-tg-screen";

export function TgColumns({
    spacePanel,
    leftPanel,
    children,
    resizeNotifier,
    chatOpen = false,
    chatKey,
    onBack,
}: TgColumnsProps): JSX.Element {
    const screen = useScreenSize();
    const handheld = screen === ScreenSize.mobile;

    // ---- Chat-list width (desktop) -------------------------------------------------------------
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

    // ---- Handheld single-pane navigation -------------------------------------------------------
    const [chatShown, setChatShown] = useState(chatOpen);
    const [swipeDx, setSwipeDx] = useState<number | null>(null);
    // tweb only animates the columns after boot (pages/_chats.scss gates on :not(.has-auth-pages)).
    const [animated, setAnimated] = useState(false);
    const backTimer = useRef<number | undefined>(undefined);
    const centerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setAnimated(true));
        return () => window.cancelAnimationFrame(raf);
    }, []);

    useEffect(() => {
        // A new chat (or none) supersedes a pending back navigation.
        window.clearTimeout(backTimer.current);
        backTimer.current = undefined;
        setChatShown(chatOpen);
        setSwipeDx(null);
    }, [chatOpen, chatKey]);

    useEffect(() => () => window.clearTimeout(backTimer.current), []);

    const goBack = useCallback((): void => {
        setSwipeDx(null);
        setChatShown(false);
        window.clearTimeout(backTimer.current);
        // Leave the chat once the column has slid away, so the chat itself is what slides.
        backTimer.current = window.setTimeout(() => {
            backTimer.current = undefined;
            onBack?.();
        }, TABS_TRANSITION_MS);
    }, [onBack]);

    // Edge swipe back (native listeners: touchmove must be non-passive to stop the scroll).
    useEffect(() => {
        const center = centerRef.current;
        if (!handheld || !chatShown || !center) return;
        let swipe: SwipeBackState | null = null;

        const onTouchStart = (e: TouchEvent): void => {
            swipe = e.touches.length === 1 ? beginSwipeBack(e.touches[0].clientX, e.touches[0].clientY) : null;
        };
        const onTouchMove = (e: TouchEvent): void => {
            if (!swipe) return;
            swipe = moveSwipeBack(swipe, e.touches[0].clientX, e.touches[0].clientY);
            if (swipe.phase === "cancelled") {
                swipe = null;
                setSwipeDx(null);
                return;
            }
            if (shouldPreventScroll(swipe)) {
                if (e.cancelable) e.preventDefault();
                cancelContextMenuOpening();
            }
            if (swipe.phase === "committed") {
                swipe = null;
                goBack();
                return;
            }
            setSwipeDx(swipe.phase === "horizontal" ? swipe.dx : null);
        };
        const onTouchEnd = (): void => {
            swipe = null;
            setSwipeDx(null);
        };

        center.addEventListener("touchstart", onTouchStart, { passive: true });
        center.addEventListener("touchmove", onTouchMove, { passive: false });
        center.addEventListener("touchend", onTouchEnd);
        center.addEventListener("touchcancel", onTouchEnd);
        return () => {
            center.removeEventListener("touchstart", onTouchStart);
            center.removeEventListener("touchmove", onTouchMove);
            center.removeEventListener("touchend", onTouchEnd);
            center.removeEventListener("touchcancel", onTouchEnd);
        };
    }, [handheld, chatShown, goBack]);

    // --vh from the visual viewport keeps the composer above the on-screen keyboard.
    useEffect(() => (handheld ? installViewportHeight() : undefined), [handheld]);

    // Long-press → context menu where touch holds never fire `contextmenu`.
    useEffect(() => {
        const center = centerRef.current;
        if (!handheld || !center || !needsLongPressEmulation()) return;
        return attachLongPressContextMenu(center);
    }, [handheld]);

    // Overlays rendered outside this tree (dialogs) follow the tier too.
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute(SCREEN_ATTRIBUTE, screen);
        return () => root.removeAttribute(SCREEN_ATTRIBUTE);
    }, [screen]);

    const navigation = useMemo<TgNavigation>(() => ({ handheld, goBack }), [handheld, goBack]);

    // ---- Render --------------------------------------------------------------------------------
    const collapsed = isEffectivelyCollapsed(pref, screen);
    const width = viewportWidth();
    const style = {
        "--TgColumns-left-width": `${visualLeftWidth(pref, screen, width)}px`,
    } as CSSProperties & Record<string, string>;
    if (handheld && swipeDx !== null) {
        style["--TgColumns-swipe-dx"] = `${swipeDx}px`;
        style["--TgColumns-swipe-progress"] = String(width ? Math.min(1, swipeDx / width) : 0);
    }

    return (
        <TgNavigationContext.Provider value={navigation}>
            <div
                className="mx_TgColumns"
                data-screen={screen}
                data-collapsed={collapsed || undefined}
                data-resizing={resizing || undefined}
                data-chat-shown={(handheld && chatShown) || undefined}
                data-swiping={(handheld && swipeDx !== null) || undefined}
                data-animated={animated || undefined}
                style={style}
            >
                <div className="mx_TgColumns_left" aria-hidden={(handheld && chatShown) || undefined}>
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
                <div
                    className="mx_TgColumns_center"
                    ref={centerRef}
                    aria-hidden={(handheld && !chatShown) || undefined}
                >
                    {children}
                </div>
            </div>
        </TgNavigationContext.Provider>
    );
}
