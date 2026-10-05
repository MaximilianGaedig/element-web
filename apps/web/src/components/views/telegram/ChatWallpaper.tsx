/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useRef } from "react";

import dis from "../../../dispatcher/dispatcher";
import { useSettingValue } from "../../../hooks/useSettings";
import { useTheme } from "../../../hooks/useTheme";
import { getCustomTheme } from "../../../theme";
import { resolveWallpaper, type WallpaperRef } from "../../../utils/wallpaper/wallpaperProviders";

interface Props {
    /** The wallpaper to draw, as the setting stores it; nothing is drawn for null or an unknown one. */
    wallpaper: WallpaperRef | null;
    /** Whether it answers the user sending a message (the chat's does, a preview does not). */
    animateOnSend?: boolean;
    /** Drawn small, for a picker. */
    swatch?: boolean;
    className?: string;
}

/** Draws a wallpaper from any provider into a box that fills its positioned parent. */
export function ChatWallpaper({ wallpaper, animateOnSend, swatch, className }: Props): JSX.Element | null {
    const host = useRef<HTMLDivElement>(null);
    const resolved = resolveWallpaper(wallpaper);
    useEffect(() => {
        const found = resolveWallpaper(wallpaper);
        if (!found || !host.current) return;
        const mounted = found.provider.mount(host.current, found.presetId, { swatch });
        if (!mounted) return;
        const token = animateOnSend
            ? dis.register((payload) => {
                  if (payload.action === "message_sent") mounted.onMessageSent?.();
              })
            : undefined;
        return () => {
            if (token) dis.unregister(token);
            mounted.destroy();
        };
    }, [wallpaper, animateOnSend, swatch]);

    if (!resolved) return null;
    return <div className={className ? `mx_ChatWallpaper ${className}` : "mx_ChatWallpaper"} ref={host} aria-hidden />;
}

/** Whether a theme (as `useTheme().effectiveTheme` names it) is dark. */
export function isDarkTheme(theme: string): boolean {
    if (theme.startsWith("custom-")) {
        try {
            return !!getCustomTheme(theme.slice("custom-".length)).is_dark;
        } catch {
            return false;
        }
    }
    return theme.startsWith("dark");
}

/** The user's wallpaper for the theme being shown, or null for the theme's plain background. */
export function useChatWallpaper(): { wallpaper: WallpaperRef | null; dark: boolean } {
    const { effectiveTheme } = useTheme();
    const setting = useSettingValue("chatWallpaper");
    const dark = isDarkTheme(effectiveTheme);
    return { wallpaper: (dark ? setting?.dark : setting?.light) ?? null, dark };
}

/** The chat's wallpaper, behind the timeline. */
export function RoomChatWallpaper(): JSX.Element | null {
    const { wallpaper } = useChatWallpaper();
    return <ChatWallpaper wallpaper={wallpaper} animateOnSend />;
}
