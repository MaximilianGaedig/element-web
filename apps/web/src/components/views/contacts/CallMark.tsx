/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * How a call is shown, wherever it is listed: the calls tab and a contact's own card use the same mark,
 * the same duration and the same times, so a call reads the same from either end.
 */

import React, { type JSX } from "react";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import VoiceMissedIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-missed-solid";
import VoiceDeclinedIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-declined-solid";
import VoiceOutgoingIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-outgoing-solid";
import VideoMissedIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-missed-solid";
import VideoDeclinedIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-declined-solid";
import VideoOutgoingIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-outgoing-solid";

import { _t } from "../../../languageHandler";
import { type Call } from "../../../utils/contacts/calls";

/** How long a call lasted, in the shortest form that is still true. */
export function readDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/**
 * What kind of call it was, which way it went, and how it ended, in one mark.
 *
 * Compound carries the whole set (`voice-call-missed-solid`, `-declined-solid`, `-outgoing-solid` and the
 * video equivalents), which is the same distinction a phone's recents list draws with its arrows - so the
 * row says "missed video call" before any of its words are read.
 */
export function CallMark({ call }: { call: Call }): JSX.Element {
    /*
     * The mark is the only thing that says which way the call went, so it says it out loud as well: the
     * word beside it is gone, and a label a screen reader can read is what replaces it rather than nothing.
     * `data-mark` colours it - red for the one that needs answering, as a phone colours it.
     */
    const kind = call.outgoing ? "outgoing" : call.outcome === "missed" ? "missed" : call.outcome;
    const label = call.outgoing
        ? _t("contacts|call_outgoing")
        : kind === "missed"
          ? _t("contacts|call_missed")
          : kind === "declined"
            ? _t("contacts|call_declined")
            : _t("contacts|call_incoming");
    const props = {
        "className": "mx_Contacts_callMark",
        "width": "16",
        "height": "16",
        "data-mark": kind,
        "aria-label": label,
        "role": "img",
    } as const;
    if (call.outgoing) return call.video ? <VideoOutgoingIcon {...props} /> : <VoiceOutgoingIcon {...props} />;
    if (call.outcome === "missed") return call.video ? <VideoMissedIcon {...props} /> : <VoiceMissedIcon {...props} />;
    if (call.outcome === "declined") {
        return call.video ? <VideoDeclinedIcon {...props} /> : <VoiceDeclinedIcon {...props} />;
    }
    return call.video ? <VideoCallIcon {...props} /> : <VoiceCallIcon {...props} />;
}

/** The time of day a call happened, since which day it was is the section it sits in. */
export const timeOfDay = (ts: number): string =>
    new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** How many names a row has room for before it says "and 3 others". */
const NAMES_SHOWN = 2;

/**
 * Who was in a call, the way a phone's call log says it: "You, Ada and 3 others".
 *
 * The reader comes first because "was I there" is the first thing the row is asked, and said as "You" so
 * the same sentence works from everyone's point of view. Undefined for a call that does not say who took part.
 */
export function callPeople(call: Call): string | undefined {
    const everyone = call.participants ?? [];
    if (!everyone.length) return undefined;
    const names = [
        ...everyone.filter((p) => p.you).map(() => _t("contacts|call_you")),
        ...everyone.filter((p) => !p.you).map((p) => p.name),
    ];
    if (names.length <= NAMES_SHOWN + 1) return names.join(", ");
    return _t("contacts|call_people_more", {
        names: names.slice(0, NAMES_SHOWN).join(", "),
        count: names.length - NAMES_SHOWN,
    });
}

/**
 * The line under a call's title, in one place so the calls tab and a contact's card read a call the same way:
 * whether it is still going, who was in it, how long it ran. "Group call" is said only where nobody is named,
 * since a list of people already says it.
 */
export function callDetail(call: Call): string[] {
    const people = callPeople(call);
    return [
        call.ongoing ? _t("contacts|call_ongoing") : undefined,
        people,
        call.seconds !== undefined ? readDuration(call.seconds) : undefined,
        call.group && !people ? _t("contacts|call_group") : undefined,
    ].filter((part): part is string => !!part);
}

/** Everything a row cannot fit, for the tooltip: every name, and when it started and ended. */
export function callTooltip(call: Call): string | undefined {
    const everyone = call.participants ?? [];
    const names = [...everyone.filter((p) => p.you), ...everyone.filter((p) => !p.you)].map((p) =>
        p.you ? _t("contacts|call_you") : p.name,
    );
    if (!names.length) return undefined;
    const span =
        call.endTs && call.endTs > call.ts ? `${timeOfDay(call.ts)} – ${timeOfDay(call.endTs)}` : timeOfDay(call.ts);
    return `${names.join(", ")}\n${span}`;
}
