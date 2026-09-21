/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Things you might say, above the box you type in.
 *
 * When you open a chat where somebody is waiting on you, three replies in their language are drafted and
 * offered as pills; pressing one puts it in the composer, where it is yours to change or send. Nothing is
 * ever sent by pressing a pill, because a message sent by a machine in your name is a different thing
 * entirely.
 *
 * Asked once per message, not once per glance: the answer is kept against the id of the message it
 * replies to, so leaving a chat and coming back costs nothing. And only where a reply makes sense - the
 * newest message is somebody else's, and it is words rather than a picture - so the daily allowance is
 * spent on the chats that need it.
 */

import React, { type JSX, useEffect, useState } from "react";
import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { type AskMessage, ask, aiAvailable } from "../../../utils/ai/ask";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { TimelineRenderingType } from "../../../contexts/RoomContext";

/** How much of the chat a draft needs: the turn being replied to, not the year around it. */
const READ_BACK = 20;

/** Three at most, and each one short enough to be a message somebody would actually send. */
const MOST = 3;
const LONGEST = 240;

/** Drafts already asked for, by the message they reply to: a chat re-entered costs nothing. */
const known = new Map<string, string[]>();

/** The last message, if it is one worth drafting a reply to. */
function waitingOn(room: Room, me: string): MatrixEvent | undefined {
    const events = room.getLiveTimeline().getEvents();
    for (let at = events.length - 1; at >= 0; at--) {
        const event = events[at];
        if (event.getType() !== "m.room.message" || event.isRedacted()) continue;
        // Somebody else's words, waiting for an answer. Your own last message is not.
        if (event.getSender() === me) return undefined;
        return typeof event.getContent().body === "string" ? event : undefined;
    }
    return undefined;
}

/** The chat as the model is given it. */
function readable(room: Room): AskMessage[] {
    return room
        .getLiveTimeline()
        .getEvents()
        .slice(-READ_BACK)
        .filter((event) => event.getType() === "m.room.message" && typeof event.getContent().body === "string")
        .map((event) => ({
            id: event.getId()!,
            sender: event.sender?.name ?? event.getSender() ?? "?",
            body: String(event.getContent().body).slice(0, 600),
        }));
}

/**
 * Three drafts out of one answer.
 *
 * The model is asked for a line each, and writes them the way anybody writes a list: sometimes bulleted,
 * sometimes numbered, sometimes quoted. All of that is taken off, because what goes in the composer has
 * to be the message and nothing about the message.
 */
function drafts(answer: string): string[] {
    return answer
        .split("\n")
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .map((line) => line.replace(/^["'“”]|["'“”]$/g, "").trim())
        .filter((line) => line.length > 0 && line.length <= LONGEST)
        .slice(0, MOST);
}

interface Props {
    room: Room;
}

export function TgReplies({ room }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [lines, setLines] = useState<string[]>([]);
    const [used, setUsed] = useState<string>();

    useEffect(() => {
        if (!aiAvailable()) return;
        const to = waitingOn(room, client.getSafeUserId());
        const at = to?.getId();
        setUsed(undefined);
        setLines(at ? (known.get(at) ?? []) : []);
        if (!at || known.has(at)) return;

        let gone = false;
        // Kept before it is asked for, so two mounts of the same chat ask once.
        known.set(at, []);
        void ask(client, { kind: "replies", messages: readable(room) })
            .then((answer) => {
                const suggested = drafts(answer.answer);
                known.set(at, suggested);
                if (!gone) setLines(suggested);
            })
            .catch(() => {
                // A draft nobody asked for is not worth a word of complaint: there are simply no pills.
                known.delete(at);
            });
        return () => {
            gone = true;
        };
    }, [client, room]);

    if (!lines.length) return null;

    // Into the composer, never into the room: what is sent is still sent by a person pressing send.
    const put = (text: string): void => {
        setUsed(text);
        dis.dispatch<ComposerInsertPayload>({
            action: Action.ComposerInsert,
            text,
            timelineRenderingType: TimelineRenderingType.Room,
        });
    };

    return (
        <div className="mx_TgReplies" role="list" aria-label={_t("tg_layout|ai_replies")}>
            {lines.map((line) => (
                <AccessibleButton
                    key={line}
                    role="listitem"
                    kind="secondary"
                    className={`mx_TgReplies_pill${used === line ? " mx_TgReplies_pill_used" : ""}`}
                    onClick={() => put(line)}
                >
                    {line}
                </AccessibleButton>
            ))}
        </div>
    );
}
