/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a message is asking you to do, under the message: the time somebody suggested, offered as a
 * calendar entry, and a phone number, offered as a call.
 *
 * Links are left out on purpose - they are already underlined and clickable where they are written, and
 * a chip repeating them would be noise. A message that names nothing shows nothing at all, which is
 * most of them.
 *
 * Detecting costs the parsers for fifteen languages and the world's dialling codes, so it happens off
 * the render: while the browser is idle, only for a message whose text could possibly hold a number,
 * and only once per message.
 */

import React, { type JSX, useEffect, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import CalendarIcon from "@vector-im/compound-design-tokens/assets/web/icons/calendar";
import CallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { type DetectedDateTime, type DetectedPhone, icsForEvent } from "../../../utils/detect/entities";
import { formatFullDateNoDay, formatTime } from "../../../DateUtils";

/** Nothing without a digit in it can name a time or a number, and that is most messages. */
const COULD_HOLD_ONE = /\d/;

/** Runs `work` when the browser is next idle, or soon, where that is not offered. */
function whenIdle(work: () => void): () => void {
    const idle = window.requestIdleCallback;
    if (idle) {
        const handle = idle(work, { timeout: 2000 });
        return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(work, 500);
    return () => window.clearTimeout(handle);
}

function addToCalendar(when: DetectedDateTime, description: string): void {
    const ics = icsForEvent({ title: description.slice(0, 80), start: when.date, hasTime: when.hasTime, description });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "event.ics";
    link.click();
    URL.revokeObjectURL(url);
}

/** The chip's own words: the day, and the time when one was given. */
function whenLabel(when: DetectedDateTime): string {
    const day = formatFullDateNoDay(when.date);
    return when.hasTime ? `${day}, ${formatTime(when.date)}` : day;
}

export function DetectedActions({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element | null {
    const body = mxEvent.getContent().body;
    const text = typeof body === "string" ? body : "";
    // Links are excluded when they are found: the timeline already makes those clickable in place.
    const [found, setFound] = useState<Array<DetectedDateTime | DetectedPhone>>([]);

    useEffect(() => {
        setFound([]);
        if (!COULD_HOLD_ONE.test(text)) return;
        let cancelled = false;
        const cancelIdle = whenIdle(() => {
            void import("../../../utils/detect/entities").then(async ({ detectEntities }) => {
                const entities = await detectEntities(text);
                if (cancelled) return;
                setFound(
                    entities.filter((entity): entity is DetectedDateTime | DetectedPhone => entity.kind !== "url"),
                );
            });
        });
        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [text]);

    if (!found.length) return null;
    return (
        <div className="mx_DetectedActions">
            {found.map((entity) =>
                entity.kind === "datetime" ? (
                    <AccessibleButton
                        key={entity.start}
                        kind="secondary"
                        className="mx_DetectedActions_chip"
                        onClick={() => addToCalendar(entity, text)}
                        title={_t("timeline|context_menu|add_to_calendar")}
                    >
                        <CalendarIcon />
                        {whenLabel(entity)}
                    </AccessibleButton>
                ) : (
                    <AccessibleButton
                        key={entity.start}
                        kind="secondary"
                        className="mx_DetectedActions_chip"
                        element="a"
                        onClick={null}
                        {...{ href: `tel:${entity.number}` }}
                    >
                        <CallIcon />
                        {entity.text}
                    </AccessibleButton>
                ),
            )}
        </div>
    );
}
