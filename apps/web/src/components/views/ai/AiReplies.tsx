/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Things you might say, above the box you type in.
 *
 * When you open a chat where somebody is waiting on you, replies in their language are drafted and offered
 * as pills; pressing one puts it in the composer, where it is yours to change or send. Nothing is ever
 * sent by pressing a pill, because a message sent by a machine in your name is a different thing entirely.
 *
 * The drafting, the caching and the sampling of how you write are in utils/ai/replies.ts, because the
 * digest offers the same pills for the chats it says are waiting. This is the row itself, and it also
 * picks up a draft chosen over there, where there was no composer to put it in.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { repliesFor, repliesKnown, takeDraft, waitingOn } from "../../../utils/ai/replies";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ComposerInsertPayload } from "../../../dispatcher/payloads/ComposerInsertPayload";
import { TimelineRenderingType } from "../../../contexts/RoomContext";

/**
 * How long a burst of arriving messages is allowed to settle before anything is drafted.
 *
 * Backfill, a sync catching up and somebody typing three lines all arrive as a handful of events in a few
 * hundred milliseconds, and drafting for each of them in turn means asking about a message that is already
 * two messages old by the time the answer lands.
 */
const SETTLE_MS = 400;

interface Props {
    room: Room;
}

export function AiReplies({ room }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const [lines, setLines] = useState<string[]>([]);
    const [used, setUsed] = useState<string>();
    /** Whether what is on screen is being replaced: the old drafts stay, faded, until the new ones land. */
    const [stale, setStale] = useState(false);
    /**
     * The message the drafts answer.
     *
     * This, rather than "something happened in the room", is what decides whether anything needs drafting
     * again - and it is what everything here is keyed on. Listening to the timeline itself meant redrafting
     * on every receipt, every reaction, every message the reader sent themselves, each one an ask against
     * the day's allowance for drafts nobody had asked to be replaced.
     */
    const [anchor, setAnchor] = useState<string>();

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
     * Which message is waiting for an answer, recomputed when the room changes underneath.
     *
     * Cheap and local - it walks back over the loaded events - so it can run on anything the room reports,
     * and nothing is asked of the model unless what it finds is different from what is already drafted.
     */
    useEffect(() => {
        const me = client.getSafeUserId();
        let settle: number | undefined;
        const look = (): void => {
            window.clearTimeout(settle);
            settle = window.setTimeout(() => setAnchor(waitingOn(room, me)?.getId()), SETTLE_MS);
        };
        const inThisRoom = (_unused: unknown, where?: Room): void => {
            if (where?.roomId === room.roomId) look();
        };
        client.on(RoomEvent.Timeline, inThisRoom);
        // Drafts written by another device arrive here, and on a fresh load they land after the chat does.
        client.on(RoomEvent.AccountData, inThisRoom);
        setAnchor(waitingOn(room, me)?.getId());
        return () => {
            window.clearTimeout(settle);
            client.off(RoomEvent.Timeline, inThisRoom);
            client.off(RoomEvent.AccountData, inThisRoom);
        };
    }, [client, room]);

    /*
     * Drafts for that message: what is already known shows at once, and what is not is asked for.
     *
     * While it is being asked, what was already there stays where it is - a message arriving mid-
     * conversation used to empty the row and drop the composer up to meet your thumb, then push it back
     * down a second later. Old drafts, faded, until the new ones are ready to replace them.
     */
    useEffect(() => {
        if (!anchor) {
            setLines([]);
            setStale(false);
            return;
        }
        let gone = false;
        setUsed(undefined);
        const had = repliesKnown(client, room);
        if (had.length) setLines(had);
        setStale(!had.length);
        void repliesFor(client, room).then((suggested) => {
            if (gone) return;
            setLines(suggested);
            setStale(false);
        });
        return () => {
            gone = true;
        };
    }, [client, room, anchor]);

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
        <div
            className={`mx_AiReplies${stale ? " mx_AiReplies_stale" : ""}`}
            role="list"
            aria-busy={stale}
            aria-label={_t("ai|replies")}
        >
            {lines.map((line, at) => (
                // Element's own button, sized and clipped by the row, never repainted by it.
                <Button
                    key={`${at}:${line}`}
                    role="listitem"
                    kind="secondary"
                    size="md"
                    className={`mx_AiReplies_pill${used === line ? " mx_AiReplies_pill_used" : ""}`}
                    onClick={() => put(line)}
                >
                    <span className="mx_AiReplies_text">{line}</span>
                </Button>
            ))}
        </div>
    );
}
