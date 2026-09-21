/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking about a chat: the doing of it, apart from anywhere it is offered from.
 *
 * It is offered from the composer's own menu, beside attaching a file and sending a picture, because that
 * is where the things you can do to a message already live and a strip of buttons of its own above the
 * box you type in is a permanent advertisement for a thing you use twice a day. But what happens next -
 * the wait, and the failure - belongs over the composer where you are looking. Two places, one piece of
 * work, so the work lives here and both of them talk to it.
 *
 * What it is doing is kept here as well, for the same reason the streaming text is (utils/ai/streaming.ts):
 * the menu that starts it has closed by the time there is anything to say.
 */

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { useSyncExternalStore } from "react";

import { ask, aiAvailable } from "./ask";
import { readable } from "./readable";
import { picturesFor } from "./pictures";
import { answerQuestions } from "./questions";
import { type AiNote, keepNote } from "./notes";
import { setStreaming } from "./streaming";
import { _t } from "../../languageHandler";

/** How much a summary is given at most: a day of a busy chat, not a year of one. */
const READ_BACK = 200;

/** How much a question is given before it goes looking for the rest itself. */
const AROUND = 40;

/** What is happening right now, if anything: one of the two, never both. */
export interface Asking {
    /** What the model is doing, in words rather than a spinner. */
    doing?: string;
    /** Why it could not, until it is dismissed or something else is asked. */
    failed?: string;
}

let state: Asking = {};
const listeners = new Set<() => void>();

const set = (next: Asking): void => {
    state = next;
    for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** What is happening, for whoever is showing it. */
export const useAsking = (): Asking => useSyncExternalStore(subscribe, () => state);

/** Put the failure away: an error that outlives the moment is one you learn to read past. */
export const dismissFailure = (): void => set({});

/** What the model is doing, in words. */
export function lookingWords(tool: string): string {
    switch (tool) {
        case "search_messages":
            return _t("ai|looking_messages");
        case "read_around":
            return _t("ai|looking_around");
        case "search_web":
            return _t("ai|looking_web");
        case "list_chats":
            return _t("ai|looking_chats");
        default:
            return _t("ai|thinking");
    }
}

/**
 * What is typed in the composer right now.
 *
 * Read off the composer's own element rather than through a store: what is in front of the reader is what
 * gets asked, and nothing else in the app has to know that asking exists. The one caller is the composer's
 * own menu, which is about to ask about it.
 */
export const composerText = (): string =>
    (document.querySelector(".mx_MessageComposer .mx_BasicMessageComposer_input")?.textContent ?? "").trim();

/** Whether there is anything to ask at all. */
export const canAsk = (): boolean => aiAvailable();

/** Every way of asking fails the same way, and clears the last failure before it tries again. */
async function attempt(what: () => Promise<void>): Promise<void> {
    set({ doing: _t("ai|thinking") });
    try {
        await what();
        set({});
    } catch (error) {
        set({ failed: _t("ai|failed", { reason: String((error as Error).message).slice(0, 160) }) });
    }
}

/**
 * Where what you missed begins.
 *
 * "What did I miss" is about the unread messages, but it cannot be answered from them alone: three replies
 * saying "yes, do that" summarise to nothing without the question they answer. So the model is given the
 * last READ_BACK messages either way, and told which of them are the new ones - context to read, and a
 * line about what is new. Where the read marker cannot be found (it has fallen out of the timeline, or
 * there is none) there is nothing to point at, and the last of the chat is the honest answer.
 */
function unreadFrom(room: Room, events: MatrixEvent[]): string | undefined {
    const readUpTo = room.getEventReadUpTo(room.client.getSafeUserId(), true);
    const at = readUpTo ? events.findIndex((event) => event.getId() === readUpTo) : -1;
    return at >= 0 ? events[at + 1]?.getId() : undefined;
}

/** The chat's own open questions, answered under the messages that asked them. */
export const askOpenQuestions = (client: MatrixClient, room: Room): Promise<void> =>
    attempt(async () => {
        set({ doing: _t("ai|reading_questions") });
        const found = await answerQuestions(client, room);
        if (!found) throw new Error(_t("ai|no_open_questions"));
    });

/**
 * A summary of what was missed, or an answer to something asked - both of which arrive in the timeline as
 * a note under the newest message (AiNote), and are kept there afterwards.
 */
export const askAbout = (
    client: MatrixClient,
    room: Room,
    kind: "summary" | "question",
    question?: string,
): Promise<void> =>
    attempt(async () => {
        const events = room.getLiveTimeline().getEvents();
        const at = events[events.length - 1]?.getId();
        if (!at) return;

        const newFrom = kind === "summary" ? unreadFrom(room, events) : undefined;
        // Built once: what is sent is what the answer will say was sent. A question also takes the
        // pictures nobody has read - the ones whose text is already in the transcript stay out of it
        // (utils/ai/pictures.ts) - and a summary sends none at all.
        const [sending, pictures] = await Promise.all([
            readable(client, room, kind === "summary" ? READ_BACK : AROUND, newFrom),
            kind === "question" ? picturesFor(client, room) : Promise.resolve([]),
        ]);

        let text = "";
        setStreaming({ anchor: at, roomId: room.roomId, text: "", looking: _t("ai|thinking") });
        try {
            const answer = await ask(
                client,
                { kind, messages: sending, images: pictures, question },
                {
                    onText: (whole) => {
                        text = whole;
                        set({});
                        setStreaming({ anchor: at, roomId: room.roomId, text, looking: undefined });
                    },
                    onLooking: (what) => {
                        const looking = lookingWords(what.tool);
                        set({ doing: looking });
                        setStreaming({ anchor: at, roomId: room.roomId, text, looking });
                    },
                },
            );

            // Nothing to keep is a failure, not an answer: a bubble holding only "this may not be the
            // whole answer" is worse than being told it did not manage one.
            if (!answer.answer.trim()) throw new Error(_t("ai|no_answer"));

            const note: AiNote = {
                id: `ai-${Date.now().toString(36)}`,
                anchor: at,
                question,
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
    });
