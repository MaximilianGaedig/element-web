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
