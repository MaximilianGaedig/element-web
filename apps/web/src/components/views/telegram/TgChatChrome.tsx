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

/** Five blur layers per edge, 1px to 16px, each masked to its band (see _TelegramLayout.pcss). */
const LAYERS = 5;

/**
 * The Telegram-style chat chrome: the header and composer float over the timeline (which scrolls behind
 * them), and the timeline is blurred progressively towards both edges like Telegram iOS. This keeps the
 * space the floating header (plus pinned plate) and composer (plus status bar) take in `--tg-header-block` and
 * `--tg-composer-block` on the body, which pad the message list and size the blur edges.
 */
export function TgChatChrome({ body }: Props): JSX.Element {
    useEffect(() => {
        const el = body.current;
        if (!el || typeof ResizeObserver === "undefined") return;
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
            el.style.setProperty("--tg-header-bottom", `${headerBottom}px`);
            el.style.setProperty("--tg-plates-bottom", `${Math.max(headerBottom, pinnedBottom)}px`);
            el.style.setProperty("--tg-header-block", `${Math.max(headerBottom, pinnedBottom, importBottom)}px`);
            el.style.setProperty(
                "--tg-composer-block",
                `${composer ? Math.max(0, b.bottom - composer.top) + (status?.height ?? 0) : 0}px`,
            );
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
                <div key={edge} className={`mx_TgBlurEdge mx_TgBlurEdge_${edge}`} aria-hidden>
                    {Array.from({ length: LAYERS }, (_, i) => (
                        <i key={i} />
                    ))}
                </div>
            ))}
        </>
    );
}
