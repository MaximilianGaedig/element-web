/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type RefObject, useEffect } from "react";

interface Props {
    /** The room body (.mx_RoomView_body), which holds the header, timeline, status area and composer. */
    body: RefObject<HTMLDivElement | null>;
}

/**
 * The Telegram-style chat chrome: the header and composer float over the timeline (which scrolls behind
 * them), and the messages fade out into the chat background towards both edges. This keeps the
 * space the floating header (plus pinned plate) and composer (plus status bar) take in `--tg-header-block` and
 * `--tg-composer-block` on the body, which pad the message list and size the fade edges.
 */
export function TgChatChrome({ body }: Props): JSX.Element {
    useEffect(() => {
        const el = body.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        /*
         * These pad the message list, so writing one moves every message: a sub-pixel change (a rect is
         * fractional, and the header's own text reflows as a chat's status changes) would shift the
         * timeline under a finger that is scrolling it. Whole pixels only, and only when the value it
         * would write is not the one already there.
         */
        const set = (name: string, px: number): void => {
            const value = `${Math.round(px)}px`;
            if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
        };
        const update = (): void => {
            const b = el.getBoundingClientRect();
            const header = el.querySelector(":scope > .mx_RoomHeader")?.getBoundingClientRect();
            const pinned = el.querySelector(":scope > .mx_TgPinned")?.getBoundingClientRect();
            const composer = el.querySelector(":scope > .mx_MessageComposer")?.getBoundingClientRect();
            const status = el.querySelector(":scope > .mx_RoomView_statusArea")?.getBoundingClientRect();
            const headerBottom = header ? Math.max(0, header.bottom - b.top) : 0;
            // The pinned plate floats under the header; the top block (padding, blur) covers both.
            const pinnedBottom = pinned?.height ? Math.max(0, pinned.bottom - b.top) : 0;
            // The import banner stacks under the pinned plate (or straight under the header).
            const importPlate = el.querySelector(":scope > .mx_TgImport")?.getBoundingClientRect();
            const importBottom = importPlate?.height ? Math.max(0, importPlate.bottom - b.top) : 0;
            set("--tg-header-bottom", headerBottom);
            set("--tg-plates-bottom", Math.max(headerBottom, pinnedBottom));
            set("--tg-header-block", Math.max(headerBottom, pinnedBottom, importBottom));
            set("--tg-composer-block", composer ? Math.max(0, b.bottom - composer.top) + (status?.height ?? 0) : 0);
        };
        const observer = new ResizeObserver(update);
        const observeChildren = (): void => {
            observer.disconnect();
            observer.observe(el);
            for (const child of el.querySelectorAll(
                ":scope > .mx_RoomHeader, :scope > .mx_TgPinned, :scope > .mx_TgImport, :scope > .mx_MessageComposer, :scope > .mx_RoomView_statusArea",
            )) {
                observer.observe(child);
            }
            update();
        };
        // The composer and status area come and go (e.g. while joining), so re-observe on changes.
        const mutations = new MutationObserver(observeChildren);
        mutations.observe(el, { childList: true });
        observeChildren();
        return () => {
            observer.disconnect();
            mutations.disconnect();
            el.style.removeProperty("--tg-header-bottom");
            el.style.removeProperty("--tg-plates-bottom");
            el.style.removeProperty("--tg-header-block");
            el.style.removeProperty("--tg-composer-block");
        };
    }, [body]);

    return (
        <>
            {(["top", "bottom"] as const).map((edge) => (
                <div key={edge} className={`mx_TgFadeEdge mx_TgFadeEdge_${edge}`} aria-hidden />
            ))}
        </>
    );
}
