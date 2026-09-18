/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import BeeperMessageSendStatus from "./BeeperMessageSendStatus";

interface Props {
    mxEvent: MatrixEvent;
}

/**
 * Per-message decorations driven by Beeper/mautrix bridge extensions, rendered under the message
 * body inside the event tile. Kept in one place so EventTile needs a single hook.
 */
export default function BeeperEventTileExtras({ mxEvent }: Props): JSX.Element {
    return (
        <>
            <BeeperMessageSendStatus mxEvent={mxEvent} />
        </>
    );
}
