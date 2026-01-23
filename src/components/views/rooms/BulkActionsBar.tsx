// Copyright 2026 Element Creations Ltd.
// Cache bust: 2026-01-23T11:37:00Z
/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import React from "react";
import { type Room, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { DeleteIcon, ForwardIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../languageHandler";
import { MessageSelectionStore } from "../../../stores/MessageSelectionStore";
import AccessibleButton from "../elements/AccessibleButton";
import { useEventEmitter } from "../../../hooks/useEventEmitter";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type OpenForwardDialogPayload } from "../../../dispatcher/payloads/OpenForwardDialogPayload";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import QuestionDialog from "../dialogs/QuestionDialog";
import Modal from "../../../Modal";

interface IProps {
    room: Room;
    permalinkCreator: RoomPermalinkCreator;
}

const BulkActionsBar: React.FC<IProps> = ({ room, permalinkCreator }) => {
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
    useEventEmitter(MessageSelectionStore.instance, UPDATE_EVENT, forceUpdate);

    const count = MessageSelectionStore.instance.getCount(room.roomId);
    if (count === 0) return null;

    const onCancel = (): void => {
        MessageSelectionStore.instance.exitSelectionMode(room.roomId);
    };

    const onDelete = (): void => {
        const eventIds = MessageSelectionStore.instance.getSelectedIds(room.roomId);
        if (eventIds.length === 0) return;

        const { finished } = Modal.createDialog(QuestionDialog, {
            title: _t("action|remove"),
            description: _t("timeline|bulk_delete_confirm", { count }),
            button: _t("action|remove"),
            danger: true,
        });

        finished.then(async ([confirmed]: [boolean?] = []) => {
            if (!confirmed) return;

            const cli = MatrixClientPeg.safeGet();
            const roomId = room.roomId;

            // Redact all selected events. We do this in parallel for speed.
            await Promise.all(
                eventIds.map(async (eventId) => {
                    try {
                        await cli.redactEvent(roomId, eventId);
                    } catch (e) {
                        logger.error(`BulkActionsBar: Failed to redact event ${eventId}`, e);
                    }
                }),
            );
            MessageSelectionStore.instance.exitSelectionMode(roomId);
        });
    };

    const onForward = (): void => {
        const eventIds = MessageSelectionStore.instance.getSelectedIds(room.roomId);
        if (eventIds.length === 0) return;

        const events = eventIds.map((id) => room.findEventById(id)).filter(Boolean) as MatrixEvent[];
        if (events.length === 0) return;

        dis.dispatch<OpenForwardDialogPayload>({
            action: Action.OpenForwardDialog,
            events: events,
            permalinkCreator: permalinkCreator,
        });
        MessageSelectionStore.instance.exitSelectionMode(room.roomId);
    };

    return (
        <div className="mx_BulkActionsBar mx_MessageComposer mx_MessageComposer_wrapper">
            <div className="mx_BulkActionsBar_count">{_t("timeline|messages_selected", { count })}</div>
            <div className="mx_BulkActionsBar_actions">
                <AccessibleButton className="mx_BulkActionsBar_action" onClick={onForward} kind="primary_outline">
                    <ForwardIcon className="mx_Icon_16" />
                    {_t("action|forward")}
                </AccessibleButton>
                <AccessibleButton className="mx_BulkActionsBar_action" onClick={onDelete} kind="danger_outline">
                    <DeleteIcon className="mx_Icon_16" />
                    {_t("action|remove")}
                </AccessibleButton>
                <AccessibleButton className="mx_BulkActionsBar_action" onClick={onCancel} kind="link">
                    {_t("action|cancel")}
                </AccessibleButton>
            </div>
        </div>
    );
};

export default BulkActionsBar;
