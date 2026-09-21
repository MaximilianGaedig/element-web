/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The questions in a chat that nobody answered.
 *
 * Half of what anybody wants from this is not a question they typed into a box: it is the thing somebody
 * wondered aloud four messages ago and the conversation moved past - what time the flight lands, whether
 * the chemist is open on Sunday, what the parcel number was, how much that came to. Asked or merely
 * wondered, by the reader or by anybody else.
 *
 * So the recent messages are read for open questions, each is answered from what can actually be found -
 * this chat, the reader's other chats, the web - and each answer is kept as a note under the message that
 * asked it (utils/ai/notes.ts): private, yours to send to the others or to take away. A question that was
 * answered later in the chat is not open, and a question nothing can answer is left alone rather than
 * answered with a shrug.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { ask, aiAvailable } from "./ask";
import { readable } from "./readable";
import { type AiNote, keepNote } from "./notes";

/**
 * How much of the chat counts as "recent".
 *
 * A hundred and twenty messages is a few days of a busy chat and a month of a quiet one - far enough back
 * that the thing somebody wondered on Tuesday is still in view, and not so far that the answer arrives
 * under a question everybody stopped caring about. A summary reads two hundred; questions get fewer
 * because each one it finds may cost a search.
 */
const READ_BACK = 120;

/** What was answered when, so opening the same chat twice does not ask twice. */
const done = new Map<string, number>();

/** Nothing to look for where nobody asked anything. */
const asksSomething = (body: string): boolean => body.includes("?");

/**
 * Answers the open questions in a chat, as notes under the messages that asked them.
 *
 * Returns how many it answered, so the caller can say so. Asking costs a search or two, so it is asked
 * for rather than automatic, and the same newest message is never asked about twice.
 */
export async function answerQuestions(client: MatrixClient, room: Room): Promise<number> {
    if (!aiAvailable()) return 0;
    const messages = await readable(client, room, READ_BACK);
    if (!messages.some((message) => asksSomething(message.body))) return 0;

    const newest = messages[messages.length - 1]?.id;
    if (!newest || done.get(room.roomId) === messages.length) return 0;

    const answer = await ask(client, { kind: "questions", messages });
    done.set(room.roomId, messages.length);

    const answers = answer.answers ?? [];
    for (const one of answers) {
        // Under the message that asked it, where the question is - not at the bottom of the chat.
        const anchor = messages.some((message) => message.id === one.id) ? one.id : newest;
        const note: AiNote = {
            id: `ai-q-${one.id}`,
            anchor,
            question: one.question,
            answer: one.answer,
            cites: one.cites,
            confident: true,
            kept: answer.kept,
            ts: Date.now(),
            sent: { messages: messages.length, looked: answer.looked?.map((what) => String(what.tool)) },
        };
        await keepNote(client, room.roomId, note);
    }
    return answers.length;
}
