/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { type MatrixEvent, MatrixEventEvent } from "matrix-js-sdk/src/matrix";

import { parseBridgeButtons, type TelegramButtonsContent } from "../../../utils/BridgeButtons";
import BridgeButton from "./BridgeButton";

interface Props {
    mxEvent: MatrixEvent;
    /** When true, disables all interaction (e.g. tile previews). */
    inhibitInteraction?: boolean;
}

/**
 * Renders a bridged Telegram inline keyboard (`fi.mau.telegram.buttons` with `keyboard`
 * absent or `"inline"`) attached to a message event, if present. Reply/hide/force_reply
 * keyboards are handled by `BridgeReplyKeyboard` above the room composer instead.
 *
 * See {@link BridgeButton} for how each button type behaves.
 *
 * Reads content via `mxEvent.getContent()`, which already resolves edits (`m.new_content`);
 * this component also listens for `MatrixEventEvent.Replaced` directly so it re-renders (or
 * disappears, if the edit removed the keyboard) even if used outside of `EventTile`'s own
 * replace-handling.
 */
export default function BridgeButtons({ mxEvent, inhibitInteraction }: Props): JSX.Element | null {
    const [content, setContent] = useState<TelegramButtonsContent | null>(() =>
        parseBridgeButtons(mxEvent.getContent()),
    );
    useEffect(() => {
        const update = (): void => setContent(parseBridgeButtons(mxEvent.getContent()));
        update();
        mxEvent.on(MatrixEventEvent.Replaced, update);
        return () => {
            mxEvent.removeListener(MatrixEventEvent.Replaced, update);
        };
    }, [mxEvent]);

    if (!content || mxEvent.isRedacted()) return null;

    return (
        <div className="mx_BridgeButtons">
            {/* Keyboard rows and buttons are positional and carry no IDs. */}
            {content.rows.map((row, r) => (
                // oxlint-disable-next-line react/no-array-index-key
                <div className="mx_BridgeButtons_row" key={r}>
                    {row.map((btn, c) => (
                        <BridgeButton
                            // oxlint-disable-next-line react/no-array-index-key
                            key={c}
                            button={btn}
                            roomId={mxEvent.getRoomId()}
                            inhibitInteraction={inhibitInteraction}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}
