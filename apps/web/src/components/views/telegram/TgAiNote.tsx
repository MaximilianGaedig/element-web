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

import React, { type JSX, useState } from "react";
import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import SendIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import GoodIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle";
import BadIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import SparkleIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { type AiNote, keepNote, removeNote, sendNote } from "../../../utils/ai/notes";
import { rate } from "../../../utils/ai/ask";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { AiText } from "../../../utils/ai/render";

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

/**
 * The messages that were sent, as they can still be seen.
 *
 * The note keeps the first and the last of them and how many there were, not the whole list: two hundred
 * ids per answer, forty answers to a room, is a quarter of a megabyte of account data to say something the
 * timeline already knows. So the range is resolved here, from what is loaded, and what cannot be found is
 * said as a number rather than quietly left out.
 */
function whatWasSent(room: Room | null, sent: NonNullable<AiNote["sent"]>): MatrixEvent[] {
    const events = room?.getLiveTimeline().getEvents() ?? [];
    const from = sent.first ? events.findIndex((event) => event.getId() === sent.first) : -1;
    const to = sent.last ? events.findIndex((event) => event.getId() === sent.last) : -1;
    if (from < 0 || to < from) return [];
    return events.slice(from, to + 1).filter((event) => event.getType() === "m.room.message");
}

/** How many of the sent messages the panel lists before it stops and says how many more there were. */
const LIST = 12;

export function TgAiNote({ client, roomId, note, streaming, onGone }: Props): JSX.Element {
    const [sent, setSent] = useState(false);
    const [showSent, setShowSent] = useState(false);
    const [verdict, setVerdict] = useState(note.verdict);
    const [busy, setBusy] = useState(false);
    const text = streaming ? streaming.text : note.answer;

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
                {!streaming && note.sent && (
                    <AccessibleButton
                        kind="link"
                        className="mx_TgAiNote_info"
                        aria-label={_t("tg_layout|ai_what_was_sent")}
                        aria-expanded={showSent}
                        title={_t("tg_layout|ai_what_was_sent")}
                        onClick={() => setShowSent(!showSent)}
                    >
                        <InfoIcon />
                    </AccessibleButton>
                )}
            </div>

            {streaming?.looking && (
                <p className="mx_TgAiNote_looking">
                    <SearchIcon />
                    {streaming.looking}
                </p>
            )}

            <AiText className="mx_TgAiNote_text" text={text} />

            {/*
                What left the device, behind the info button: the messages themselves, each one somewhere
                to go, and what the model went off to look at afterwards. An answer whose inputs you cannot
                see is an answer you have to take on trust - but it is also not what you are reading the
                chat for, so it is one press away rather than always underfoot.
            */}
            {showSent && note.sent && (
                <div className="mx_TgAiNote_sentPanel">
                    <p className="mx_TgAiNote_sentWhat">
                        {_t("tg_layout|ai_sent_messages", { count: note.sent.messages })}
                        {note.sent.pictures ? _t("tg_layout|ai_sent_pictures", { count: note.sent.pictures }) : null}
                        {note.sent.style ? _t("tg_layout|ai_sent_style", { count: note.sent.style }) : null}
                        {note.sent.looked?.length
                            ? _t("tg_layout|ai_sent_looked", { tools: note.sent.looked.join(", ") })
                            : null}
                        {note.sent.model
                            ? _t("tg_layout|ai_sent_by", {
                                  model: note.sent.model,
                                  seconds: ((note.sent.ms ?? 0) / 1000).toFixed(1),
                              })
                            : null}
                        {note.sent.asksLeft !== undefined
                            ? _t("tg_layout|ai_asks_left", { count: note.sent.asksLeft })
                            : null}
                    </p>
                    <ol className="mx_TgAiNote_sentList">
                        {whatWasSent(client.getRoom(roomId), note.sent)
                            .slice(0, LIST)
                            .map((event) => (
                                <li key={event.getId()}>
                                    <AccessibleButton
                                        kind="link"
                                        className="mx_TgAiNote_sentOne"
                                        onClick={() => jumpTo(event.getId()!)}
                                    >
                                        <span className="mx_TgAiNote_sentWho">
                                            {event.sender?.name ?? event.getSender()}
                                        </span>
                                        <span className="mx_TgAiNote_sentBody">{event.getContent().body}</span>
                                    </AccessibleButton>
                                </li>
                            ))}
                    </ol>
                    {note.sent.messages > LIST && (
                        <p className="mx_TgAiNote_sentWhat">
                            {_t("tg_layout|ai_sent_more", { count: note.sent.messages - LIST })}
                        </p>
                    )}
                </div>
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

            {/*
                Was it any good? One press either way, which lands as a reaction on this ask in your own
                log room - where the question, everything that was sent and the answer are sitting in a
                thread you can open. A bad answer can then be read rather than remembered as a mood.
            */}
            {!streaming && note.kept && (
                <div className="mx_TgAiNote_rate">
                    {(["good", "bad"] as const).map((which) => (
                        <AccessibleButton
                            key={which}
                            kind="link"
                            className={`mx_TgAiNote_verdict${verdict === which ? " mx_TgAiNote_verdict_chosen" : ""}${
                                which === "bad" ? " mx_TgAiNote_verdict_bad" : ""
                            }`}
                            aria-pressed={verdict === which}
                            aria-label={_t(which === "good" ? "tg_layout|ai_was_good" : "tg_layout|ai_was_bad")}
                            title={_t(which === "good" ? "tg_layout|ai_was_good" : "tg_layout|ai_was_bad")}
                            onClick={() => {
                                setVerdict(which);
                                void rate(client, note.kept!, which);
                                // Kept with the note as well, so the buttons still say so tomorrow.
                                void keepNote(client, roomId, { ...note, verdict: which });
                            }}
                        >
                            {which === "good" ? <GoodIcon /> : <BadIcon />}
                        </AccessibleButton>
                    ))}
                </div>
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
