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

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import Spinner from "../elements/Spinner";
import { mediaFromContent } from "../../../customisations/Media";

interface Props {
    mxEvent: MatrixEvent;
}

export function TgTranscript({ mxEvent }: Props): JSX.Element | null {
    const [text, setText] = useState<string>();
    const [working, setWorking] = useState(false);
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
        try {
            const media = mediaFromContent(mxEvent.getContent());
            const response = await fetch(media.srcHttp ?? "");
            const [{ transcribe }, audio] = await Promise.all([
                import("../../../utils/detect/transcribe"),
                response.arrayBuffer(),
            ]);
            const said = await transcribe(audio);
            setText(said ?? _t("timeline|transcript|nothing_said"));
            if (said) {
                const { saveMediaText } = await import("../../../utils/detect/mediaText");
                void saveMediaText(MatrixClientPeg.safeGet(), roomId, eventId, "transcript", said);
            }
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
