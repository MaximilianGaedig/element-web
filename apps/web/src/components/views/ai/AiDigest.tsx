/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What is waiting for you, across every chat, in one press.
 *
 * Opening forty unread chats to find the two that actually need answering is the thing worth handing to a
 * machine. This asks once, about every chat that has something unread, and lays the answer out the way the
 * room list is laid out: one chat per row, its name, what it wants from you, and something to send back.
 *
 * One row per chat, and only one. The model is asked to write under a heading per chat, so the answer
 * arrives already divided that way and the drafts are hung under the chat they belong to - which is where
 * anybody would look for them. A paragraph naming five chats, followed by a list naming the same five
 * again with their pills, was the same information twice in two shapes, and the second one is where the
 * buttons were.
 *
 * Asked for, never automatic: the whole unread pile leaving the device every morning unasked is a
 * different thing with different consent, and this is not it.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import AiIcon from "@vector-im/compound-design-tokens/assets/web/icons/ai";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";

import { Button, IconButton } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable } from "../../../utils/ai/ask";
import { digestMessages, type UnreadChat, unreadChats } from "../../../utils/ai/digest";
import { leaveDraft, repliesFor } from "../../../utils/ai/replies";
import { lookingWords } from "./AiNote";
import { AiSources } from "./AiSources";
import { AiText } from "../../../utils/ai/render";
import RoomAvatar from "../avatars/RoomAvatar";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";

/** How many of the waiting chats get drafts: the ones anybody will actually get through. */
const MOST_CHATS = 8;

/** One chat's part of the answer: what was said about it, and what could be sent back. */
interface Part {
    room?: Room;
    /** The heading as the model wrote it, for a chat that cannot be matched to a room. */
    name: string;
    said: string;
    drafts: string[];
}

/**
 * The answer, cut into the chats it is about.
 *
 * The model writes a `## heading` per chat (see the digest prompt), so the headings are the seams. What
 * comes before the first one is the opening line, and anything whose heading does not match a chat that
 * was sent is still shown - under its own name, without the pills it has no room for.
 */
function partsOf(text: string, chats: UnreadChat[], drafts: Record<string, string[]>): { intro: string; parts: Part[] } {
    const byName = new Map(chats.map(({ room }) => [room.name.trim().toLowerCase(), room]));
    const sections = text.split(/^##+\s*/m);
    const intro = sections.shift()?.trim() ?? "";
    const parts: Part[] = [];
    for (const section of sections) {
        const cut = section.indexOf("\n");
        const name = (cut < 0 ? section : section.slice(0, cut)).trim();
        const said = cut < 0 ? "" : section.slice(cut + 1).trim();
        const room = byName.get(name.toLowerCase());
        parts.push({ room, name, said, drafts: room ? (drafts[room.roomId] ?? []) : [] });
    }
    /*
     * A chat the model did not write about but which has drafts waiting is still worth a row: it is
     * usually the quiet one that needs a yes and nothing else.
     */
    for (const { room } of chats) {
        if (drafts[room.roomId]?.length && !parts.some((part) => part.room?.roomId === room.roomId)) {
            parts.push({ room, name: room.name, said: "", drafts: drafts[room.roomId] });
        }
    }
    return { intro, parts };
}

export function AiDigest(): JSX.Element | null {
    const client = useMatrixClientContext();
    const [text, setText] = useState<string>();
    const [doing, setDoing] = useState<string>();
    const [failed, setFailed] = useState<string>();
    const [cites, setCites] = useState<string[]>([]);
    /** Which chats were asked about, so the answer's headings can be matched back to rooms. */
    const [chats, setChats] = useState<UnreadChat[]>([]);
    /** Drafts per chat, as each chat's come back: the digest answers and the replies fill in behind it. */
    const [drafts, setDrafts] = useState<Record<string, string[]>>({});
    /** What left the device to produce this: the same fact the answers in the timeline state. */
    const [sent, setSent] = useState<{ messages: number; chats: number }>();
    const [showSent, setShowSent] = useState(false);

    /*
     * Replies for each chat that is waiting, one chat at a time.
     *
     * One at a time on purpose: forty chats asking at once is forty requests against a daily allowance and
     * a rate limit, and the first few are the ones that will actually be read. Each arrives on its own, so
     * the pills appear as they are drafted rather than all at the end.
     */
    const draftFor = useCallback(
        async (waiting: UnreadChat[]): Promise<void> => {
            for (const { room } of waiting.slice(0, MOST_CHATS)) {
                const drafted = await repliesFor(client, room);
                if (drafted.length) setDrafts((had) => ({ ...had, [room.roomId]: drafted }));
            }
        },
        [client],
    );

    const run = useCallback(async (): Promise<void> => {
        const waiting = unreadChats(client);
        if (!waiting.length) {
            setText(_t("ai|digest_nothing"));
            return;
        }

        const sending = await digestMessages(client, waiting);
        setFailed(undefined);
        setChats(waiting);
        setSent({ messages: sending.length, chats: waiting.length });
        setDrafts({});
        setText("");
        // Drafted alongside the digest rather than after it, so the pills are there when it finishes.
        void draftFor(waiting);
        setDoing(_t("ai|thinking"));
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
            setFailed(_t("ai|failed", { reason: String((error as Error).message).slice(0, 160) }));
        } finally {
            setDoing(undefined);
        }
    }, [client, draftFor]);

    const { intro, parts } = useMemo(() => partsOf(text ?? "", chats, drafts), [text, chats, drafts]);

    if (!aiAvailable()) return null;

    /** A chat is somewhere to go; a draft goes there with you (AiReplies takes it as the chat opens). */
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
            <Button kind="secondary" size="md" className="mx_AiDigest_ask" Icon={AiIcon} onClick={() => void run()}>
                {_t("ai|digest")}
            </Button>
        );
    }

    return (
        <section className={`mx_AiDigest${doing ? " mx_Ai_writing" : ""}`} aria-label={_t("ai|digest")}>
            <header className="mx_AiDigest_head">
                <AiIcon className="mx_Ai_mark" aria-hidden />
                <h2 className="mx_AiDigest_title">{_t("ai|digest")}</h2>
                {sent && (
                    <IconButton
                        size="20px"
                        aria-label={_t("ai|what_was_sent")}
                        aria-expanded={showSent}
                        title={_t("ai|what_was_sent")}
                        onClick={() => setShowSent(!showSent)}
                    >
                        <InfoIcon />
                    </IconButton>
                )}
                <IconButton
                    size="20px"
                    aria-label={_t("action|close")}
                    onClick={() => {
                        setText(undefined);
                        setFailed(undefined);
                        setCites([]);
                        setChats([]);
                        setDrafts({});
                    }}
                >
                    <CloseIcon />
                </IconButton>
            </header>

            {/* Its own scroller: a long morning must not squash the list of chats, and must not be
                squashed by it - which is what happened when this was one tall flex child. */}
            <div className="mx_AiDigest_body">
                {doing && <p className="mx_AiDigest_doing">{doing}</p>}
                {failed && <p className="mx_AiDigest_failed">{failed}</p>}
                {intro && <AiText className="mx_Ai_prose mx_AiDigest_intro" text={intro} />}

                {parts.map((part) => (
                    <article key={part.room?.roomId ?? part.name} className="mx_AiDigest_chat">
                        {part.room ? (
                            <button
                                type="button"
                                className="mx_AiDigest_chatName"
                                onClick={() => open(part.room!.roomId)}
                            >
                                <RoomAvatar room={part.room} size="20px" />
                                {part.room.name}
                            </button>
                        ) : (
                            <p className="mx_AiDigest_chatName mx_AiDigest_chatName_plain">{part.name}</p>
                        )}
                        {part.said && <AiText className="mx_Ai_prose mx_AiDigest_said" text={part.said} />}
                        {part.drafts.length > 0 && part.room && (
                            <div className="mx_AiDigest_drafts">
                                {part.drafts.map((draft, at) => (
                                    <Button
                                        key={`${at}:${draft}`}
                                        kind="secondary"
                                        size="md"
                                        className="mx_AiDigest_draft"
                                        onClick={() => {
                                            leaveDraft(part.room!.roomId, draft);
                                            open(part.room!.roomId);
                                        }}
                                    >
                                        <span className="mx_AiDigest_draftText">{draft}</span>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </article>
                ))}

                <AiSources cites={cites} onJump={jump} />

                {showSent && sent && (
                    <p className="mx_AiDigest_sent">
                        {_t("ai|sent_digest", { count: sent.messages, chats: sent.chats })}
                    </p>
                )}
            </div>
        </section>
    );
}
