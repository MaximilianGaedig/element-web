/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking the model, which lives behind the account rather than in the app.
 *
 * The app holds no key: it sends the access token it already has to our own server, which checks with
 * the homeserver whose token it is and answers only for accounts on it. What comes back is streamed -
 * the words as they are written, and a line for each thing the model went off to look at - because
 * waiting in silence and watching something read your chats are different experiences of the same ten
 * seconds.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import SdkConfig from "../../SdkConfig";

/** What it can be asked for. */
export type AskKind = "summary" | "question" | "replies" | "digest" | "questions";

/** A message as the model is given it: an id it can cite, who said it, when, and the words. */
export interface AskMessage {
    id: string;
    sender: string;
    ts?: string;
    body: string;
    /**
     * Who said it, and what they look like.
     *
     * Not for the model - it never sees either - but for the log room, where each message is mirrored by
     * a puppet wearing the sender's name and picture. A log you can recognise people in is one you will
     * actually read.
     */
    senderId?: string;
    avatar?: string;
    /** Whether this is one of the messages the reader has not read: what a summary is actually about. */
    new?: boolean;
    /** Whether the reader said it. Which side of a conversation they are on is not guessable from names. */
    mine?: boolean;
    /** Which chat it came from, where several are being read at once: a digest is not one conversation. */
    chat?: string;
    /** The message this one answers, where it answers one: a chat is not a flat list and never was. */
    replyTo?: string;
    /** What it is, where it is not words: a sticker, a gif, a photograph, a voice message, a file. */
    kind?: string;
    /** Whether it was edited after it was sent, which changes what "they said" means. */
    edited?: boolean;
}

/** What comes back once it has finished. */
export interface Answer {
    /** Messages to send, where what was asked for was drafts rather than an answer. */
    drafts?: string[];
    /** The open questions of a chat, answered: each one belongs under the message that asked it. */
    answers?: Array<{ id: string; question: string; answer: string; cites: string[] }>;
    /** Where this ask was kept, so it can be opened, read back and rated: a thread in your own log room. */
    kept?: { roomId: string; eventId: string };
    answer: string;
    /** Event ids the answer rests on, and web pages where it used them. */
    cites: string[];
    /** False when what it saw does not really answer the question. */
    confident: boolean;
    /** What it went and looked at on the way. */
    looked?: Array<{ tool: string; [key: string]: unknown }>;
    usage?: {
        input: number;
        output: number;
        model: string;
        cost: number;
        /** How long it took, and what is left of today's allowance for this account. */
        ms?: number;
        today?: { requests: number; tokens: number; cost: number };
        limits?: { requests: number; tokens: number; cost: number; atOnce: number };
    };
}

/** What happens while it works. */
export interface AskEvents {
    /** More words of the answer. */
    onText?: (whole: string) => void;
    /** It has gone to look something up: searching the chats, reading around one, asking the web. */
    onLooking?: (what: { tool: string; [key: string]: unknown }) => void;
}

/*
 * Where the model lives, and whether it is there at all. Neither is one of Element's own settings, so
 * they are read off the config object rather than through the typed accessor, which knows only the
 * settings upstream defines.
 */
interface AiConfig {
    ai_proxy_url?: string;
    ai_disabled?: boolean;
}

const config = (): AiConfig => SdkConfig.get() as unknown as AiConfig;

/** Beside the app by default, which is how it is deployed. */
function endpoint(): string {
    const configured = config().ai_proxy_url;
    return configured ? configured.replace(/\/$/, "") : "/_ai";
}

/**
 * What the reader thought of an answer.
 *
 * A reaction on the ask in their own log room, where the question, everything that was sent and the answer
 * are already sitting in a thread. So a bad answer can be opened and read rather than remembered as "it
 * was rubbish yesterday", which is the only way any of this gets better.
 */
export async function rate(
    client: MatrixClient,
    kept: { roomId: string; eventId: string },
    verdict: "good" | "bad",
): Promise<void> {
    await fetch(`${endpoint()}/rate`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${client.getAccessToken()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ room_id: kept.roomId, event_id: kept.eventId, verdict }),
    });
}

/** Whether there is anything to ask at all. */
export function aiAvailable(): boolean {
    return config().ai_disabled !== true;
}

/**
 * Asks, and reports as it goes.
 *
 * `messages` may be empty: a question about the whole history starts with none, and the model searches
 * for what it needs. Rate limits and refusals come back as an error with what the server said, because
 * "you have asked 300 times today" is something a person should be told rather than a spinner.
 */
export async function ask(
    client: MatrixClient,
    request: {
        kind: AskKind;
        messages?: AskMessage[];
        question?: string;
        /** The reader's own messages from this chat, when what is wanted is something in their voice. */
        style?: string[];
        /** And from their other chats, which may be written like but never repeated word for word. */
        elsewhere?: string[];
        /** Pictures to look at, as data urls: a question the words of the chat cannot answer. */
        images?: string[];
        better?: boolean;
    },
    events: AskEvents = {},
    signal?: AbortSignal,
): Promise<Answer> {
    const response = await fetch(`${endpoint()}/ask`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${client.getAccessToken()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...request, messages: request.messages ?? [], stream: true }),
        signal,
    });

    if (!response.ok || !response.body) {
        const said = await response.text().catch(() => "");
        let message = `The model could not be reached (${response.status}).`;
        try {
            const parsed = JSON.parse(said);
            if (parsed.error) message = parsed.error;
        } catch {
            // Then the status is all there is to say.
        }
        throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer: Answer | undefined;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            let event: { type: string; [key: string]: unknown };
            try {
                event = JSON.parse(line.slice(5).trim());
            } catch {
                continue;
            }
            if (event.type === "turn") {
                // The model started again: what it wrote before was it thinking on the way to a tool,
                // and showing that as the answer would be showing the reader the workings.
                beginAnswer();
                events.onText?.("");
            } else if (event.type === "delta" && typeof event.text === "string") {
                // The raw stream is the JSON the model is writing; the reader wants the words in it.
                events.onText?.(readable(bufferOf(event.text)));
            } else if (event.type === "looking") {
                events.onLooking?.(event as unknown as { tool: string });
            } else if (event.type === "done") {
                answer = event as unknown as Answer;
            } else if (event.type === "failed") {
                const said = typeof event.error === "string" ? event.error : "The model stopped part way through.";
                throw new Error(said);
            }
        }
    }

    if (!answer) throw new Error("The model stopped before it answered.");
    return answer;
}

/*
 * The answer arrives as JSON being written character by character, which is not a thing to show anyone.
 * These two keep the part of it that is the answer, and hand it over as readable text while it grows.
 */
let streamed = "";
function bufferOf(piece: string): string {
    streamed += piece;
    return streamed;
}

/** The answer's own words out of half-written JSON: everything after "answer": " up to its closing quote. */
function readable(whole: string): string {
    const start = whole.indexOf('"answer"');
    if (start < 0) return "";
    const opening = whole.indexOf('"', whole.indexOf(":", start) + 1);
    if (opening < 0) return "";
    let text = "";
    for (let at = opening + 1; at < whole.length; at++) {
        const character = whole[at];
        if (character === "\\") {
            const next = whole[at + 1];
            text += next === "n" ? "\n" : (next ?? "");
            at++;
        } else if (character === '"') {
            break;
        } else {
            text += character;
        }
    }
    return text;
}

/** Starts a fresh answer: the streamed text is read as one growing string. */
export function beginAnswer(): void {
    streamed = "";
}

/** What the model has cost, and what is left of today. */
export async function askUsage(client: MatrixClient): Promise<unknown | undefined> {
    try {
        const response = await fetch(`${endpoint()}/usage`, {
            headers: { Authorization: `Bearer ${client.getAccessToken()}` },
        });
        return response.ok ? await response.json() : undefined;
    } catch (error) {
        logger.warn("Could not read what the model has cost", error);
        return undefined;
    }
}
