/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The time (and, on outgoing messages, the sending status) in the bottom inline-end corner of a
 * bubble, as Telegram Web K draws it (GPL-3.0, https://github.com/morethanwords/tweb):
 * src/components/chat/messageRender.ts MessageRender.setTime builds `.time > .time-inner`, and
 * src/components/chat/bubbles.ts setBubbleSendingStatus prepends `.time-sending-status`
 * (check / checks / sending / sendingerror_filled). This element is tweb's absolutely positioned
 * `.time-inner`. tweb reserves its room with an invisible copy (`.time`, floated to the end of the
 * last text line); the shared body components can't take extra children, so the reservation is a
 * floated pseudo-element whose width we measure from this element (--TgTime-width on the line).
 */

import React, { type JSX, type ReactNode, useLayoutEffect, useRef } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { type TelegramSendState, type TelegramTimePlacement } from "../../../../utils/beeper/telegramTime";
import { TgCheckIcon, TgChecksIcon, TgSendingErrorIcon, TgSendingIcon } from "./TelegramIcons";

interface Props {
    /** The rendered timestamp (Element's MessageTimestamp, keeping its permalink and tooltip). */
    timestamp: ReactNode;
    /** Delivery state, for our own messages only. */
    sendState?: TelegramSendState;
    placement: TelegramTimePlacement;
    /** Extra time parts shown before the time (tweb's `.time-part`s), e.g. the disappearing timer. */
    parts?: ReactNode;
}

function statusLabel(state: TelegramSendState): string {
    switch (state) {
        case "sending":
            return _t("timeline|send_state_sending");
        case "error":
            return _t("timeline|send_state_failed");
        case "sent":
            return _t("timeline|send_state_sent");
        case "delivered":
            return _t("beeper|telegram_state_delivered");
        case "read":
            return _t("beeper|telegram_state_read");
    }
}

/** The glyph tweb shows for a sending status (bubbles.ts setBubbleSendingStatus). */
export function TelegramSendStatusIcon({ state }: { state: TelegramSendState }): JSX.Element {
    const props = { className: "mx_TelegramTime_status", "data-state": state };
    const label = statusLabel(state);
    let icon: JSX.Element;
    if (state === "error") icon = <TgSendingErrorIcon />;
    else if (state === "sending") icon = <TgSendingIcon />;
    else if (state === "sent") icon = <TgCheckIcon />;
    else icon = <TgChecksIcon />;
    return (
        <span {...props} role="img" aria-label={label} title={label}>
            {icon}
        </span>
    );
}

/** One observer for every tile: writes each time element's width onto its bubble line. */
let observer: ResizeObserver | undefined;
function getObserver(): ResizeObserver | undefined {
    if (!observer && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver((entries) => {
            // Batched before paint; borderBoxSize avoids forcing a layout per tile.
            for (const entry of entries) {
                const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
                getLine(entry.target)?.style.setProperty("--TgTime-width", `${Math.ceil(width)}px`);
            }
        });
    }
    return observer;
}

/** The bubble line that carries the reservation for a time element. */
function getLine(el: Element): HTMLElement | null {
    return el.closest<HTMLElement>(".mx_EventTile_line");
}

function useReserveWidth(ref: React.RefObject<HTMLElement | null>): void {
    useLayoutEffect(() => {
        const el = ref.current;
        const ro = getObserver();
        if (!el || !ro) return;
        ro.observe(el);
        return () => {
            ro.unobserve(el);
            getLine(el)?.style.removeProperty("--TgTime-width");
        };
    }, [ref]);
}

export default function TelegramTime({ timestamp, sendState, placement, parts }: Props): JSX.Element {
    const ref = useRef<HTMLSpanElement>(null);
    useReserveWidth(ref);
    return (
        <span
            ref={ref}
            className={classNames("mx_TelegramTime", {
                mx_TelegramTime_floating: placement === "floating",
            })}
            data-send-state={sendState}
        >
            {parts}
            {timestamp}
            {sendState && <TelegramSendStatusIcon state={sendState} />}
        </span>
    );
}
