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
 * The answer does not appear here. It appears in the timeline, under the message it is about, where the
 * conversation it concerns is - and only you can see it (utils/ai/notes.ts). This is the doorway, not
 * the room.
 */

import React, { type JSX, useCallback, useRef, useState } from "react";
import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";
import SendIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { type AskMessage, ask, aiAvailable, beginAnswer } from "../../../utils/ai/ask";
import { type AiNote, keepNote } from "../../../utils/ai/notes";
import { setStreaming } from "../../../utils/ai/streaming";
import { lookingWords } from "./TgAiNote";

/** How much a summary is given at most: a day of a busy chat, not a year of one. */
const READ_BACK = 200;

/**
 * What you actually missed: everything after the last message you have read.
 *
 * "What did I miss" means the unread ones, not the last two hundred - a chat you read an hour ago has
 * nothing to summarise, and one you left a week ago has more than fits on screen. Where the read marker
 * cannot be found (it has fallen out of the timeline, or there is none), what is loaded is all there is
 * to go on, and the last of it is the honest answer.
 */
function unreadOf(room: Room, events: MatrixEvent[]): MatrixEvent[] {
    const readUpTo = room.getEventReadUpTo(room.client.getSafeUserId(), true);
    const at = readUpTo ? events.findIndex((event) => event.getId() === readUpTo) : -1;
    const after = at >= 0 ? events.slice(at + 1) : [];
    return after.length ? after.slice(-READ_BACK) : events.slice(-READ_BACK);
}

/** The messages as the model is given them: an id it can cite, who said it, when, and the words. */
function readable(events: MatrixEvent[]): AskMessage[] {
    const out: AskMessage[] = [];
    for (const event of events.slice(-READ_BACK)) {
        if (event.getType() !== "m.room.message" || event.isRedacted()) continue;
        const body = event.getContent().body;
        if (typeof body !== "string" || !body.trim()) continue;
        out.push({
            id: event.getId()!,
            sender: event.sender?.name ?? event.getSender() ?? "?",
            ts: new Date(event.getTs()).toISOString().slice(0, 16).replace("T", " "),
            body: body.slice(0, 2000),
        });
    }
    return out;
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
    const abort = useRef<AbortController>(undefined);

    const run = useCallback(
        async (kind: "summary" | "question", asked?: string): Promise<void> => {
            const events = room.getLiveTimeline().getEvents();
            const at = anchor ?? events[events.length - 1]?.getId();
            if (!at) return;

            setBusy(true);
            setFailed(undefined);
            beginAnswer();
            abort.current?.abort();
            abort.current = new AbortController();

            let looking: string | undefined;
            let text = "";
            setStreaming({ anchor: at, roomId: room.roomId, text: "", looking: _t("tg_layout|ai_thinking") });

            try {
                const answer = await ask(
                    client,
                    {
                        kind,
                        // A question may need the whole history, which the model searches for itself; a
                        // summary is about what is here.
                        // A summary is of what was missed; a question may need the whole history, which
                        // the model goes and searches for itself.
                        messages: kind === "summary" ? readable(unreadOf(room, events)) : readable(events).slice(-40),
                        question: asked,
                    },
                    {
                        onText: (whole) => {
                            text = whole;
                            setStreaming({ anchor: at, roomId: room.roomId, text, looking: undefined });
                        },
                        onLooking: (what) => {
                            looking = lookingWords(what.tool);
                            setStreaming({ anchor: at, roomId: room.roomId, text, looking });
                        },
                    },
                    abort.current.signal,
                );

                const note: AiNote = {
                    id: `ai-${Date.now().toString(36)}`,
                    anchor: at,
                    question: asked,
                    answer: answer.answer,
                    cites: answer.cites ?? [],
                    confident: answer.confident,
                    ts: Date.now(),
                };
                await keepNote(client, room.roomId, note);
                setQuestion("");
            } catch (error) {
                setFailed(_t("tg_layout|ai_failed", { reason: String((error as Error).message).slice(0, 160) }));
            } finally {
                setStreaming(undefined);
                setBusy(false);
            }
        },
        [client, room, anchor],
    );

    if (!aiAvailable()) return null;

    return (
        <div className={`mx_TgAsk${open ? " mx_TgAsk_open" : ""}`}>
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
                        placeholder={_t("tg_layout|ai_ask_placeholder")}
                        onChange={(event) => setQuestion(event.target.value)}
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

            {failed && <p className="mx_TgAsk_failed">{failed}</p>}
        </div>
    );
}
