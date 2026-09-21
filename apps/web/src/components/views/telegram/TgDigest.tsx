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
 * Each chat it names comes with replies drafted in your own words (utils/ai/replies.ts): pressing one
 * opens that chat with the words already in the composer, so a morning of forty chats can be answered
 * without opening forty chats. Sending is still yours, every time.
 *
 * Asked for, never automatic: the whole unread pile leaving the device every morning unasked is a
 * different thing with different consent, and this is not it.
 */

import React, { type JSX, useCallback, useState } from "react";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";

import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable, beginAnswer } from "../../../utils/ai/ask";
import { digestMessages, type UnreadChat, unreadChats } from "../../../utils/ai/digest";
import { leaveDraft, repliesFor } from "../../../utils/ai/replies";
import { lookingWords } from "./TgAiNote";
import { AiText } from "../../../utils/ai/render";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";

/** How many of the waiting chats get drafts: the ones anybody will actually get through. */
const MOST_CHATS = 8;

export function TgDigest(): JSX.Element | null {
    const client = useMatrixClientContext();
    const [text, setText] = useState<string>();
    const [doing, setDoing] = useState<string>();
    const [failed, setFailed] = useState<string>();
    const [cites, setCites] = useState<string[]>([]);
    /** Drafts per chat, as each chat's come back: the digest answers and the replies fill in behind it. */
    const [replies, setReplies] = useState<Record<string, string[]>>({});
    /** What left the device to produce this: the same fact the answers in the timeline state. */
    const [sent, setSent] = useState<{ messages: number; chats: number }>();
    const [showSent, setShowSent] = useState(false);

    /*
     * Replies for each chat that is waiting, one chat at a time.
     *
     * One at a time on purpose: forty chats asking at once is forty requests against a daily allowance
     * and a rate limit, and the first few are the ones that will actually be read. Each arrives on its
     * own, so the pills appear as they are drafted rather than all at the end.
     */
    const draftFor = useCallback(
        async (chats: UnreadChat[]): Promise<void> => {
            for (const { room } of chats.slice(0, MOST_CHATS)) {
                const drafted = await repliesFor(client, room);
                if (drafted.length) setReplies((had) => ({ ...had, [room.roomId]: drafted }));
            }
        },
        [client],
    );

    const run = useCallback(async (): Promise<void> => {
        const chats = unreadChats(client);
        if (!chats.length) {
            setText(_t("tg_layout|ai_digest_nothing"));
            return;
        }

        const sending = await digestMessages(client, chats);
        beginAnswer();
        setFailed(undefined);
        setSent({ messages: sending.length, chats: chats.length });
        setReplies({});
        setText("");
        // Drafted alongside the digest rather than after it, so the pills are there when it finishes.
        void draftFor(chats);
        setDoing(_t("tg_layout|ai_thinking"));
        try {
            const answer = await ask(
                client,
                { kind: "digest", messages: sending },
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
    }, [client, draftFor]);

    if (!aiAvailable()) return null;

    /** A chat is somewhere to go; a draft goes there with you (TgReplies takes it as the chat opens). */
    const open = (roomId: string): void => {
        dis.dispatch<ViewRoomPayload>({ action: Action.ViewRoom, room_id: roomId, metricsTrigger: undefined });
    };

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
            <Button kind="secondary" size="md" className="mx_TgDigest_ask" onClick={() => void run()}>
                <SparkleIcon />
                {_t("tg_layout|ai_digest")}
            </Button>
        );
    }

    return (
        <div className={`mx_TgDigest${doing ? " mx_TgDigest_writing" : ""}`}>
            <div className="mx_TgDigest_head">
                <SparkleIcon className="mx_TgDigest_spark" />
                <span className="mx_TgDigest_title">{_t("tg_layout|ai_digest")}</span>
                <span className="mx_TgDigest_spacer" />
                {sent && (
                    <AccessibleButton
                        kind="link"
                        className="mx_TgDigest_info"
                        aria-label={_t("tg_layout|ai_what_was_sent")}
                        aria-expanded={showSent}
                        title={_t("tg_layout|ai_what_was_sent")}
                        onClick={() => setShowSent(!showSent)}
                    >
                        <InfoIcon />
                    </AccessibleButton>
                )}
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
                {/* Each waiting chat, with something to send: pressing one opens the chat with the
                    words in the composer. */}
                {Object.entries(replies).map(([roomId, drafted]) => {
                    const room = client.getRoom(roomId);
                    if (!room) return null;
                    return (
                        <div key={roomId} className="mx_TgDigest_chat">
                            <AccessibleButton kind="link" className="mx_TgDigest_chatName" onClick={() => open(roomId)}>
                                {room.name}
                            </AccessibleButton>
                            <div className="mx_TgDigest_drafts">
                                {drafted.map((draft) => (
                                    <Button
                                        key={draft}
                                        kind="secondary"
                                        size="md"
                                        className="mx_TgDigest_draft"
                                        onClick={() => {
                                            leaveDraft(roomId, draft);
                                            open(roomId);
                                        }}
                                    >
                                        {draft}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {showSent && sent && (
                    <p className="mx_TgDigest_sent">
                        {_t("tg_layout|ai_sent_digest", { count: sent.messages, chats: sent.chats })}
                    </p>
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
