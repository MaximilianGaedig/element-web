/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IContent } from "matrix-js-sdk/src/matrix";

/**
 * The custom field mautrix-telegram (and compatible bridges) attach to bridged
 * `m.room.message` events to describe a Telegram inline keyboard.
 */
export const TELEGRAM_BUTTONS_FIELD = "fi.mau.telegram.buttons";

/** A button that, when pressed, sends its `command` as a plain text message into the room. */
export interface TelegramCallbackButton {
    type: "callback";
    text: string;
    command: string;
}

/** A button that opens an external URL. */
export interface TelegramUrlButton {
    type: "url";
    text: string;
    url: string;
}

/** Any button type we don't have explicit handling for (or a malformed callback/url button). */
export interface TelegramUnsupportedButton {
    type: "unsupported";
    text: string;
}

export type TelegramButton = TelegramCallbackButton | TelegramUrlButton | TelegramUnsupportedButton;

export interface TelegramButtonsContent {
    rows: TelegramButton[][];
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

/**
 * Parses the `fi.mau.telegram.buttons` field out of an event's (already-resolved) content.
 *
 * This is defensive: any malformed shape (missing/wrong-typed fields, non-array rows, etc.)
 * is tolerated by either downgrading the offending button to "unsupported" or, if the overall
 * shape is unusable, returning `null`. This function never throws.
 */
export function parseBridgeButtons(content: IContent | undefined | null): TelegramButtonsContent | null {
    try {
        const raw = content?.[TELEGRAM_BUTTONS_FIELD];
        if (!raw || typeof raw !== "object") return null;

        const rowsRaw = (raw as Record<string, unknown>)["rows"];
        if (!Array.isArray(rowsRaw)) return null;

        const rows: TelegramButton[][] = [];
        for (const rowRaw of rowsRaw) {
            if (!Array.isArray(rowRaw)) continue;

            const row: TelegramButton[] = [];
            for (const btnRaw of rowRaw) {
                if (!btnRaw || typeof btnRaw !== "object") continue;
                const btn = btnRaw as Record<string, unknown>;
                if (!isNonEmptyString(btn["text"])) continue;
                const text = btn["text"];

                if (btn["type"] === "callback" && isNonEmptyString(btn["command"])) {
                    row.push({ type: "callback", text, command: btn["command"] });
                } else if (btn["type"] === "url" && isNonEmptyString(btn["url"])) {
                    row.push({ type: "url", text, url: btn["url"] });
                } else {
                    // Unknown type, or a callback/url button missing its required field.
                    row.push({ type: "unsupported", text });
                }
            }
            if (row.length > 0) rows.push(row);
        }

        if (rows.length === 0) return null;
        return { rows };
    } catch {
        // Never let malformed bridge data break rendering.
        return null;
    }
}
