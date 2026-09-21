/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking about the chat you are in.
 *
 * Two ways in, both of them one press on something you were already doing: "what did I miss", which reads
 * what is on screen and answers without being asked anything else, and "ask", which takes whatever you
 * have typed in the composer as the question and goes looking through the history for the answer.
 *
 * The composer, not a box of its own. You wonder about something mid-conversation and start typing it;
 * a second input appearing above the one you are already typing in is a second place to type the same
 * thing. So: type the question where you type everything else, and press ask instead of send.
 *
 * The shape of it: a pill floating over the conversation, and the answer arriving where an answer belongs
 * - in the timeline, as a message, under the thing it is about (TgAiNote). The pill does not grow into a
 * card of its own: an answer shown twice in two shapes is two things to read and one of them is an advert.
 * So the pill only ever says what is happening, and the words appear in the chat as they are written.
 *
 * The answer is kept there afterwards, visible only to you (utils/ai/notes.ts), so it is still there
 * tomorrow.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";

import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable, beginAnswer } from "../../../utils/ai/ask";
import { readable } from "../../../utils/ai/readable";
import { picturesFor } from "../../../utils/ai/pictures";
import { answerQuestions } from "../../../utils/ai/questions";
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

/**
 * What is typed in the composer right now.
 *
 * Read off the composer's own element rather than through a store: what is in front of the reader is
 * what gets asked, and nothing else in the app has to know that asking exists.
 */
function composerText(): string {
    const input = document.querySelector(".mx_MessageComposer .mx_BasicMessageComposer_input");
    return (input?.textContent ?? "").trim();
}

export function TgAsk({ room, anchor }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [busy, setBusy] = useState(false);
    /** What is in the composer, watched so the ask button can say what it will ask about. */
    const [typed, setTyped] = useState("");
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
            // Built once: what is sent is what the answer will say was sent. A question also takes the
            // pictures nobody has read - the ones whose text is already in the transcript stay out of it
            // (utils/ai/pictures.ts) - and a summary sends none at all.
            const [sending, pictures] = await Promise.all([
                readable(client, room, kind === "summary" ? READ_BACK : 40, newFrom),
                kind === "question" ? picturesFor(client, room) : Promise.resolve([]),
            ]);
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
                        images: pictures,
                        question: asked,
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
                    kept: answer.kept,
                    ts: Date.now(),
                    sent: {
                        messages: sending.length,
                        pictures: pictures.length,
                        first: sending[0]?.id,
                        last: sending[sending.length - 1]?.id,
                        looked: answer.looked?.map((what) => String(what.tool)),
                    },
                };
                await keepNote(client, room.roomId, note);
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

    /*
     * What is typed, polled while the strip is on screen.
     *
     * The composer is somebody else's component with its own editor model; watching it from here means
     * reading what it shows. A quarter of a second is far below noticing and costs nothing measurable.
     */
    useEffect(() => {
        const tick = window.setInterval(() => setTyped(composerText()), 250);
        return () => window.clearInterval(tick);
    }, []);

    /** The chat's own open questions, answered under the messages that asked them. */
    const findAnswers = useCallback(async (): Promise<void> => {
        setBusy(true);
        setFailed(undefined);
        setDoing(_t("tg_layout|ai_reading_questions"));
        try {
            const found = await answerQuestions(client, room);
            if (!found) setFailed(_t("tg_layout|ai_no_open_questions"));
        } catch (error) {
            setFailed(_t("tg_layout|ai_failed", { reason: String((error as Error).message).slice(0, 160) }));
        } finally {
            setDoing(undefined);
            setBusy(false);
        }
    }, [client, room]);

    if (!aiAvailable()) return null;

    const state = doing ? "doing" : "idle";

    return (
        <div className={`mx_TgAsk mx_TgAsk_${state}`} data-state={state}>
            {doing ? (
                <p className="mx_TgAsk_doing">
                    <SparkleIcon />
                    {doing}
                </p>
            ) : (
                <>
                    <Button
                        kind="secondary"
                        size="md"
                        className="mx_TgAsk_catchUp"
                        disabled={busy}
                        onClick={() => void run("summary")}
                    >
                        <SparkleIcon />
                        {_t("tg_layout|ai_catch_up")}
                    </Button>

                    {/*
                        The questions in the chat that nobody answered - wondered aloud as often as asked
                        outright. Each answer lands under the message that asked it.
                    */}
                    <Button
                        kind="secondary"
                        size="md"
                        className="mx_TgAsk_questions"
                        disabled={busy}
                        onClick={() => void findAnswers()}
                    >
                        <SparkleIcon />
                        {_t("tg_layout|ai_open_questions")}
                    </Button>

                    {/*
                        Asks what is in the composer. Nothing to type here, nothing to open: you were
                        already writing the question when you wondered whether to send it to a person or
                        to the model.
                    */}
                    <Button
                        kind="secondary"
                        size="md"
                        className="mx_TgAsk_askButton"
                        disabled={busy || !typed}
                        title={typed ? _t("tg_layout|ai_ask_this", { question: typed }) : _t("tg_layout|ai_ask_hint")}
                        onClick={() => void run("question", typed)}
                    >
                        <SparkleIcon />
                        {_t("tg_layout|ai_ask")}
                    </Button>
                </>
            )}

            {failed && <p className="mx_TgAsk_failed">{failed}</p>}
        </div>
    );
}
