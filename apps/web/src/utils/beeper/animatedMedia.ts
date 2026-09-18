/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

/** fi.mau.bridged_sticker (mautrix-go event.BridgedSticker). */
export interface BridgedSticker {
    network?: string;
    id?: string;
    emoji?: string;
    pack_url?: string;
}

/** Playback hints mautrix bridges put in `info` of GIF-like m.video messages. */
export interface AnimatedVideoHints {
    autoplay: boolean;
    loop: boolean;
    hideControls: boolean;
    noAudio: boolean;
    gif: boolean;
    /** Telegram animated/video sticker, or any bridged sticker sent as a video. */
    sticker: boolean;
    bridgedSticker?: BridgedSticker;
    width?: number;
    height?: number;
}

function isHttpUrl(url: unknown): url is string {
    if (typeof url !== "string") return false;
    try {
        return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
        return false;
    }
}

/**
 * The bridge's playback hints for an m.video message, or undefined if it's an ordinary video
 * (no GIF/autoplay/loop/sticker hint), which keeps Element's normal video player.
 */
export function getAnimatedVideoHints(mxEvent: MatrixEvent): AnimatedVideoHints | undefined {
    if (mxEvent.getType() !== EventType.RoomMessage || mxEvent.isRedacted()) return undefined;
    const content = mxEvent.getContent();
    if (content.msgtype !== MsgType.Video) return undefined;
    const info = content.info;
    if (!info || typeof info !== "object") return undefined;

    const flag = (key: string): boolean => info[key] === true;
    let bridgedSticker: BridgedSticker | undefined;
    const raw = info["fi.mau.bridged_sticker"];
    if (raw && typeof raw === "object") {
        bridgedSticker = {};
        for (const key of ["network", "id", "emoji"] as const) {
            if (typeof raw[key] === "string" && raw[key]) bridgedSticker[key] = raw[key];
        }
        if (isHttpUrl(raw.pack_url)) bridgedSticker.pack_url = raw.pack_url;
    }

    const hints: AnimatedVideoHints = {
        autoplay: flag("fi.mau.autoplay"),
        loop: flag("fi.mau.loop"),
        hideControls: flag("fi.mau.hide_controls"),
        noAudio: flag("fi.mau.no_audio"),
        gif: flag("fi.mau.gif"),
        sticker: flag("fi.mau.telegram.animated_sticker") || !!bridgedSticker,
        bridgedSticker,
    };
    if (!hints.autoplay && !hints.loop && !hints.gif && !hints.sticker) return undefined;
    if (typeof info.w === "number" && info.w > 0) hints.width = info.w;
    if (typeof info.h === "number" && info.h > 0) hints.height = info.h;
    return hints;
}

/** Whether a message should render sticker-style (no bubble, no caption). */
export function isAnimatedSticker(mxEvent: MatrixEvent): boolean {
    return !!getAnimatedVideoHints(mxEvent)?.sticker;
}

/** Fits width × height into a max × max box, keeping the aspect ratio. */
export function fitSize(width = 256, height = 256, max = 256): { width: number; height: number } {
    const scale = Math.min(1, max / width, max / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
