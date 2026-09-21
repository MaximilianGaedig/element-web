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
 * The drafting, the caching and the sampling of how you write are in utils/ai/replies.ts, because the
 * digest offers the same pills for the chats it says are waiting. This is the row itself, and it also
 * picks up a draft chosen over there, where there was no composer to put it in.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { repliesFor, repliesKnown, takeDraft } from "../../../utils/ai/replies";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { TimelineRenderingType } from "../../../contexts/RoomContext";

interface Props {
    room: Room;
}

export function TgReplies({ room }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [lines, setLines] = useState<string[]>([]);
    const [used, setUsed] = useState<string>();

    // Into the composer, never into the room: what is sent is still sent by a person pressing send.
    const put = useCallback((text: string): void => {
        setUsed(text);
        dis.dispatch<ComposerInsertPayload>({
            action: Action.ComposerInsert,
            text,
            timelineRenderingType: TimelineRenderingType.Room,
        });
    }, []);

    /*
     * Drafted for whatever the last message is now, and again whenever that changes.
     *
     * Once on opening the chat is not enough, twice over: a message that arrives while you are reading
     * needs its own drafts, and the ones this or another device has already written arrive as room
     * account data - which, on a fresh load, lands after the chat is on screen. Listening for both is
     * what makes the row appear when there is something to say and go when there is not.
     */
    useEffect(() => {
        let gone = false;
        const look = (): void => {
            setUsed(undefined);
            // What is already drafted shows at once; what is not is asked for.
            setLines(repliesKnown(client, room));
            void repliesFor(client, room).then((suggested) => {
                if (!gone) setLines(suggested);
            });
        };
        const onTimeline = (_event: MatrixEvent, inRoom?: Room): void => {
            if (inRoom?.roomId === room.roomId) look();
        };
        const onAccountData = (_event: MatrixEvent, inRoom: Room): void => {
            if (inRoom.roomId === room.roomId) look();
        };
        client.on(RoomEvent.Timeline, onTimeline);
        client.on(RoomEvent.AccountData, onAccountData);
        look();
        return () => {
            gone = true;
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(RoomEvent.AccountData, onAccountData);
        };
    }, [client, room]);

    /*
     * A draft chosen in the digest, where there was no composer to put it in: this is that composer, so
     * it lands here the moment the chat opens.
     */
    useEffect(() => {
        const draft = takeDraft(room.roomId);
        if (draft) put(draft);
    }, [room.roomId, put]);

    if (!lines.length) return null;

    return (
        <div className="mx_TgReplies" role="list" aria-label={_t("tg_layout|ai_replies")}>
            {lines.map((line) => (
                // Compound's own button, at its smallest: what a chip looks like in this app.
                <Button
                    key={line}
                    role="listitem"
                    kind="secondary"
                    size="md"
                    className={`mx_TgReplies_pill${used === line ? " mx_TgReplies_pill_used" : ""}`}
                    onClick={() => put(line)}
                >
                    {line}
                </Button>
            ))}
        </div>
    );
}
