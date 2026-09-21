/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What pressing a detected thing does.
 *
 * The same phrase can be pressed in three places - underlined in a message, underlined over a picture,
 * or as a chip below either - and it has to do the same thing in all three. So it is decided once, here,
 * rather than three times in three components that will drift apart.
 */

import { type Detected, icsForEvent } from "./entities";

/** Opens somewhere, in a new tab, without handing the opener over. */
function open(url: string): void {
    window.open(url, "_blank", "noreferrer,noopener");
}

/**
 * Acts on what was pressed.
 *
 * `context` is the text the thing was found in, which becomes the calendar entry's description: an
 * appointment with no more than a date in it is one nobody can make sense of a week later.
 */
export function actOn(entity: Detected, context = ""): void {
    switch (entity.kind) {
        case "url":
            open(entity.url);
            break;
        case "phone":
            window.location.href = `tel:${entity.number}`;
            break;
        case "address":
        case "flight":
        case "parcel":
            open(entity.url);
            break;
        case "datetime": {
            const ics = icsForEvent({
                title: (context || entity.text).slice(0, 80),
                start: entity.date,
                hasTime: entity.hasTime,
                description: context || undefined,
            });
            const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "event.ics";
            link.click();
            URL.revokeObjectURL(url);
            break;
        }
        case "measure":
            // Its own answer: there is nowhere to go, and the chip beside it already says what it comes to.
            break;
    }
}
