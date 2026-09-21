/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The pinned-message plate of Telegram Web K (GPL-3.0), in React:
 *   src/components/chat/pinnedMessage.tsx        plate body: border, "Pinned Message #N", subtitle
 *   src/components/chat/pinnedMessageBorder.ts   the segmented bar with its moving mark
 *   src/components/animatedSuper.ts              the subtitle rows sliding up/down on each switch
 *   src/components/animatedCounter.ts            the "#N" counter, scaled away on the newest pin
 *   src/scss/partials/_chatPinned.scss, _animatedSuper.scss, _chatTopbar.scss (.topbar-floating-plates)
 */

import React, { type JSX, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";

import { _t } from "../../../languageHandler";
import { ANIMATED_SUPER_DURATION_MS } from "../../../utils/telegram/tgLayout/constants";
import {
    BORDER_WIDTH,
    borderGeometry,
    pinnedCounter,
    superSides,
    type SuperSide,
    toPinnedIndex,
} from "../../../utils/telegram/tgLayout/pinnedMessage";

/** pinnedMessageBorder.ts render(count, index): `index` counts oldest-first. */
export function PinnedMessageBorder({ count, index }: { count: number; index: number }): JSX.Element {
    const clipId = `mx_TgPinnedBorder_clip_${useId().replace(/:/g, "")}`;
    if (count <= 1) {
        return (
            <div className="mx_TgPinnedBorder" data-testid="tg-pinned-border">
                <div className="mx_TgPinnedBorder_wrapper1" />
            </div>
        );
    }
    const g = borderGeometry(count, index);
    return (
        <div
            className={classNames("mx_TgPinnedBorder", {
                mx_TgPinnedBorder_mask: g.mask,
                mx_TgPinnedBorder_maskTop: g.maskTop,
                mx_TgPinnedBorder_maskBottom: g.maskBottom,
            })}
            data-testid="tg-pinned-border"
        >
            <div
                className="mx_TgPinnedBorder_wrapper"
                style={{
                    clipPath: `url(#${clipId})`,
                    width: `${BORDER_WIDTH}px`,
                    height: `${g.trackHeight}px`,
                    transform: `translateY(-${g.trackTranslateY}px)`,
                }}
            >
                <svg height="0" width="0" aria-hidden="true">
                    <defs>
                        <clipPath id={clipId}>
                            <path d={g.clipPathD} />
                        </clipPath>
                    </defs>
                </svg>
                <div
                    className="mx_TgPinnedBorder_mark"
                    style={{ height: `${g.markHeight}px`, transform: `translateY(${g.markTranslateY}px)` }}
                />
            </div>
        </div>
    );
}

interface SuperRow {
    index: number;
    node: ReactNode;
    side?: SuperSide;
    hiding: boolean;
    entering?: boolean;
}

/**
 * animatedSuper.ts: one row per index; switching index slides the new row in from one side while the
 * previous one leaves to the other, then the old rows are dropped after the 200ms duration.
 */
export function AnimatedSuper({ index, children }: { index: number; children: ReactNode }): JSX.Element {
    const [rows, setRows] = useState<SuperRow[]>(() => [{ index, node: children, hiding: false }]);
    const current = useRef(index);
    const enteringRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (index === current.current) {
            setRows((rs) => rs.map((r) => (r.index === index ? { ...r, node: children } : r)));
            return;
        }
        const previousIndex = current.current;
        current.current = index;
        const { enter, leave } = superSides(index, previousIndex);
        setRows((rs) => [
            ...rs
                .filter((r) => r.index !== index)
                .map((r) => (r.index === previousIndex ? { ...r, side: leave, hiding: true, entering: false } : r)),
            { index, node: children, side: enter, hiding: true, entering: true },
        ]);
    }, [index, children]);

    // setNewRow(index, reflow): paint the entering row at its start side, then let it slide to rest.
    useLayoutEffect(() => {
        if (!rows.some((r) => r.entering)) return;
        void enteringRef.current?.offsetLeft;
        setRows((rs) => rs.map((r) => (r.entering ? { ...r, entering: false, hiding: false } : r)));
    }, [rows]);

    // clearRows(index): drop everything but the current row once the transition is over.
    const rowCount = rows.length;
    useEffect(() => {
        if (rowCount <= 1) return;
        const timer = window.setTimeout(
            () => setRows((rs) => rs.filter((r) => r.index === current.current)),
            ANIMATED_SUPER_DURATION_MS,
        );
        return () => window.clearTimeout(timer);
    }, [rowCount]);

    return (
        <div className="mx_TgAnimatedSuper">
            {rows.map((r) => (
                <div
                    key={r.index}
                    ref={r.entering ? enteringRef : undefined}
                    className={classNames("mx_TgAnimatedSuper_row", r.side && `mx_TgAnimatedSuper_row--${r.side}`, {
                        "mx_TgAnimatedSuper_row--hiding": r.hiding,
                    })}
                    aria-hidden={r.index !== index || undefined}
                >
                    {r.node}
                </div>
            ))}
        </div>
    );
}

interface TgPinnedPlateProps {
    /** Number of pinned events. */
    count: number;
    /** Element's oldest-first index of the pin on show. */
    currentEventIndex: number;
    /** Preview of the pin on show. */
    preview: ReactNode;
    /** Jump to the pin on show (the banner then moves on to the next older one). */
    onFollow: () => void;
    /** The pinned-list toggle, shown for more than one pin. */
    listButton?: ReactNode;
    /** Accessible description of the jump button. */
    followLabel: string;
    /** The pinned message's cover, for a photo, video or sticker (tweb's `.pinned-message-media`). */
    thumbnail?: string | null;
}

export function TgPinnedPlate({
    count,
    currentEventIndex,
    preview,
    onFollow,
    listButton,
    followLabel,
    thumbnail,
}: TgPinnedPlateProps): JSX.Element {
    const pinnedIndex = toPinnedIndex(count, currentEventIndex);
    const counter = pinnedCounter(pinnedIndex, count);
    const id = useId();

    return (
        <div
            role="region"
            className="mx_TgPinned"
            data-many={count > 1 || undefined}
            data-media={!!thumbnail || undefined}
            aria-label={_t("room|pinned_message_banner|description")}
            data-testid="pinned-message-banner"
        >
            <button
                type="button"
                className="mx_TgPinned_main"
                onClick={onFollow}
                aria-label={followLabel}
                aria-describedby={id}
            >
                <PinnedMessageBorder count={count} index={currentEventIndex} />
                {/*
                 * tweb keeps the cover mounted and scales it to nothing when the message has none, so
                 * moving between a photo and a text message animates rather than reflowing the rows.
                 */}
                <span className="mx_TgPinned_media" aria-hidden>
                    {thumbnail && <img src={thumbnail} alt="" draggable={false} />}
                </span>
                <div className="mx_TgPinned_content" id={id}>
                    <div className="mx_TgPinned_title">
                        {_t("tg_layout|pinned_message")}{" "}
                        <span
                            className="mx_TgPinned_counter"
                            data-last={counter.isLast || undefined}
                            data-testid="tg-pinned-counter"
                        >
                            {counter.value}
                        </span>
                    </div>
                    <div className="mx_TgPinned_subtitle" data-testid="banner-message">
                        <AnimatedSuper index={pinnedIndex}>{preview}</AnimatedSuper>
                    </div>
                </div>
            </button>
            {count > 1 && listButton}
        </div>
    );
}
