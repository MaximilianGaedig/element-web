/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Telegram-style message context menu logic, ported from Telegram Web K (GPL-3.0,
 * https://github.com/morethanwords/tweb): src/helpers/positionMenu.ts (positionMenu),
 * src/components/chat/reactionsMenu.ts (ChatReactionsMenu) and src/components/chat/contextMenu.ts
 * (ChatContextMenu.getReactionsMenuPadding).
 */

/** reactionsMenu.ts REACTIONS_MAX_LENGTH: reactions shown in the bar before the "more" button. */
export const REACTIONS_MAX_LENGTH = 7;

/**
 * Telegram's default reactions, in the order the server lists them (messages.getAvailableReactions),
 * which is what a new account's top reactions start as. Matrix has no server-side top reactions, so
 * the user's frequently/recently used emoji (Element's recent emoji) come first.
 */
export const TELEGRAM_DEFAULT_REACTIONS = [
    "👍",
    "👎",
    "❤️",
    "🔥",
    "🥰",
    "👏",
    "😁",
    "🤔",
    "🤯",
    "😱",
    "🤬",
    "😢",
    "🎉",
    "🤩",
    "🤮",
    "💩",
    "🙏",
    "👌",
    "🕊",
    "🤡",
    "🥱",
    "🥴",
    "😍",
    "🐳",
    "❤️‍🔥",
    "🌚",
    "🌭",
    "💯",
    "🤣",
    "⚡",
    "🍌",
    "🏆",
    "💔",
    "🤨",
    "😐",
    "🍓",
    "🍾",
    "💋",
    "😈",
    "😴",
    "😭",
    "🤓",
    "👻",
    "👨‍💻",
    "👀",
    "🎃",
    "🙈",
    "😇",
    "😨",
    "🤝",
    "✍",
    "🤗",
    "🫡",
    "🎅",
    "🎄",
    "☃",
    "💅",
    "🤪",
    "🗿",
    "🆒",
    "💘",
    "🙉",
    "🦄",
    "😘",
    "💊",
    "🙊",
    "😎",
    "👾",
    "🤷‍♂",
    "🤷",
    "🤷‍♀",
    "😡",
];

const strip = (s: string): string => s.replace(/️/g, "");

/**
 * The reactions offered in the bar, in order: like tweb's chatReactionsSome, a network that only
 * allows some reactions offers exactly those (in its order); otherwise the user's frequent and
 * recent emoji, then Telegram's defaults (tweb: top reactions, recent reactions after them).
 */
/** @knipignore Telegram Web's menu logic, ported with tests; the menu itself is Element's again. */
export function getMenuReactions(recent: string[], allowed?: string[]): string[] {
    if (allowed) return allowed.slice();
    const seen = new Set<string>();
    const result: string[] = [];
    for (const emoji of [...recent, ...TELEGRAM_DEFAULT_REACTIONS]) {
        const key = strip(emoji);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(emoji);
    }
    return result;
}

/** The bar shows REACTIONS_MAX_LENGTH reactions and a "more" button if there are more (reactionsMenu.ts renderReactions). */
/** @knipignore Telegram Web's menu logic, ported with tests; the menu itself is Element's again. */
export function splitMenuReactions(reactions: string[]): { shown: string[]; hasMore: boolean } {
    return { shown: reactions.slice(0, REACTIONS_MAX_LENGTH), hasMore: reactions.length > REACTIONS_MAX_LENGTH };
}

export interface MenuPositionPadding {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}

/** positionMenu.ts PADDING_TOP / PADDING_LEFT (and their bottom/right twins). */
const MENU_PADDING = 8;

export interface MenuPosition {
    left: number;
    top: number;
    /** tweb's position class, e.g. "bottom-right": where the menu opens relative to the point (sets transform-origin). */
    className: string;
}

/**
 * tweb's positionMenu: open the menu at the pointer, to its inline end on desktop and to its
 * inline start on mobile (where the finger is), falling back to the window edge when it doesn't
 * fit; below the pointer, or bottom-aligned to the window when it doesn't fit below.
 */
/** @knipignore Telegram Web's menu logic, ported with tests; the menu itself is Element's again. */
export function positionMenu(
    point: { x: number; y: number },
    menu: { width: number; height: number },
    windowSize: { width: number; height: number },
    {
        isMobile = false,
        isRtl = false,
        padding,
    }: { isMobile?: boolean; isRtl?: boolean; padding?: MenuPositionPadding } = {},
): MenuPosition {
    const paddingTop = MENU_PADDING + (padding?.top ?? 0);
    const paddingRight = MENU_PADDING + (padding?.right ?? 0);
    const paddingBottom = MENU_PADDING + (padding?.bottom ?? 0);
    const paddingLeft = MENU_PADDING + (padding?.left ?? 0);

    let side: "left" | "right" | "center" = isRtl ? (isMobile ? "left" : "right") : isMobile ? "right" : "left";
    let verticalSide: "top" | "center" = "top";

    const maxTop = windowSize.height - menu.height - paddingBottom;
    const maxLeft = windowSize.width - menu.width - paddingRight;
    const minLeft = paddingLeft;

    const sidesX = { left: point.x, right: Math.min(maxLeft, point.x - menu.width) };
    const intermediateX = side === "right" ? minLeft : maxLeft;
    const possibleX = {
        left: sidesX.left + menu.width + paddingRight <= windowSize.width,
        right: sidesX.right >= paddingLeft,
    };
    const possibleTop = point.y + menu.height + paddingBottom <= windowSize.height;

    const openSide = side;
    const left = possibleX[openSide] ? sidesX[openSide] : ((side = "center"), intermediateX);
    const top = possibleTop ? point.y : ((verticalSide = "center"), maxTop);

    const horizontal = side === "center" ? side : (isRtl ? side === "right" : side === "left") ? "right" : "left";
    return {
        left,
        top: Math.max(top, paddingTop),
        className: `${verticalSide === "center" ? verticalSide : "bottom"}-${horizontal}`,
    };
}

/** attachContextMenuListener.ts: a touch held this long opens the menu. */
export const LONG_PRESS_MS = 400;

/**
 * tweb's attachContextMenuListener for Apple touch devices, which fire no `contextmenu` on a long
 * press: a single touch held for LONG_PRESS_MS without moving opens the menu at the touch point.
 * Elsewhere the browser's own `contextmenu` (long press on Android) is used. Returns a detach function.
 */
export function attachLongPress(element: HTMLElement, callback: (point: { x: number; y: number }) => void): () => void {
    let timeout: number | undefined;
    const options: AddEventListenerOptions = { capture: true };
    const onCancel = (): void => {
        window.clearTimeout(timeout);
        element.removeEventListener("touchmove", onCancel, options);
        element.removeEventListener("touchend", onCancel, options);
        element.removeEventListener("touchcancel", onCancel, options);
    };
    const onTouchStart = (e: TouchEvent): void => {
        if (e.touches.length > 1) {
            onCancel();
            return;
        }
        const touch = e.touches[0];
        element.addEventListener("touchmove", onCancel, options);
        element.addEventListener("touchend", onCancel, options);
        element.addEventListener("touchcancel", onCancel, options);
        timeout = window.setTimeout(() => {
            onCancel();
            callback({ x: touch.clientX, y: touch.clientY });
            // * fix instant closing: swallow the touchend that follows
            element.addEventListener("touchend", (ev) => ev.preventDefault(), { once: true });
        }, LONG_PRESS_MS);
    };
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
        onCancel();
        element.removeEventListener("touchstart", onTouchStart);
    };
}

/** tweb's IS_APPLE && IS_TOUCH_SUPPORTED. */
export function isAppleTouch(): boolean {
    if (typeof navigator === "undefined") return false;
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    return apple && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}
