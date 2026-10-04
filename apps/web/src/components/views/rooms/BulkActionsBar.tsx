// Copyright 2026 Element Creations Ltd.
// Cache bust: 2026-01-23T16:42:00Z
/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import React from "react";
import { type Room, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { CopyIcon, DeleteIcon, ForwardIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
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
import { copyPlaintext } from "../../../utils/strings";
import { selectableEventIds, selectionAsText } from "../../../utils/messageSelection";

interface IProps {
    room: Room;
    permalinkCreator: RoomPermalinkCreator;
}

const BulkActionsBar: React.FC<IProps> = ({ room, permalinkCreator }) => {
    const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
    useEventEmitter(MessageSelectionStore.instance, UPDATE_EVENT, forceUpdate);
    const [copied, setCopied] = React.useState(false);

    const count = MessageSelectionStore.instance.getCount(room.roomId);

    // The selected messages, as Telegram Desktop copies them (see selectionAsText). The selection stays.
    const onCopy = (): void => {
        const events = MessageSelectionStore.instance
            .getSelectedIds(room.roomId)
            .map((id) => room.findEventById(id))
            .filter((ev): ev is MatrixEvent => !!ev);
        const text = selectionAsText(room, events);
        if (!text) return;
        void copyPlaintext(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };

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

        void finished.then(async ([confirmed]: [boolean?] = []) => {
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

    /*
     * The keys messengers give a selection (Telegram Desktop, Signal): Escape ends it, Ctrl/Cmd+C copies it
     * when no text is selected, Ctrl/Cmd+A takes in every loaded message, and Delete asks to remove them.
     * Not while typing somewhere, where those keys belong to the field.
     */
    const latest = React.useRef({ onCopy, onDelete });
    latest.current = { onCopy, onDelete };
    React.useEffect(() => {
        if (count === 0) return;
        const onKeyDown = (ev: KeyboardEvent): void => {
            const target = ev.target as HTMLElement | null;
            if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
            const mod = ev.ctrlKey || ev.metaKey;
            if (ev.key === "Escape") {
                MessageSelectionStore.instance.exitSelectionMode(room.roomId);
            } else if (mod && ev.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
                latest.current.onCopy();
            } else if (mod && ev.key.toLowerCase() === "a") {
                MessageSelectionStore.instance.selectRange(
                    room.roomId,
                    selectableEventIds(room, MatrixClientPeg.safeGet()),
                );
            } else if (ev.key === "Delete" || ev.key === "Backspace") {
                latest.current.onDelete();
            } else {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [count, room]);

    if (count === 0) return null;

    return (
        <div className="mx_BulkActionsBar mx_MessageComposer mx_MessageComposer_wrapper">
            <div className="mx_BulkActionsBar_count">{_t("timeline|messages_selected", { count })}</div>
            <div className="mx_BulkActionsBar_actions">
                <AccessibleButton className="mx_BulkActionsBar_action" onClick={onCopy} kind="primary_outline">
                    <CopyIcon className="mx_Icon_16" />
                    {copied ? _t("common|copied") : _t("action|copy")}
                </AccessibleButton>
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
