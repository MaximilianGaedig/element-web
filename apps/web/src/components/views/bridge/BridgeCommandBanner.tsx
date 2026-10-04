/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";
import { CodeIcon, ErrorSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import { type ComposerTarget } from "../../../utils/bridge/bridgeCommands";
import AccessibleButton from "../elements/AccessibleButton";

/** What the send button does with this text, where it is not a plain message: the tooltip and the label. */
export function bridgeSendTitle(target: ComposerTarget, roomName: string): string | undefined {
    switch (target.kind) {
        case "command":
            return _t("bridge|send_command_title", { network: target.bridge.network });
        case "relay":
        case "wrong-bridge":
            return _t("bridge|send_relay_title", { name: roomName, network: target.bridge.network });
        default:
            return undefined;
    }
}

interface Props {
    target: ComposerTarget;
    /** The chat's name: the person or group the message would reach. */
    roomName: string;
    /** The warning was already shown for this text, so sending again sends it. */
    warned: boolean;
    onSendAnyway: () => void;
}

/**
 * Says who the text in the composer is for, whenever that is not the person in the chat: a command for the
 * bridge bot (which nobody on the other network sees), or a command for another bridge that would go to
 * the person as a message. Plain text says nothing here: the placeholder already names where it goes.
 */
export default function BridgeCommandBanner({ target, roomName, warned, onSendAnyway }: Props): JSX.Element | null {
    if (target.kind === "command") {
        const label =
            target.bridge.kind === "management"
                ? _t("bridge|command_to_bridge", { network: target.bridge.network })
                : _t("bridge|command_to_bridge_not_sent", { network: target.bridge.network, name: roomName });
        return (
            <div className="mx_BridgeCommandBanner" role="status" data-testid="bridge-command-banner">
                <CodeIcon className="mx_BridgeCommandBanner_icon" width="16px" height="16px" aria-hidden />
                <span className="mx_BridgeCommandBanner_text">{label}</span>
            </div>
        );
    }
    if (target.kind === "wrong-bridge") {
        return (
            <div
                className={classNames("mx_BridgeCommandBanner", "mx_BridgeCommandBanner_warning", {
                    mx_BridgeCommandBanner_warned: warned,
                })}
                role="alert"
                data-testid="bridge-command-banner"
            >
                <ErrorSolidIcon className="mx_BridgeCommandBanner_icon" width="16px" height="16px" aria-hidden />
                <span className="mx_BridgeCommandBanner_text">
                    {_t("bridge|wrong_bridge_warning", {
                        intended: target.intended.network,
                        name: roomName,
                        network: target.bridge.network,
                    })}
                </span>
                <AccessibleButton kind="link" onClick={onSendAnyway} className="mx_BridgeCommandBanner_anyway">
                    {_t("bridge|wrong_bridge_send_anyway")}
                </AccessibleButton>
            </div>
        );
    }
    return null;
}
