/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type MatrixEvent, MatrixEventEvent } from "matrix-js-sdk/src/matrix";
import { Button } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../languageHandler";
import { isUrlPermitted } from "../../../HtmlUtils";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { parseBridgeButtons, type TelegramButtonsContent } from "../../../utils/BridgeButtons";

// How long a callback button stays disabled after being pressed, to guard against double-sends.
const PRESS_COOLDOWN_MS = 3000;

interface Props {
    mxEvent: MatrixEvent;
    /** When true, disables all interaction (e.g. tile previews). */
    inhibitInteraction?: boolean;
}

/**
 * Renders a bridged Telegram inline keyboard (`fi.mau.telegram.buttons`) attached to a
 * message event, if present.
 *
 * - `callback` buttons send their `command` as a plain `m.text` message into the room's
 *   main timeline (never into a thread - the bridge only watches the main timeline for
 *   command messages, per mautrix-go bridgev2/queue.go), and are disabled briefly after
 *   being pressed to avoid double-sends.
 * - `url` buttons render as real links, restricted to Element's permitted URL schemes.
 * - Anything else (including malformed callback/url buttons) renders as a disabled button.
 *
 * Reads content via `mxEvent.getContent()`, which already resolves edits (`m.new_content`);
 * this component also listens for `MatrixEventEvent.Replaced` directly so it re-renders (or
 * disappears, if the edit removed the keyboard) even if used outside of `EventTile`'s own
 * replace-handling.
 */
export default function BridgeButtons({ mxEvent, inhibitInteraction }: Props): JSX.Element | null {
    const cli = useMatrixClientContext();
    const [content, setContent] = useState<TelegramButtonsContent | null>(() =>
        parseBridgeButtons(mxEvent.getContent()),
    );
    const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        const update = (): void => setContent(parseBridgeButtons(mxEvent.getContent()));
        update();
        mxEvent.on(MatrixEventEvent.Replaced, update);
        return () => {
            mxEvent.removeListener(MatrixEventEvent.Replaced, update);
        };
    }, [mxEvent]);

    const onCallbackClick = useCallback(
        (key: string, command: string): void => {
            const roomId = mxEvent.getRoomId();
            if (!roomId) return;

            setPending((prev) => new Set(prev).add(key));
            window.setTimeout(() => {
                setPending((prev) => {
                    if (!prev.has(key)) return prev;
                    const next = new Set(prev);
                    next.delete(key);
                    return next;
                });
            }, PRESS_COOLDOWN_MS);

            // Explicitly target the room's main timeline (threadId: null) regardless of
            // which timeline (room/thread/etc) this tile happens to be rendered in: the
            // bridge only intercepts command messages sent to the main timeline.
            cli.sendTextMessage(roomId, null, command).catch((e: unknown) => {
                logger.warn("Failed to send bridge button command", e);
            });
        },
        [cli, mxEvent],
    );

    if (!content || mxEvent.isRedacted()) return null;

    return (
        <div className="mx_BridgeButtons">
            {content.rows.map((row, r) => (
                <div className="mx_BridgeButtons_row" key={r}>
                    {row.map((btn, c) => {
                        const key = `${r}-${c}`;
                        switch (btn.type) {
                            case "url": {
                                const safe = isUrlPermitted(btn.url);
                                return (
                                    <Button
                                        as="a"
                                        key={key}
                                        kind="secondary"
                                        size="sm"
                                        className="mx_BridgeButtons_button"
                                        href={safe ? btn.url : undefined}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        disabled={inhibitInteraction || !safe}
                                    >
                                        {btn.text}
                                    </Button>
                                );
                            }
                            case "callback": {
                                const isPending = pending.has(key);
                                return (
                                    <Button
                                        key={key}
                                        kind="secondary"
                                        size="sm"
                                        className="mx_BridgeButtons_button"
                                        disabled={inhibitInteraction || isPending}
                                        onClick={() => onCallbackClick(key, btn.command)}
                                    >
                                        {btn.text}
                                    </Button>
                                );
                            }
                            default:
                                return (
                                    <Button
                                        key={key}
                                        kind="secondary"
                                        size="sm"
                                        className="mx_BridgeButtons_button"
                                        disabled
                                        title={_t("timeline|bridge_buttons|unsupported")}
                                    >
                                        {btn.text}
                                    </Button>
                                );
                        }
                    })}
                </div>
            ))}
        </div>
    );
}
