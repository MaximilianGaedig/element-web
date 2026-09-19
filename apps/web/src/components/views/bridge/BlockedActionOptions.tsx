/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixClient, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { DeleteIcon, EditIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { IconizedContextMenuOption } from "../context_menus/IconizedContextMenu";
import { _t } from "../../../languageHandler";
import { deleteBlockedReason, editBlockedReason } from "../../../utils/bridge/roomFeatures";

/**
 * Reasons why edit/delete are unavailable for this event *only* because of the bridged network's
 * com.beeper.room_features (Matrix itself would allow them).
 */
export function bridgeBlockedActions(cli: MatrixClient, mxEvent: MatrixEvent): { edit?: string; delete?: string } {
    const room = cli.getRoom(mxEvent.getRoomId());
    if (!room || mxEvent.getSender() !== cli.getUserId() || mxEvent.isRedacted() || mxEvent.status !== null) {
        return {};
    }
    const result: { edit?: string; delete?: string } = {};
    const { msgtype, body } = mxEvent.getOriginalContent();
    const editableType =
        mxEvent.getType() === "m.room.message" &&
        (msgtype === MsgType.Text || msgtype === MsgType.Emote) &&
        typeof body === "string" &&
        !!body &&
        !mxEvent.isRelation("m.replace");
    if (editableType) result.edit = editBlockedReason(mxEvent, room);
    if (room.currentState.maySendRedactionForEvent(mxEvent, cli.getSafeUserId())) {
        result.delete = deleteBlockedReason(mxEvent, room);
    }
    return result;
}

/**
 * Disabled "Edit"/"Remove" context-menu entries whose tooltip explains that the bridged network
 * doesn't allow the action, shown where Element would otherwise just omit them.
 */
export default function BlockedActionOptions({
    cli,
    mxEvent,
}: {
    cli: MatrixClient;
    mxEvent: MatrixEvent;
}): JSX.Element | null {
    const blocked = bridgeBlockedActions(cli, mxEvent);
    if (!blocked.edit && !blocked.delete) return null;
    return (
        <>
            {blocked.edit && (
                <IconizedContextMenuOption
                    icon={<EditIcon />}
                    label={_t("action|edit")}
                    title={blocked.edit}
                    aria-disabled
                    className="mx_BlockedAction"
                    onClick={() => {}}
                />
            )}
            {blocked.delete && (
                <IconizedContextMenuOption
                    icon={<DeleteIcon />}
                    label={_t("action|remove")}
                    title={blocked.delete}
                    aria-disabled
                    className="mx_BlockedAction"
                    onClick={() => {}}
                />
            )}
        </>
    );
}
