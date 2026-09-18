/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactElement, useEffect, useRef, useState } from "react";
import { User } from "matrix-js-sdk/src/matrix";
import { Button, Tooltip } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../languageHandler";
import { isUrlPermitted } from "../../../HtmlUtils";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { copyPlaintext } from "../../../utils/strings";
import { type TelegramButton, type TelegramCommandButtonType } from "../../../utils/BridgeButtons";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import Modal from "../../../Modal";
import QuestionDialog from "../dialogs/QuestionDialog";

// How long a sending button stays disabled after being pressed, to guard against double-sends.
export const PRESS_COOLDOWN_MS = 3000;
// How long the "Copied!" tooltip stays up.
const COPIED_TOOLTIP_MS = 2000;

interface Props {
    button: TelegramButton;
    roomId: string | undefined;
    /** When true, disables all interaction (e.g. tile previews). */
    inhibitInteraction?: boolean;
    /** Called after the button did something that counts as "using" the keyboard (i.e. sent a message). */
    onUsed?: () => void;
}

function commandHint(type: TelegramCommandButtonType): string {
    switch (type) {
        case "url_auth":
            return _t("timeline|bridge_buttons|hint_url_auth");
        case "game":
            return _t("timeline|bridge_buttons|hint_game");
        case "webview":
        case "simple_webview":
            return _t("timeline|bridge_buttons|hint_webview");
        case "request_geo":
            return _t("timeline|bridge_buttons|hint_request_geo");
        case "request_poll":
            return _t("timeline|bridge_buttons|hint_request_poll");
        case "request_peer":
            return _t("timeline|bridge_buttons|hint_request_peer");
        case "request_phone":
            return _t("timeline|bridge_buttons|hint_request_phone");
    }
}

const withTooltip = (description: string | undefined, child: ReactElement): ReactElement =>
    description ? <Tooltip description={description}>{child}</Tooltip> : child;

/**
 * A single bridged Telegram keyboard button (see `fi.mau.telegram.buttons`), used both for inline
 * keyboards under a message and for reply keyboards above the composer.
 *
 * Every message a button sends goes to the room's main timeline (`threadId: null`), regardless of
 * where the button is rendered: the bridge only intercepts commands on the main timeline.
 */
export default function BridgeButton({ button, roomId, inhibitInteraction, onUsed }: Props): JSX.Element {
    const cli = useMatrixClientContext();
    const [pending, setPending] = useState(false);
    const [copied, setCopied] = useState<string | undefined>(undefined);
    const timers = useRef<number[]>([]);

    useEffect(
        () => () => {
            timers.current.forEach((t) => window.clearTimeout(t));
            timers.current = [];
        },
        [],
    );

    const later = (fn: () => void, ms: number): void => {
        timers.current.push(window.setTimeout(fn, ms));
    };

    const send = (body: string): void => {
        if (!roomId || pending) return;
        setPending(true);
        later(() => setPending(false), PRESS_COOLDOWN_MS);
        onUsed?.();
        cli.sendTextMessage(roomId, null, body).catch((e: unknown) => {
            logger.warn("Failed to send bridge button message", e);
        });
    };

    const common = {
        kind: "secondary" as const,
        size: "md" as const,
        className: "mx_BridgeButtons_button",
    };

    switch (button.type) {
        case "url": {
            const safe = isUrlPermitted(button.url);
            return (
                <Button
                    {...common}
                    as="a"
                    href={safe ? button.url : undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    disabled={inhibitInteraction || !safe}
                >
                    {button.text}
                </Button>
            );
        }
        case "callback":
            if (button.requiresPassword) {
                return withTooltip(
                    _t("timeline|bridge_buttons|requires_password"),
                    <Button {...common} disabled>
                        {button.text}
                    </Button>,
                );
            }
            return (
                <Button {...common} disabled={inhibitInteraction || pending} onClick={() => send(button.command)}>
                    {button.text}
                </Button>
            );
        case "reply":
            return (
                <Button {...common} disabled={inhibitInteraction || pending} onClick={() => send(button.text)}>
                    {button.text}
                </Button>
            );
        case "copy": {
            const onClick = async (): Promise<void> => {
                const ok = await copyPlaintext(button.copyText);
                setCopied(ok ? _t("common|copied") : _t("error|failed_copy"));
                later(() => setCopied(undefined), COPIED_TOOLTIP_MS);
            };
            return (
                <Tooltip
                    description={copied ?? _t("timeline|bridge_buttons|hint_copy")}
                    open={copied ? true : undefined}
                >
                    <Button {...common} disabled={inhibitInteraction} onClick={onClick}>
                        {button.text}
                    </Button>
                </Tooltip>
            );
        }
        case "switch_inline": {
            const text = button.botUsername ? `@${button.botUsername} ${button.query}` : button.query;
            return withTooltip(
                _t("timeline|bridge_buttons|hint_switch_inline"),
                <Button
                    {...common}
                    disabled={inhibitInteraction}
                    onClick={() =>
                        dis.dispatch<ComposerInsertPayload>({
                            action: Action.ComposerInsert,
                            text,
                            timelineRenderingType: TimelineRenderingType.Room,
                        })
                    }
                >
                    {button.text}
                </Button>,
            );
        }
        case "user_profile": {
            const onClick = (): void => {
                const member = (roomId && cli.getRoom(roomId)?.getMember(button.userMxid)) || new User(button.userMxid);
                dis.dispatch<ViewUserPayload>({ action: Action.ViewUser, member });
            };
            return (
                <Button {...common} disabled={inhibitInteraction} onClick={onClick}>
                    {button.text}
                </Button>
            );
        }
        case "request_phone": {
            const onClick = async (): Promise<void> => {
                const { finished } = Modal.createDialog(QuestionDialog, {
                    title: _t("timeline|bridge_buttons|request_phone_title"),
                    description: <p>{_t("timeline|bridge_buttons|request_phone_description")}</p>,
                    button: _t("timeline|bridge_buttons|request_phone_confirm"),
                });
                const [confirmed] = await finished;
                if (confirmed) send(button.command);
            };
            return withTooltip(
                commandHint(button.type),
                <Button {...common} disabled={inhibitInteraction || pending} onClick={onClick}>
                    {button.text}
                </Button>,
            );
        }
        case "url_auth":
        case "game":
        case "webview":
        case "simple_webview":
        case "request_geo":
        case "request_poll":
        case "request_peer":
            return withTooltip(
                commandHint(button.type),
                <Button {...common} disabled={inhibitInteraction || pending} onClick={() => send(button.command)}>
                    {button.text}
                </Button>,
            );
        default:
            return withTooltip(
                _t("timeline|bridge_buttons|unsupported"),
                <Button {...common} disabled>
                    {button.text}
                </Button>,
            );
    }
}
