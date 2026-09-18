/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, type IContent, type MatrixEvent, RelationType } from "matrix-js-sdk/src/matrix";

/**
 * The custom field mautrix-telegram (and compatible bridges) attach to bridged
 * `m.room.message` events to describe a Telegram keyboard (`ReplyMarkup`).
 *
 * Despite the name, it covers every kind of Telegram keyboard, see {@link TelegramKeyboardKind}.
 * Schema: mautrix-telegram `docs/inline-buttons.md` / `pkg/connector/inlinebuttons.go`.
 */
export const TELEGRAM_BUTTONS_FIELD = "fi.mau.telegram.buttons";

/**
 * - `inline`: buttons attached under the message.
 * - `reply`: a custom "reply keyboard" that replaces the client's keyboard (rendered above the composer).
 * - `hide`: asks the client to hide any custom reply keyboard. No rows.
 * - `force_reply`: asks the client to open the composer in reply mode. No rows.
 */
export type TelegramKeyboardKind = "inline" | "reply" | "hide" | "force_reply";

const KEYBOARD_KINDS: ReadonlySet<string> = new Set<TelegramKeyboardKind>(["inline", "reply", "hide", "force_reply"]);

/**
 * Button types whose only Matrix-side action is sending their `command` to the bridge, which then
 * replies in the room (with a URL, instructions, a shared contact, ...).
 */
export type TelegramCommandButtonType =
    | "url_auth"
    | "game"
    | "webview"
    | "simple_webview"
    | "request_geo"
    | "request_poll"
    | "request_peer"
    | "request_phone";

const COMMAND_BUTTON_TYPES: ReadonlySet<string> = new Set<TelegramCommandButtonType>([
    "url_auth",
    "game",
    "webview",
    "simple_webview",
    "request_geo",
    "request_poll",
    "request_peer",
    "request_phone",
]);

/** A button that, when pressed, sends its `command` as a plain text message into the room. */
export interface TelegramCallbackButton {
    type: "callback";
    text: string;
    command: string;
    /** 2FA-protected callback: the bridge can never press it. */
    requiresPassword: boolean;
}

/** A button that opens an external URL. */
export interface TelegramUrlButton {
    type: "url";
    text: string;
    url: string;
}

/** A plain reply-keyboard button: pressing it sends `text` as an ordinary message. */
export interface TelegramReplyButton {
    type: "reply";
    text: string;
}

/** Copies `copyText` to the clipboard. Purely client-side. */
export interface TelegramCopyButton {
    type: "copy";
    text: string;
    copyText: string;
}

/** Prefills the composer with `@<botUsername> <query>`. Purely client-side. */
export interface TelegramSwitchInlineButton {
    type: "switch_inline";
    text: string;
    query: string;
    botUsername: string;
}

/** Opens the profile of `userMxid`. Purely client-side. */
export interface TelegramUserProfileButton {
    type: "user_profile";
    text: string;
    userMxid: string;
}

/** A button that is pressed by sending `command`, see {@link TelegramCommandButtonType}. */
export interface TelegramCommandButton {
    type: TelegramCommandButtonType;
    text: string;
    command: string;
}

/** Any button type we can't act on (buy, unsupported, unknown types, or a malformed known type). */
export interface TelegramUnsupportedButton {
    type: "unsupported";
    text: string;
}

export type TelegramButton =
    | TelegramCallbackButton
    | TelegramUrlButton
    | TelegramReplyButton
    | TelegramCopyButton
    | TelegramSwitchInlineButton
    | TelegramUserProfileButton
    | TelegramCommandButton
    | TelegramUnsupportedButton;

export interface TelegramButtonsContent {
    rows: TelegramButton[][];
}

export interface TelegramKeyboard extends TelegramButtonsContent {
    keyboard: TelegramKeyboardKind;
    /** `reply` only: show compact buttons. */
    resize: boolean;
    /** `reply`/`force_reply`: hide the keyboard after it has been used once. */
    singleUse: boolean;
    /** `reply`/`force_reply`: composer placeholder. */
    placeholder?: string;
    /**
     * `reply`/`hide`/`force_reply`: in Telegram, only applies to mentioned users / the replied-to user.
     * The bridge can't tell us who that is in Matrix terms, so Element ignores it and treats every
     * keyboard as applying to everyone in the room.
     */
    selective: boolean;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

function optString(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function parseButton(btnRaw: unknown): TelegramButton | null {
    if (!btnRaw || typeof btnRaw !== "object") return null;
    const btn = btnRaw as Record<string, unknown>;
    if (!isNonEmptyString(btn["text"])) return null;
    const text = btn["text"];
    const type = btn["type"];
    const command = btn["command"];

    if (type === "callback" && isNonEmptyString(command)) {
        return { type, text, command, requiresPassword: btn["requires_password"] === true };
    } else if (type === "url" && isNonEmptyString(btn["url"])) {
        return { type, text, url: btn["url"] };
    } else if (type === "reply") {
        return { type, text };
    } else if (type === "copy" && isNonEmptyString(btn["copy_text"])) {
        return { type, text, copyText: btn["copy_text"] };
    } else if (type === "switch_inline") {
        const query = optString(btn["query"]);
        const botUsername = optString(btn["bot_username"]);
        // Nothing to insert at all: treat as unusable.
        if (query || botUsername) return { type, text, query, botUsername };
    } else if (type === "user_profile" && isNonEmptyString(btn["user_mxid"]) && btn["user_mxid"].startsWith("@")) {
        return { type, text, userMxid: btn["user_mxid"] };
    } else if (typeof type === "string" && COMMAND_BUTTON_TYPES.has(type) && isNonEmptyString(command)) {
        return { type: type as TelegramCommandButtonType, text, command };
    }
    // buy / unsupported / unknown types, or a known type missing its required field.
    return { type: "unsupported", text };
}

/**
 * Parses the full `fi.mau.telegram.buttons` field out of an event's (already-resolved) content,
 * whatever its keyboard kind.
 *
 * This is defensive: malformed buttons are downgraded to "unsupported" (or dropped if they lack
 * a label), and an unusable overall shape (unknown `keyboard`, an inline/reply keyboard with no
 * buttons, ...) yields `null`. This function never throws.
 */
export function parseBridgeKeyboard(content: IContent | undefined | null): TelegramKeyboard | null {
    try {
        const raw = content?.[TELEGRAM_BUTTONS_FIELD];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const obj = raw as Record<string, unknown>;

        const kindRaw = obj["keyboard"] ?? "inline";
        if (typeof kindRaw !== "string" || !KEYBOARD_KINDS.has(kindRaw)) return null;
        const keyboard = kindRaw as TelegramKeyboardKind;

        const rows: TelegramButton[][] = [];
        const rowsRaw = obj["rows"];
        if (Array.isArray(rowsRaw)) {
            for (const rowRaw of rowsRaw) {
                if (!Array.isArray(rowRaw)) continue;
                const row = rowRaw.map(parseButton).filter((b): b is TelegramButton => b !== null);
                if (row.length > 0) rows.push(row);
            }
        }

        // Keyboards that are all about their buttons are useless without any.
        if ((keyboard === "inline" || keyboard === "reply") && rows.length === 0) return null;

        const placeholder = obj["placeholder"];
        return {
            keyboard,
            rows,
            resize: obj["resize"] === true,
            singleUse: obj["single_use"] === true,
            placeholder: isNonEmptyString(placeholder) ? placeholder : undefined,
            selective: obj["selective"] === true,
        };
    } catch {
        // Never let malformed bridge data break rendering.
        return null;
    }
}

/**
 * Parses the `fi.mau.telegram.buttons` field for rendering under the message itself, i.e. only
 * `inline` keyboards (the default when `keyboard` is absent). Never throws.
 */
export function parseBridgeButtons(content: IContent | undefined | null): TelegramButtonsContent | null {
    const kb = parseBridgeKeyboard(content);
    if (!kb || kb.keyboard !== "inline") return null;
    return { rows: kb.rows };
}

export interface ActiveReplyKeyboard {
    /** The event that carries the keyboard. */
    event: MatrixEvent;
    keyboard: TelegramKeyboard;
}

/**
 * Picks the keyboard that should currently drive the room's composer from a list of main
 * timeline events (oldest first): the latest event whose keyboard is `reply`, `hide` or
 * `force_reply` wins. Inline keyboards don't affect it.
 *
 * Returns `null` if nothing should be shown: no such event, the latest one is `hide`, or it is a
 * `force_reply` that the user (`myUserId`) already answered by sending a message after it.
 * Thread replies, edits and redacted events are ignored. Never throws.
 */
export function findActiveReplyKeyboard(
    events: readonly MatrixEvent[],
    myUserId: string | null | undefined,
): ActiveReplyKeyboard | null {
    try {
        let sentMessageSince = false;
        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i];
            if (!ev || ev.isRedacted()) continue;
            // Only the main timeline drives the main composer.
            if (ev.threadRootId !== undefined && !ev.isThreadRoot) continue;
            // Edits are folded into their original via getContent(); don't treat them as new keyboards.
            if (ev.isRelation(RelationType.Replace)) continue;

            if (myUserId && ev.getSender() === myUserId && ev.getType() === EventType.RoomMessage) {
                sentMessageSince = true;
                continue;
            }

            const keyboard = parseBridgeKeyboard(ev.getContent());
            if (!keyboard || keyboard.keyboard === "inline") continue;
            if (keyboard.keyboard === "hide") return null;
            if (keyboard.keyboard === "force_reply" && sentMessageSince) return null;
            return { event: ev, keyboard };
        }
    } catch {
        // fall through
    }
    return null;
}
