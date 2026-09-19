/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import { _t } from "../../languageHandler";
import { fileBlockedReason } from "./roomFeatures";

/**
 * Removes (in place) the files com.beeper.room_features says the remote network rejects (type or
 * size), and tells the user which ones and why. Resolves once the dialog is dismissed.
 */
export async function dropUnsupportedBridgeFiles(room: Room | null, files: File[]): Promise<void> {
    const rejected: [File, string][] = [];
    for (let i = files.length - 1; i >= 0; i--) {
        const reason = fileBlockedReason(room, files[i]);
        if (reason) rejected.unshift([files.splice(i, 1)[0], reason]);
    }
    if (rejected.length === 0) return;

    const { finished } = Modal.createDialog(ErrorDialog, {
        title: _t("bridge|features_files_rejected_title", { count: rejected.length }),
        description: (
            <ul className="mx_RejectedFiles">
                {rejected.map(([file, reason]) => (
                    <li key={file.name}>
                        <strong>{file.name}</strong>: {reason}
                    </li>
                ))}
            </ul>
        ),
    });
    await finished;
}
