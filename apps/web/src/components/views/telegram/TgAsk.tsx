/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking about the chat you are in.
 *
 * Two ways in, both of them one press: "what did I miss", which reads what is on screen and answers
 * without being asked anything else, and a box for a question, which lets the model go and look through
 * the history for the answer.
 *
 * The shape of it: a pill floating over the conversation, and the answer arriving where an answer belongs
 * - in the timeline, as a message, under the thing it is about (TgAiNote). The pill does not grow into a
 * card of its own: an answer shown twice in two shapes is two things to read and one of them is an advert.
 * So the pill only ever says what is happening, and the words appear in the chat as they are written.
 *
 * The answer is kept there afterwards, visible only to you (utils/ai/notes.ts), so it is still there
 * tomorrow.
 */

import React, { type JSX, useCallback, useRef, useState } from "react";
import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";
import SendIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable, beginAnswer } from "../../../utils/ai/ask";
import { readable } from "../../../utils/ai/readable";
import { type AiNote, keepNote } from "../../../utils/ai/notes";
import { setStreaming } from "../../../utils/ai/streaming";
import { lookingWords } from "./TgAiNote";

/** How much a summary is given at most: a day of a busy chat, not a year of one. */
const READ_BACK = 200;

/**
 * Where what you missed begins.
 *
 * "What did I miss" is about the unread messages, but it cannot be answered from them alone: three
 * replies saying "yes, do that" summarise to nothing without the question they answer. So the model is
 * given the last READ_BACK messages either way, and told which of them are the new ones - context to
 * read, and a line about what is new. Where the read marker cannot be found (it has fallen out of the
 * timeline, or there is none) there is nothing to point at, and the last of the chat is the honest answer.
 */
function unreadFrom(room: Room, events: MatrixEvent[]): string | undefined {
    const readUpTo = room.getEventReadUpTo(room.client.getSafeUserId(), true);
    const at = readUpTo ? events.findIndex((event) => event.getId() === readUpTo) : -1;
    return at >= 0 ? events[at + 1]?.getId() : undefined;
}

interface Props {
    room: Room;
    /** Where the answer will sit: the message it is about, usually the newest one. */
    anchor?: string;
}

export function TgAsk({ room, anchor }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [question, setQuestion] = useState("");
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [failed, setFailed] = useState<string>();
    /** What the model is doing right now, said in the pill while it does it. */
    const [doing, setDoing] = useState<string>();
    const abort = useRef<AbortController>(undefined);

    const run = useCallback(
        async (kind: "summary" | "question", asked?: string): Promise<void> => {
            const events = room.getLiveTimeline().getEvents();
            const at = anchor ?? events[events.length - 1]?.getId();
            if (!at) return;

            const newFrom = kind === "summary" ? unreadFrom(room, events) : undefined;
            // Built once: what is sent is what the answer will say was sent.
            const sending = await readable(client, room, kind === "summary" ? READ_BACK : 40);
            setBusy(true);
            setFailed(undefined);
            beginAnswer();
            abort.current?.abort();
            abort.current = new AbortController();

            let text = "";
            setDoing(_t("tg_layout|ai_thinking"));
            setStreaming({ anchor: at, roomId: room.roomId, text: "", looking: _t("tg_layout|ai_thinking") });

            try {
                const answer = await ask(
                    client,
                    {
                        kind,
                        // A summary reads the chat around what was missed; a question may need the whole
                        // history, which the model goes and searches for itself.
                        messages: sending,
                        question:
                            kind === "summary"
                                ? // Not a question: where to start. The earlier messages are there to be
                                  // understood from, not summarised.
                                  newFrom && _t("tg_layout|ai_unread_from", { id: newFrom })
                                : asked,
                    },
                    {
                        onText: (whole) => {
                            text = whole;
                            setDoing(undefined);
                            setStreaming({ anchor: at, roomId: room.roomId, text, looking: undefined });
                        },
                        onLooking: (what) => {
                            const looking = lookingWords(what.tool);
                            setDoing(looking);
                            setStreaming({ anchor: at, roomId: room.roomId, text, looking });
                        },
                    },
                    abort.current.signal,
                );

                // Nothing to keep is a failure, not an answer: a bubble holding only "this may not be
                // the whole answer" is worse than being told it did not manage one.
                if (!answer.answer.trim()) throw new Error(_t("tg_layout|ai_no_answer"));

                const note: AiNote = {
                    id: `ai-${Date.now().toString(36)}`,
                    anchor: at,
                    question: asked,
                    answer: answer.answer,
                    cites: answer.cites ?? [],
                    confident: answer.confident,
                    ts: Date.now(),
                    sent: {
                        messages: sending.length,
                        first: sending[0]?.id,
                        last: sending[sending.length - 1]?.id,
                        looked: answer.looked?.map((what) => String(what.tool)),
                    },
                };
                await keepNote(client, room.roomId, note);
                setQuestion("");
                setOpen(false);
            } catch (error) {
                setFailed(_t("tg_layout|ai_failed", { reason: String((error as Error).message).slice(0, 160) }));
            } finally {
                setDoing(undefined);
                setStreaming(undefined);
                setBusy(false);
            }
        },
        [client, room, anchor],
    );

    if (!aiAvailable()) return null;

    // One element throughout: a pill, and a pill with a box in it. The class says which, and the shape
    // moves between them rather than one thing replacing another.
    const state = doing ? "doing" : open ? "asking" : "idle";

    return (
        <div className={`mx_TgAsk mx_TgAsk_${state}`} data-state={state}>
            {doing ? (
                <p className="mx_TgAsk_doing">
                    <SparkleIcon />
                    {doing}
                </p>
            ) : (
                <>
                    <AccessibleButton
                        kind="secondary"
                        className="mx_TgAsk_catchUp"
                        disabled={busy}
                        onClick={() => void run("summary")}
                    >
                        <SparkleIcon />
                        {_t("tg_layout|ai_catch_up")}
                    </AccessibleButton>

                    {!open && (
                        <AccessibleButton kind="link" className="mx_TgAsk_open_button" onClick={() => setOpen(true)}>
                            {_t("tg_layout|ai_ask")}
                        </AccessibleButton>
                    )}

                    {open && (
                        <form
                            className="mx_TgAsk_form"
                            onSubmit={(event) => {
                                event.preventDefault();
                                const asked = question.trim();
                                if (asked) void run("question", asked);
                            }}
                        >
                            <input
                                className="mx_TgAsk_input"
                                value={question}
                                disabled={busy}
                                autoFocus
                                placeholder={_t("tg_layout|ai_ask_placeholder")}
                                onChange={(event) => setQuestion(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") setOpen(false);
                                }}
                                aria-label={_t("tg_layout|ai_ask")}
                            />
                            <AccessibleButton
                                kind="primary"
                                className="mx_TgAsk_send"
                                element="button"
                                onClick={null}
                                disabled={busy || !question.trim()}
                                {...{ type: "submit" }}
                            >
                                <SendIcon />
                            </AccessibleButton>
                        </form>
                    )}
                </>
            )}

            {failed && <p className="mx_TgAsk_failed">{failed}</p>}
        </div>
    );
}
