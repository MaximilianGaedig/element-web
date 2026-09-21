/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking about the chat you are in: one strip above the composer.
 *
 * Three ways in, none of them a new place to type. "What did I miss" reads what is on screen and answers
 * without being asked anything else. "Open questions" goes looking for what somebody wondered aloud and
 * nobody came back to. And asking outright takes whatever is already in the composer as the question -
 * because you were writing it when you wondered whether to send it to a person or to the model, and a
 * second box above the one you are typing in is a second place to type the same thing.
 *
 * Asking is offered only when there is something to ask: a button that is disabled most of the time is a
 * button teaching you not to look at it.
 *
 * The answer arrives where an answer belongs - in the timeline, as a message, under the thing it is about
 * (AiNote) - and is kept there afterwards, visible only to you. This strip only ever says what is
 * happening while it happens.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import AiIcon from "@vector-im/compound-design-tokens/assets/web/icons/ai";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { Button, IconButton } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { ask, aiAvailable } from "../../../utils/ai/ask";
import { readable } from "../../../utils/ai/readable";
import { picturesFor } from "../../../utils/ai/pictures";
import { answerQuestions } from "../../../utils/ai/questions";
import { type AiNote, keepNote } from "../../../utils/ai/notes";
import { setStreaming } from "../../../utils/ai/streaming";
import { lookingWords } from "./AiNote";

/** How much a summary is given at most: a day of a busy chat, not a year of one. */
const READ_BACK = 200;

/** How much a question is given before it goes looking for the rest itself. */
const AROUND = 40;

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

const COMPOSER = ".mx_MessageComposer .mx_BasicMessageComposer_input";

const nowTyped = (): string => (document.querySelector(COMPOSER)?.textContent ?? "").trim();

/**
 * What is in the composer right now, watched rather than polled.
 *
 * The composer is somebody else's component with its own editor model, so what is in front of the reader
 * is read off what it shows. Watched with an observer and not a timer: a quarter-second poll running for
 * as long as a chat is open, on every chat, to notice something that changes when a key is pressed, is a
 * wake-up per tick forever - and it still missed the clear after sending, which happens without an input
 * event because the composer empties itself. An observer sees both, and sees them at once.
 */
function useComposerText(roomId: string): string {
    const [typed, setTyped] = useState("");
    useEffect(() => {
        setTyped(nowTyped());
        let watched: Element | undefined;
        const changed = new MutationObserver(() => setTyped(nowTyped()));
        const attach = (): void => {
            // Cheap enough to run on any mutation: only a disconnected node costs a query.
            if (watched?.isConnected) return;
            const node = document.querySelector(COMPOSER) ?? undefined;
            if (node === watched) return;
            changed.disconnect();
            watched = node;
            if (watched) changed.observe(watched, { characterData: true, childList: true, subtree: true });
            setTyped(nowTyped());
        };
        // The composer itself comes and goes - joining a room, switching to one, opening a thread.
        const around = new MutationObserver(attach);
        around.observe(document.body, { childList: true, subtree: true });
        attach();
        return () => {
            changed.disconnect();
            around.disconnect();
        };
    }, [roomId]);
    return typed;
}

interface Props {
    room: Room;
    /** Where the answer will sit: the message it is about, usually the newest one. */
    anchor?: string;
}

export function AiBar({ room, anchor }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState<string>();
    /** What the model is doing right now, said in the strip while it does it. */
    const [doing, setDoing] = useState<string>();
    const abort = useRef<AbortController>(undefined);
    const typed = useComposerText(room.roomId);

    // Every way of asking fails the same way, and clears the last failure before it tries again.
    const attempt = useCallback(async (what: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setFailed(undefined);
        try {
            await what();
        } catch (error) {
            setFailed(_t("ai|failed", { reason: String((error as Error).message).slice(0, 160) }));
        } finally {
            setDoing(undefined);
            setBusy(false);
        }
    }, []);

    const run = useCallback(
        (kind: "summary" | "question", asked?: string): Promise<void> =>
            attempt(async () => {
                const events = room.getLiveTimeline().getEvents();
                const at = anchor ?? events[events.length - 1]?.getId();
                if (!at) return;

                const newFrom = kind === "summary" ? unreadFrom(room, events) : undefined;
                // Built once: what is sent is what the answer will say was sent. A question also takes the
                // pictures nobody has read - the ones whose text is already in the transcript stay out of
                // it (utils/ai/pictures.ts) - and a summary sends none at all.
                const [sending, pictures] = await Promise.all([
                    readable(client, room, kind === "summary" ? READ_BACK : AROUND, newFrom),
                    kind === "question" ? picturesFor(client, room) : Promise.resolve([]),
                ]);

                abort.current?.abort();
                abort.current = new AbortController();

                let text = "";
                setDoing(_t("ai|thinking"));
                setStreaming({ anchor: at, roomId: room.roomId, text: "", looking: _t("ai|thinking") });

                try {
                    const answer = await ask(
                        client,
                        { kind, messages: sending, images: pictures, question: asked },
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
                    if (!answer.answer.trim()) throw new Error(_t("ai|no_answer"));

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
                            model: answer.usage?.model,
                            ms: answer.usage?.ms,
                            asksLeft:
                                answer.usage?.limits && answer.usage.today
                                    ? answer.usage.limits.requests - answer.usage.today.requests
                                    : undefined,
                        },
                    };
                    await keepNote(client, room.roomId, note);
                } finally {
                    setStreaming(undefined);
                }
            }),
        [attempt, client, room, anchor],
    );

    /** The chat's own open questions, answered under the messages that asked them. */
    const findAnswers = useCallback(
        (): Promise<void> =>
            attempt(async () => {
                setDoing(_t("ai|reading_questions"));
                const found = await answerQuestions(client, room);
                if (!found) setFailed(_t("ai|no_open_questions"));
            }),
        [attempt, client, room],
    );

    if (!aiAvailable()) return null;

    if (doing) {
        return (
            <div className="mx_AiBar mx_AiBar_doing" aria-live="polite">
                <AiIcon className="mx_Ai_mark" />
                {doing}
            </div>
        );
    }

    if (failed) {
        return (
            <div className="mx_AiBar mx_AiBar_failed" role="status">
                <span className="mx_AiBar_reason">{failed}</span>
                <IconButton size="20px" tooltip={_t("action|dismiss")} onClick={() => setFailed(undefined)}>
                    <CloseIcon />
                </IconButton>
            </div>
        );
    }

    return (
        <div className="mx_AiBar">
            {/* One mark for the strip rather than one on every button: three of the same icon in a row
                says nothing three times. */}
            <AiIcon className="mx_Ai_mark" aria-hidden />

            {/*
                Asking what is already typed. Offered only while there is something to ask about, so it is
                never a dead control - and primary while it is there, because if you are typing a question
                it is the thing you came here to press.
            */}
            {typed && (
                <Button
                    kind="primary"
                    size="md"
                    className="mx_AiBar_button"
                    disabled={busy}
                    title={_t("ai|ask_this", { question: typed })}
                    onClick={() => void run("question", typed)}
                >
                    {_t("ai|ask")}
                </Button>
            )}

            <Button
                kind="secondary"
                size="md"
                className="mx_AiBar_button"
                disabled={busy}
                onClick={() => void run("summary")}
            >
                {_t("ai|catch_up")}
            </Button>

            {/* The questions in the chat that nobody answered - wondered aloud as often as asked outright.
                Each answer lands under the message that asked it. */}
            <Button
                kind="secondary"
                size="md"
                className="mx_AiBar_button"
                disabled={busy}
                onClick={() => void findAnswers()}
            >
                {_t("ai|open_questions")}
            </Button>
        </div>
    );
}
