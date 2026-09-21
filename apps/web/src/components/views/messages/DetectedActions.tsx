/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a message is asking you to do, under the message: the time somebody suggested, offered as a
 * calendar entry; a phone number, offered as a call; an address, offered as a map; a flight or a parcel,
 * offered as where to follow it; a measurement in foreign units, simply converted.
 *
 * This runs on messages whoever sent them, including your own: what you wrote is as likely to be the
 * arrangement as what you were told, and a time you proposed yourself is a time you meant to keep.
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
import LocationIcon from "@vector-im/compound-design-tokens/assets/web/icons/location-pin";
// A paper plane for a flight and a link for a parcel: the icon set has neither a plane nor a box, and a
// borrowed glyph that means something else would be worse than the nearest honest one.
import FlightIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";
import ParcelIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import MeasureIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { markEntities } from "../../../utils/detect/mark";
import { actOn } from "../../../utils/detect/act";
import {
    type DetectedAddress,
    type DetectedDateTime,
    type DetectedFlight,
    type DetectedMeasure,
    type DetectedParcel,
    type DetectedPhone,
    icsForEvent,
} from "../../../utils/detect/entities";
import { formatFullDateNoDay, formatTime } from "../../../DateUtils";
import { mightHold, whenIdle } from "../../../utils/detect/collect";
import { remember } from "../../../utils/detect/collected";
import { MatrixClientPeg } from "../../../MatrixClientPeg";

/** What a message can be asking of you, once the links are left to the timeline. */
type Actionable =
    | DetectedDateTime
    | DetectedPhone
    | DetectedAddress
    | DetectedFlight
    | DetectedParcel
    | DetectedMeasure;

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

/** The icon and words for something that is somewhere to go. */
function label(entity: Exclude<Actionable, DetectedDateTime | DetectedMeasure>): JSX.Element {
    if (entity.kind === "phone")
        return (
            <>
                <CallIcon />
                {entity.text}
            </>
        );
    if (entity.kind === "address")
        return (
            <>
                <LocationIcon />
                {entity.text}
            </>
        );
    if (entity.kind === "flight")
        return (
            <>
                <FlightIcon />
                {`${entity.airline} ${entity.text}`}
            </>
        );
    return (
        <>
            <ParcelIcon />
            {`${entity.carrier} ${entity.text}`}
        </>
    );
}

export function DetectedActions({
    mxEvent,
    bodyRef,
}: {
    mxEvent: MatrixEvent;
    /**
     * The rendered message, so the phrases that became buttons can also be underlined where they were
     * written. A chip says there is a time in here somewhere; a mark says which words it is.
     */
    bodyRef?: React.RefObject<HTMLElement | null>;
}): JSX.Element | null {
    const body = mxEvent.getContent().body;
    const text = typeof body === "string" ? body : "";
    // Links are excluded when they are found: the timeline already makes those clickable in place.
    const [found, setFound] = useState<Actionable[]>([]);

    useEffect(() => {
        setFound([]);
        if (!mightHold(text)) return;
        let cancelled = false;
        const cancelIdle = whenIdle(() => {
            void import("../../../utils/detect/entities").then(async ({ detectEntities }) => {
                const entities = await detectEntities(text);
                /*
                 * Also written down, where it can be looked at later. This message has been read anyway -
                 * that is what put the chips under it - so the list of what the chats contain costs
                 * nothing extra for anything that has been on screen.
                 */
                void remember(MatrixClientPeg.safeGet().getSafeUserId(), mxEvent, entities);
                if (cancelled) return;
                setFound(entities.filter((entity): entity is Actionable => entity.kind !== "url"));
                // And mark them where they were written, which is where a finger goes first.
                if (bodyRef?.current) markEntities(bodyRef.current, entities, (entity) => actOn(entity, text));
            });
        });
        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [text, bodyRef]);

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
                ) : entity.kind === "measure" ? (
                    // Nowhere to go: the answer itself is the whole of what was wanted.
                    <span key={entity.start} className="mx_DetectedActions_chip mx_DetectedActions_chip--plain">
                        <MeasureIcon />
                        {entity.converted}
                    </span>
                ) : (
                    <AccessibleButton
                        key={entity.start}
                        kind="secondary"
                        className="mx_DetectedActions_chip"
                        element="a"
                        onClick={null}
                        {...(entity.kind === "phone"
                            ? { href: `tel:${entity.number}` }
                            : { href: entity.url, target: "_blank", rel: "noreferrer noopener" })}
                    >
                        {label(entity)}
                    </AccessibleButton>
                ),
            )}
        </div>
    );
}
