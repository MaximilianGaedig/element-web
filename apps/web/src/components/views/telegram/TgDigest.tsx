/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What is waiting for you, across every chat, in one press.
 *
 * Opening forty unread chats to find the two that actually need answering is the thing worth handing to
 * a machine. This asks once, about every chat that has something unread, and answers a few lines with
 * what needs you first - each chat it names being somewhere to go.
 *
 * Asked for, never automatic: the whole unread pile leaving the device every morning unasked is a
 * different thing with different consent, and this is not it.
 */

import React, { type JSX, useCallback, useState } from "react";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable, beginAnswer } from "../../../utils/ai/ask";
import { digestMessages, unreadChats } from "../../../utils/ai/digest";
import { lookingWords } from "./TgAiNote";
import { AiText } from "../../../utils/ai/render";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";

export function TgDigest(): JSX.Element | null {
    const client = useMatrixClientContext();
    const [text, setText] = useState<string>();
    const [doing, setDoing] = useState<string>();
    const [failed, setFailed] = useState<string>();
    const [cites, setCites] = useState<string[]>([]);

    const run = useCallback(async (): Promise<void> => {
        const chats = unreadChats(client);
        if (!chats.length) {
            setText(_t("tg_layout|ai_digest_nothing"));
            return;
        }

        beginAnswer();
        setFailed(undefined);
        setText("");
        setDoing(_t("tg_layout|ai_thinking"));
        try {
            const answer = await ask(
                client,
                { kind: "digest", messages: digestMessages(chats) },
                {
                    onText: (whole) => {
                        setText(whole);
                        setDoing(undefined);
                    },
                    onLooking: (what) => setDoing(lookingWords(what.tool)),
                },
            );
            setText(answer.answer);
            setCites(answer.cites ?? []);
        } catch (error) {
            setFailed(_t("tg_layout|ai_failed", { reason: String((error as Error).message).slice(0, 160) }));
        } finally {
            setDoing(undefined);
        }
    }, [client]);

    if (!aiAvailable()) return null;

    // A cited message is somewhere to go: the chat it is in, at the message itself.
    const jump = (eventId: string): void => {
        const room = client.getVisibleRooms().find((candidate) => candidate.findEventById(eventId));
        if (!room) return;
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            event_id: eventId,
            highlighted: true,
            metricsTrigger: undefined,
        });
    };

    if (text === undefined && !failed) {
        return (
            <AccessibleButton kind="secondary" className="mx_TgDigest_ask" onClick={() => void run()}>
                <SparkleIcon />
                {_t("tg_layout|ai_digest")}
            </AccessibleButton>
        );
    }

    return (
        <div className={`mx_TgDigest${doing ? " mx_TgDigest_writing" : ""}`}>
            <div className="mx_TgDigest_head">
                <SparkleIcon className="mx_TgDigest_spark" />
                <span className="mx_TgDigest_title">{_t("tg_layout|ai_digest")}</span>
                <AccessibleButton
                    kind="link"
                    className="mx_TgDigest_close"
                    aria-label={_t("action|close")}
                    onClick={() => {
                        setText(undefined);
                        setFailed(undefined);
                        setCites([]);
                    }}
                >
                    <CloseIcon />
                </AccessibleButton>
            </div>
            {/* Its own scroller: a long morning must not squash the list of chats, and must not be
                squashed by it - which is what happened when this was one tall flex child. */}
            <div className="mx_TgDigest_body">
                {doing && <p className="mx_TgDigest_doing">{doing}</p>}
                {failed ? (
                    <p className="mx_TgDigest_failed">{failed}</p>
                ) : (
                    <AiText className="mx_TgDigest_text" text={text ?? ""} />
                )}
                {cites.length > 0 && (
                    <p className="mx_TgDigest_cites">
                        {cites.slice(0, 6).map((eventId, index) => (
                            <AccessibleButton
                                key={eventId}
                                kind="link"
                                className="mx_TgDigest_cite"
                                onClick={() => jump(eventId)}
                            >
                                {_t("tg_layout|ai_cite", { number: index + 1 })}
                            </AccessibleButton>
                        ))}
                    </p>
                )}
            </div>
        </div>
    );
}
