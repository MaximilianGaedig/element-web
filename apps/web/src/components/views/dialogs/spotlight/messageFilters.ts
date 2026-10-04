/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The narrowing chips under the search field when it is looking for messages.
 *
 * Telegram's global search offers the same three cuts - where (chats, groups, channels), what kind (media,
 * links, files, music, voice) and when - and applies them to the hits, so they are the same here. The server
 * (or the local index) matches the words; what is left of a page of hits after these is what is shown. They
 * are plain functions of an event so the rule is one place and a test can state it.
 */

/** What kind of message: every hit, or only those of one kind. */
export type MessageKind = "any" | "media" | "links" | "files" | "music" | "voice";
/** Where the message was said. */
export type MessageChat = "any" | "direct" | "group";
/** When it was said, counting back from now. */
export type MessageWhen = "any" | "day" | "week" | "month";

export interface MessageFilter {
    kind: MessageKind;
    chat: MessageChat;
    when: MessageWhen;
}

export const NO_MESSAGE_FILTER: MessageFilter = { kind: "any", chat: "any", when: "any" };

/** What each row of chips offers; "any" is not a chip, it is every chip off. */
export const MESSAGE_KINDS = ["media", "links", "files", "music", "voice"] as const;
export const MESSAGE_CHATS = ["direct", "group"] as const;
export const MESSAGE_WHENS = ["day", "week", "month"] as const;

/** How far back each "when" reaches. */
const WHEN_MS: Record<Exclude<MessageWhen, "any">, number> = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
};

/** The parts of an event the filters read, so they can be tested without building one. */
export interface FilterableMessage {
    ts: number;
    content: Record<string, any>;
    isDirect: boolean;
}

const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+\.\S+/i;
const VOICE_KEY = "org.matrix.msc3245.voice";

/** The kind a message is, as Telegram's tabs would file it. */
export function kindOf(content: Record<string, any>): Exclude<MessageKind, "any"> | undefined {
    switch (content.msgtype) {
        case "m.image":
        case "m.video":
            return "media";
        case "m.audio":
            // A voice message is an audio message with the voice marker; Telegram files it apart from music.
            return VOICE_KEY in content ? "voice" : "music";
        case "m.file":
            return "files";
    }
    return typeof content.body === "string" && URL_PATTERN.test(content.body) ? "links" : undefined;
}

export function isFiltering(filter: MessageFilter): boolean {
    return filter.kind !== "any" || filter.chat !== "any" || filter.when !== "any";
}

export function matchesMessageFilter(message: FilterableMessage, filter: MessageFilter, now = Date.now()): boolean {
    if (filter.chat === "direct" && !message.isDirect) return false;
    if (filter.chat === "group" && message.isDirect) return false;
    if (filter.when !== "any" && message.ts < now - WHEN_MS[filter.when]) return false;
    if (filter.kind !== "any") {
        const kind = kindOf(message.content);
        // A link is a link wherever it sits, so a file caption with one in it is both.
        if (kind !== filter.kind && !(filter.kind === "links" && URL_PATTERN.test(String(message.content.body)))) {
            return false;
        }
    }
    return true;
}
