/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a voice message said, under the voice message, the way Telegram puts it there.
 *
 * Three states and no more: nothing yet, working, and the words. What the server already knows is shown
 * straight away and costs nothing - somebody's device worked it out once, or the pass over the history
 * did - and only a message nobody has transcribed yet offers the button. What this device works out goes
 * back to the server, so the next device to open this chat simply reads it.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import TranscriptIcon from "@vector-im/compound-design-tokens/assets/web/icons/threads";

import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import Spinner from "../elements/Spinner";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";

interface Props {
    mxEvent: MatrixEvent;
}

export function TgTranscript({ mxEvent }: Props): JSX.Element | null {
    const [text, setText] = useState<string>();
    const [working, setWorking] = useState(false);
    const [failed, setFailed] = useState<string>();
    const roomId = mxEvent.getRoomId();
    const eventId = mxEvent.getId();

    // What is already known, which is most of them once a chat has been through the careful pass.
    useEffect(() => {
        if (!roomId || !eventId) return;
        let cancelled = false;
        void (async () => {
            const { storedMediaText } = await import("../../../utils/detect/mediaText");
            const stored = await storedMediaText(MatrixClientPeg.safeGet(), roomId, eventId);
            if (!cancelled && stored?.transcript) setText(stored.transcript);
        })();
        return () => {
            cancelled = true;
        };
    }, [roomId, eventId]);

    const run = useCallback(async (): Promise<void> => {
        if (!roomId || !eventId) return;
        setWorking(true);
        setFailed(undefined);
        try {
            /*
             * Through the same helper the player and the download button use: it fetches with the
             * account's credentials and decrypts an encrypted room's file. A plain fetch of the media
             * URL gets a 404 on a server that authenticates media, and nothing at all in a room that
             * encrypts it - which is how this failed silently.
             */
            const helper = new MediaEventHelper(mxEvent);
            const blob = await helper.sourceBlob.value;
            const [{ transcribe }, audio] = await Promise.all([
                import("../../../utils/detect/transcribe"),
                blob.arrayBuffer(),
            ]);
            const said = await transcribe(audio);
            setText(said ?? _t("timeline|transcript|nothing_said"));
            if (said) {
                const { saveMediaText } = await import("../../../utils/detect/mediaText");
                void saveMediaText(MatrixClientPeg.safeGet(), roomId, eventId, "transcript", said);
            }
        } catch (error) {
            // Said out loud: a transcript that quietly does not appear is indistinguishable from one
            // that was never asked for, which is exactly how the last of these went unnoticed.
            logger.warn("Could not transcribe a voice message", error);
            setFailed(_t("timeline|transcript|failed", { reason: String((error as Error).message).slice(0, 120) }));
        } finally {
            setWorking(false);
        }
    }, [mxEvent, roomId, eventId]);

    if (text) return <p className="mx_TgTranscript">{text}</p>;
    if (working) {
        return (
            <p className="mx_TgTranscript mx_TgTranscript_working">
                <Spinner size={16} as="span" />
                {_t("timeline|transcript|working")}
            </p>
        );
    }

    if (failed) {
        return (
            <p className="mx_TgTranscript mx_TgTranscript_failed">
                {failed}
                <AccessibleButton kind="link" onClick={run}>
                    {_t("action|try_again")}
                </AccessibleButton>
            </p>
        );
    }

    return (
        <AccessibleButton
            kind="link"
            className="mx_TgTranscript_button"
            onClick={run}
            title={_t("timeline|transcript|action")}
        >
            <TranscriptIcon />
            {_t("timeline|transcript|action")}
        </AccessibleButton>
    );
}
