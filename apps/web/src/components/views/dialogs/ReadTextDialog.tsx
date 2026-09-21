/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a picture said, and what can be done with it: the text itself to read or copy, and a button for
 * each link and time found in it, so a photographed address or a date on a poster is one tap from the
 * thing it means rather than something to retype.
 */

import React, { type JSX, useEffect, useState } from "react";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import Spinner from "../elements/Spinner";
import AccessibleButton from "../elements/AccessibleButton";
import { copyPlaintext } from "../../../utils/strings";
import { type Detected, detectEntities, icsForEvent } from "../../../utils/detect/entities";
import { type OcrResult } from "../../../utils/detect/ocr";

interface Props {
    /** Resolves with the text, or undefined when there was none worth offering. */
    read: Promise<OcrResult | undefined>;
    onFinished(this: void): void;
}

/** Hands the calendar a detected time, the same way the message menu does. */
function addToCalendar(when: Extract<Detected, { kind: "datetime" }>, text: string): void {
    const ics = icsForEvent({ title: when.text, start: when.date, hasTime: when.hasTime, description: text });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "event.ics";
    link.click();
    URL.revokeObjectURL(url);
}

export default function ReadTextDialog({ read, onFinished }: Props): JSX.Element {
    const [result, setResult] = useState<OcrResult | undefined | null>(null);

    useEffect(() => {
        let cancelled = false;
        void read.then((value) => {
            if (!cancelled) setResult(value);
        });
        return () => {
            cancelled = true;
        };
    }, [read]);

    // The languages and dialling codes load with the detector, so what it found arrives after the text.
    const [entities, setEntities] = useState<Detected[]>([]);
    useEffect(() => {
        if (!result) return;
        let cancelled = false;
        void detectEntities(result.text).then((found) => {
            if (!cancelled) setEntities(found);
        });
        return () => {
            cancelled = true;
        };
    }, [result]);

    return (
        <BaseDialog title={_t("timeline|read_text|title")} onFinished={onFinished} className="mx_ReadTextDialog">
            {result === null && <Spinner />}
            {result === undefined && <p>{_t("timeline|read_text|nothing_found")}</p>}
            {result && (
                <>
                    <p className="mx_ReadTextDialog_text">{result.text}</p>
                    <div className="mx_ReadTextDialog_actions">
                        <AccessibleButton kind="primary_outline" onClick={() => void copyPlaintext(result.text)}>
                            {_t("action|copy")}
                        </AccessibleButton>
                        {entities.map((entity) =>
                            // A link, an address, a flight and a parcel are all somewhere to go; a
                            // number is somewhere to ring; a time is something to put in a calendar.
                            entity.kind === "url" ||
                            entity.kind === "address" ||
                            entity.kind === "flight" ||
                            entity.kind === "parcel" ? (
                                <AccessibleButton
                                    key={`${entity.start}`}
                                    kind="primary_outline"
                                    element="a"
                                    onClick={null}
                                    {...{ href: entity.url, target: "_blank", rel: "noreferrer noopener" }}
                                >
                                    {entity.text}
                                </AccessibleButton>
                            ) : entity.kind === "phone" ? (
                                <AccessibleButton
                                    key={`${entity.start}`}
                                    kind="primary_outline"
                                    element="a"
                                    onClick={null}
                                    {...{ href: `tel:${entity.number}` }}
                                >
                                    {entity.text}
                                </AccessibleButton>
                            ) : entity.kind === "datetime" ? (
                                <AccessibleButton
                                    key={`${entity.start}`}
                                    kind="primary_outline"
                                    onClick={() => addToCalendar(entity, result.text)}
                                >
                                    {_t("timeline|context_menu|add_to_calendar")}
                                </AccessibleButton>
                            ) : (
                                // A measurement is its own answer.
                                <span key={`${entity.start}`} className="mx_ReadTextDialog_measure">
                                    {entity.converted}
                                </span>
                            ),
                        )}
                    </div>
                </>
            )}
        </BaseDialog>
    );
}
