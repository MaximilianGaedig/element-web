/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { haveRendererForEvent } from "../events/EventTileFactory";
import shouldHideEvent from "../shouldHideEvent";
import { stripPlainReply } from "./Reply";
import { getUserLanguage } from "../i18n/settings";

/**
 * Whether a message can be picked in selection mode: one that is drawn as its own row and has gone out.
 * Reactions, edits, delivery statuses and other hidden events have no row of their own, so a range
 * that took them in counted messages nobody could see.
 */
export function isSelectableEvent(ev: MatrixEvent, client: MatrixClient): boolean {
    if (ev.status !== null) return false; // still sending, or failed
    if (shouldHideEvent(ev)) return false;
    return haveRendererForEvent(ev, client, false);
}

/** The room's loaded events that can be picked, oldest first. */
export function selectableEventIds(room: Room, client: MatrixClient): string[] {
    return room
        .getUnfilteredTimelineSet()
        .getTimelines()
        .flatMap((timeline) => timeline.getEvents())
        .filter((ev) => isSelectableEvent(ev, client))
        .map((ev) => ev.getId()!);
}

/** The text a message contributes when copied, or nothing for one that has none (a call, a state change). */
function messageText(ev: MatrixEvent): string | undefined {
    const body = ev.getContent().body;
    if (typeof body !== "string" || !body.trim()) return undefined;
    return stripPlainReply(body).trim();
}

/**
 * The selected messages as text, the way Telegram Desktop copies them: one message alone is just its
 * text; several are one line each, oldest first, as `[date time] Name: text`. Messages without text
 * are left out.
 */
export function selectionAsText(room: Room, events: MatrixEvent[]): string {
    const lines = selectionLines(room, events);
    if (lines.length === 1) return lines[0].text;
    return lines.map(({ when, name, text }) => `[${when}] ${name}: ${text}`).join("\n");
}

/** The same as {@link selectionAsText}, as HTML: for pasting where formatting is kept (mail, documents). */
export function selectionAsHtml(room: Room, events: MatrixEvent[]): string {
    const lines = selectionLines(room, events);
    const html = (text: string): string => escapeHtml(text).replace(/\n/g, "<br>");
    if (lines.length === 1) return html(lines[0].text);
    return lines
        .map(({ when, name, text }) => `<p><b>${html(name)}</b> <i>[${html(when)}]</i><br>${html(text)}</p>`)
        .join("");
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The selected messages that have text, oldest first, with when and by whom. */
function selectionLines(room: Room, events: MatrixEvent[]): { when: string; name: string; text: string }[] {
    const locale = getUserLanguage();
    return events
        .map((ev) => ({ ev, text: messageText(ev) }))
        .filter((entry): entry is { ev: MatrixEvent; text: string } => !!entry.text)
        .sort((a, b) => a.ev.getTs() - b.ev.getTs())
        .map(({ ev, text }) => {
            const sender = ev.getSender() ?? "";
            return {
                when: new Date(ev.getTs()).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }),
                name: room.getMember(sender)?.name ?? sender,
                text,
            };
        });
}
