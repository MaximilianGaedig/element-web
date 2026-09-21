/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the model said, in the timeline where it was asked - and only you can see it.
 *
 * It sits under the message it is about and it is shaped like one: the same bubble, the same place on the
 * page, so reading it is reading the chat rather than reading an advert in the middle of it. What sets it
 * apart is a sparkle and a line saying only you can see it - which is true: nobody else in the chat has
 * it, and it survives a reload because it is kept as your own account data for the room. Two things can be done with it and both are deliberate: send it to the others, which
 * writes an ordinary message that says where it came from, or take it away.
 *
 * While it is being written the words arrive as they are written and what the model is looking at is
 * said out loud - "searching your chats" - because a wait you can see the shape of is a shorter wait.
 */

import React, { type JSX, useMemo, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import SendIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { type AiNote, removeNote, sendNote } from "../../../utils/ai/notes";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import Markdown from "../../../Markdown";
import { bodyToHtml } from "../../../HtmlUtils";

interface Props {
    client: MatrixClient;
    roomId: string;
    note: AiNote;
    /** While it is still being written: the words so far, and what it is looking at. */
    streaming?: { text: string; looking?: string };
    onGone?: (id: string) => void;
}

/** What the model is doing, in words rather than a spinner. */
export function lookingWords(tool: string): string {
    switch (tool) {
        case "search_messages":
            return _t("tg_layout|ai_looking_messages");
        case "read_around":
            return _t("tg_layout|ai_looking_around");
        case "search_web":
            return _t("tg_layout|ai_looking_web");
        case "list_chats":
            return _t("tg_layout|ai_looking_chats");
        default:
            return _t("tg_layout|ai_thinking");
    }
}

export function TgAiNote({ client, roomId, note, streaming, onGone }: Props): JSX.Element {
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);
    const text = streaming ? streaming.text : note.answer;

    /*
     * Rendered the way a message is rendered: the model writes markdown - lists, emphasis, links - and
     * this is the app's own pipeline for turning that into something to look at, sanitiser and all.
     * Plain text stays plain, so a one-line answer does not go through a formatter to come out the same.
     */
    const html = useMemo(() => {
        if (!text) return undefined;
        const markdown = new Markdown(text);
        if (markdown.isPlainText()) return undefined;
        return bodyToHtml(
            {
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: markdown.toHTML({ externalLinks: true }),
            },
            undefined,
            { disableBigEmoji: true },
        );
    }, [text]);

    const jumpTo = (eventId: string): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: roomId,
            event_id: eventId,
            highlighted: true,
            metricsTrigger: undefined,
        });
    };

    const send = async (): Promise<void> => {
        setBusy(true);
        try {
            await sendNote(client, roomId, note);
            setSent(true);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (): Promise<void> => {
        setBusy(true);
        try {
            await removeNote(client, roomId, note.id);
            onGone?.(note.id);
        } finally {
            setBusy(false);
        }
    };

    // Web pages are cited as themselves; messages as ids, which become somewhere to jump to.
    const links = note.cites.filter((cite) => /^https?:\/\//.test(cite));
    const events = note.cites.filter((cite) => cite.startsWith("$"));

    return (
        <div className={`mx_TgAiNote${streaming ? " mx_TgAiNote_writing" : ""}`} data-private="">
            <div className="mx_TgAiNote_head">
                <SparkleIcon className="mx_TgAiNote_spark" />
                <span className="mx_TgAiNote_who">{_t("tg_layout|ai_only_you")}</span>
                {note.question && <span className="mx_TgAiNote_question">{note.question}</span>}
            </div>

            {streaming?.looking && (
                <p className="mx_TgAiNote_looking">
                    <SearchIcon />
                    {streaming.looking}
                </p>
            )}

            {html === undefined ? (
                <p className="mx_TgAiNote_text">{text}</p>
            ) : (
                // Sanitised by the same rules a message body is: see HtmlUtils.
                <div className="mx_TgAiNote_text" dangerouslySetInnerHTML={{ __html: html }} />
            )}

            {!streaming && note.confident === false && (
                <p className="mx_TgAiNote_unsure">{_t("tg_layout|ai_unsure")}</p>
            )}

            {!streaming && (events.length > 0 || links.length > 0) && (
                <p className="mx_TgAiNote_cites">
                    {events.map((eventId, index) => (
                        <AccessibleButton
                            key={eventId}
                            kind="link"
                            className="mx_TgAiNote_cite"
                            onClick={() => jumpTo(eventId)}
                        >
                            {_t("tg_layout|ai_cite", { number: index + 1 })}
                        </AccessibleButton>
                    ))}
                    {links.map((href) => (
                        <a
                            key={href}
                            className="mx_TgAiNote_cite"
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                        >
                            {new URL(href).host}
                        </a>
                    ))}
                </p>
            )}

            {!streaming && (
                <div className="mx_TgAiNote_actions">
                    <AccessibleButton
                        kind="primary_outline"
                        className="mx_TgAiNote_action"
                        disabled={busy || sent}
                        onClick={() => void send()}
                    >
                        <SendIcon />
                        {sent ? _t("tg_layout|ai_sent") : _t("tg_layout|ai_send")}
                    </AccessibleButton>
                    <AccessibleButton
                        kind="link"
                        className="mx_TgAiNote_action"
                        disabled={busy}
                        onClick={() => void remove()}
                    >
                        <DeleteIcon />
                        {_t("action|remove")}
                    </AccessibleButton>
                </div>
            )}
        </div>
    );
}
