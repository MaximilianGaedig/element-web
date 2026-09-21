/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the model is doing, over the composer, while it does it.
 *
 * Nothing else. Asking is offered from the composer's own menu, where the other things you can do with a
 * message already are - a row of buttons of its own, above the box you type in, in every chat, was a
 * permanent advertisement for a feature used twice a day, and it cost ninety pixels of the conversation
 * to say so.
 *
 * So this is on screen only while something is happening or has just failed, which is the only time any of
 * it is worth a line: the menu that started the work has closed by then, and a wait you can see the shape
 * of is a shorter wait. The words themselves arrive in the timeline, in place (AiNote).
 */

import React, { type JSX } from "react";
import AiIcon from "@vector-im/compound-design-tokens/assets/web/icons/ai";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { IconButton } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { dismissFailure, useAsking } from "../../../utils/ai/asking";

export function AiStatus(): JSX.Element | null {
    const { doing, failed } = useAsking();

    if (doing) {
        return (
            <div className="mx_AiStatus" aria-live="polite">
                <AiIcon className="mx_Ai_mark" aria-hidden />
                <span className="mx_AiStatus_what">{doing}</span>
            </div>
        );
    }

    if (failed) {
        return (
            <div className="mx_AiStatus mx_AiStatus_failed" role="status">
                <span className="mx_AiStatus_what">{failed}</span>
                <IconButton size="20px" aria-label={_t("action|dismiss")} onClick={dismissFailure}>
                    <CloseIcon />
                </IconButton>
            </div>
        );
    }

    return null;
}
