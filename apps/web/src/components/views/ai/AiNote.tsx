/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the model said, in the timeline where it was asked - and only you can see it.
 *
 * It is shaped like an incoming message and sits where one would, because a chat is read as a column of
 * bubbles and anything else in the middle of that column reads as an advert. What sets it apart is one
 * thing rather than a frame: a mark that says only you can see it, which is true - nobody else in the room
 * has it, and it survives a reload because it is kept as your own account data for the room.
 *
 * Everything you can do with it lives in one overflow menu, the way everything you can do with a pinned
 * message does (views/rooms/PinnedEventTile.tsx): send it to the others, see what was sent to get it, take
 * it away. A bubble carrying eight visible controls around two sentences of answer is a control panel, not
 * a message. What stays outside the menu is the one thing worth asking every time - was it any good - and
 * the sources, which are part of reading the answer rather than something to do with it.
 */

import React, { type JSX, useState } from "react";
import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import SendIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import OverflowIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import JumpIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-up-right";
import GoodIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle";
import BadIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import AiIcon from "@vector-im/compound-design-tokens/assets/web/icons/ai";

import { IconButton, Menu, MenuItem, Separator } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { type AiNote as Note, keepNote, removeNote, sendNote } from "../../../utils/ai/notes";
import { rate } from "../../../utils/ai/ask";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { AiText } from "../../../utils/ai/render";
import { AiSources } from "./AiSources";
import MessageEvent from "../messages/MessageEvent";

interface Props {
    client: MatrixClient;
    roomId: string;
    note: Note;
    /** While it is still being written: the words so far, and what it is looking at. */
    streaming?: { text: string; looking?: string };
    onGone?: (id: string) => void;
}

/**
 * The messages that were sent, as they can still be seen.
 *
 * The note keeps the first and the last of them and how many there were, not the whole list: two hundred
 * ids per answer, forty answers to a room, is a quarter of a megabyte of account data to say something the
 * timeline already knows. So the range is resolved here, from what is loaded - and what is no longer
 * loaded is said as a number rather than promised and not shown.
 */
function whatWasSent(room: Room | null, sent: NonNullable<Note["sent"]>): MatrixEvent[] {
    const events = room?.getLiveTimeline().getEvents() ?? [];
    const from = sent.first ? events.findIndex((event) => event.getId() === sent.first) : -1;
    const to = sent.last ? events.findIndex((event) => event.getId() === sent.last) : -1;
    if (from < 0 || to < from) return [];
    return events.slice(from, to + 1).filter((event) => event.getType() === "m.room.message");
}

/** How many of the sent messages the panel lists before it stops and says how many more there were. */
const LIST = 12;

export function AiNote({ client, roomId, note, streaming, onGone }: Props): JSX.Element {
    const [sent, setSent] = useState(false);
    const [showSent, setShowSent] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
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

    const say = (which: "good" | "bad"): void => {
        setVerdict(which);
        if (note.kept) void rate(client, note.kept, which);
        // Kept with the note as well, so the buttons still say so tomorrow.
        void keepNote(client, roomId, { ...note, verdict: which });
    };

    /*
     * The messages that were actually found. The note says how many were sent; the timeline may since have
     * forgotten the older ones, so what is listed and what is missing are counted apart - "188 more" under
     * an empty list was this number standing in for one it is not.
     */
    const found = note.sent ? whatWasSent(client.getRoom(roomId), note.sent) : [];
    const listed = found.slice(0, LIST);
    const unlisted = (note.sent?.messages ?? 0) - listed.length;

    return (
        <div className={`mx_AiNote${streaming ? " mx_Ai_writing" : ""}`} data-private="">
            {note.question && <p className="mx_AiNote_question">{note.question}</p>}

            {streaming?.looking && <p className="mx_AiNote_looking">{streaming.looking}</p>}

            <AiText className="mx_Ai_prose mx_AiNote_text" text={text} />

            {!streaming && note.confident === false && <p className="mx_AiNote_unsure">{_t("ai|unsure")}</p>}

            {!streaming && <AiSources cites={note.cites} onJump={jumpTo} />}

            {/*
                The footer a message would have: who it is from, and what can be done with it. "Only you"
                is the whole of the first part, because that is the one thing about this bubble that is not
                obvious from looking at it.
            */}
            {!streaming && (
                <div className="mx_AiNote_footer">
                    <AiIcon className="mx_Ai_mark" />
                    <span className="mx_AiNote_only">{_t("ai|only_you")}</span>

                    {/* Was it any good? One press either way, landing as a reaction on this ask in your
                        own log room, where the question, everything that was sent and the answer are
                        sitting in a thread you can open. Outside the menu because it is the only thing
                        here that has to be asked every time to be worth anything. */}
                    {note.kept &&
                        (["good", "bad"] as const).map((which) => (
                            <IconButton
                                key={which}
                                size="24px"
                                className={`mx_AiNote_verdict${verdict === which ? " mx_AiNote_verdict_chosen" : ""}`}
                                aria-pressed={verdict === which}
                                aria-label={_t(which === "good" ? "ai|was_good" : "ai|was_bad")}
                                title={_t(which === "good" ? "ai|was_good" : "ai|was_bad")}
                                onClick={() => say(which)}
                            >
                                {which === "good" ? <GoodIcon /> : <BadIcon />}
                            </IconButton>
                        ))}

                    <Menu
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        title={_t("ai|what_can_be_done")}
                        showTitle={false}
                        align="end"
                        trigger={
                            <IconButton size="24px" aria-label={_t("common|options")} disabled={busy}>
                                <OverflowIcon />
                            </IconButton>
                        }
                    >
                        <MenuItem
                            Icon={SendIcon}
                            label={sent ? _t("ai|sent") : _t("ai|send")}
                            disabled={busy || sent}
                            onSelect={() => void send()}
                        />
                        {note.sent && (
                            <MenuItem
                                Icon={InfoIcon}
                                label={_t("ai|what_was_sent")}
                                onSelect={(event) => {
                                    // Kept open would put a panel behind a menu; this is the panel's switch.
                                    event.preventDefault();
                                    setShowSent(!showSent);
                                    setMenuOpen(false);
                                }}
                            />
                        )}
                        <Separator />
                        <MenuItem
                            kind="critical"
                            Icon={DeleteIcon}
                            label={_t("action|remove")}
                            disabled={busy}
                            onSelect={() => void remove()}
                        />
                    </Menu>
                </div>
            )}

            {/*
                What left the device: the messages themselves, each one somewhere to go, and what the model
                went off to look at afterwards. An answer whose inputs you cannot see is an answer you have
                to take on trust - but it is not what you are reading the chat for, so it is behind the menu
                rather than always underfoot.
            */}
            {showSent && note.sent && (
                <div className="mx_AiNote_sentPanel">
                    <p className="mx_AiNote_sentWhat">
                        {_t("ai|sent_messages", { count: note.sent.messages })}
                        {note.sent.pictures ? _t("ai|sent_pictures", { count: note.sent.pictures }) : null}
                        {note.sent.style ? _t("ai|sent_style", { count: note.sent.style }) : null}
                        {note.sent.looked?.length ? _t("ai|sent_looked", { tools: note.sent.looked.join(", ") }) : null}
                        {note.sent.model
                            ? _t("ai|sent_by", {
                                  model: note.sent.model,
                                  seconds: ((note.sent.ms ?? 0) / 1000).toFixed(1),
                              })
                            : null}
                        {note.sent.asksLeft !== undefined ? _t("ai|asks_left", { count: note.sent.asksLeft }) : null}
                    </p>
                    <ol className="mx_AiNote_sentList">
                        {listed.map((event) => (
                            <li key={event.getId()} className="mx_AiNote_sentOne">
                                <span className="mx_AiNote_sentWho">{event.sender?.name ?? event.getSender()}</span>
                                {/*
                                    The message as the app draws it anywhere else: the same renderer the
                                    timeline uses, so a reply looks like a reply, a picture is the picture
                                    and formatting is formatting. Written out by hand here it was the body
                                    string in a span - which is neither what was on the screen nor, for a
                                    picture read by the device, what was actually sent to the model.
                                    Interaction is inhibited because this is a record of what was sent, not
                                    a second place to use the chat.
                                */}
                                <div className="mx_AiNote_sentBody">
                                    <MessageEvent mxEvent={event} inhibitInteraction />
                                </div>
                                <IconButton
                                    size="20px"
                                    aria-label={_t("ai|go_to_message")}
                                    onClick={() => jumpTo(event.getId()!)}
                                >
                                    <JumpIcon />
                                </IconButton>
                            </li>
                        ))}
                    </ol>
                    {unlisted > 0 && <p className="mx_AiNote_sentWhat">{_t("ai|sent_more", { count: unlisted })}</p>}
                </div>
            )}
        </div>
    );
}
