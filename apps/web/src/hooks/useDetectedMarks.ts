/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a message is asking you to do, marked where it was written: the time somebody suggested, pressed
 * for a calendar entry; a phone number, for a call; an address, for a map; a flight or a parcel, for where
 * to follow it; a measurement in foreign units, with what it comes to.
 *
 * Marks only, nothing under the message. There used to be a row of chips repeating each phrase below the
 * bubble; the underline already says which words are live and is where a finger goes first, so the chips
 * were the same thing twice and made every message with a time in it a row taller.
 *
 * This runs on messages whoever sent them, including your own: what you wrote is as likely to be the
 * arrangement as what you were told. Detecting costs the parsers for fifteen languages and the world's
 * dialling codes, so it happens off the render: while the browser is idle, only for a message whose text
 * could possibly hold a number, and only once per message.
 */

import { type RefObject, useEffect } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { markEntities } from "../utils/detect/mark";
import { actOn } from "../utils/detect/act";
import { mightHold, whenIdle } from "../utils/detect/collect";
import { remember } from "../utils/detect/collected";
import { MatrixClientPeg } from "../MatrixClientPeg";

/**
 * Marks what `mxEvent` names in the rendered `bodyRef`, once the browser is idle. Off when `enabled` is
 * false, for a body drawn where nothing should be pressed (a reply preview, a pinned message).
 */
export function useDetectedMarks(mxEvent: MatrixEvent, bodyRef: RefObject<HTMLElement | null>, enabled = true): void {
    const body = mxEvent.getContent().body;
    const text = typeof body === "string" ? body : "";
    useEffect(() => {
        if (!enabled || !mightHold(text)) return;
        let cancelled = false;
        const cancelIdle = whenIdle(() => {
            void import("../utils/detect/entities").then(async ({ detectEntities }) => {
                const entities = await detectEntities(text);
                /*
                 * Also written down, where it can be looked at later. This message has been read anyway -
                 * that is what marked it - so the list of what the chats contain costs nothing extra for
                 * anything that has been on screen.
                 */
                void remember(MatrixClientPeg.safeGet().getSafeUserId(), mxEvent, entities);
                if (cancelled) return;
                // Marked where they were written, which is where a finger goes first.
                if (bodyRef?.current) markEntities(bodyRef.current, entities, (entity) => actOn(entity, text));
            });
        });
        return () => {
            cancelled = true;
            cancelIdle();
        };
    }, [text, bodyRef, mxEvent, enabled]);
}
