/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { EventStatus, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { pendingEventsToShow } from "./pendingEvents";

const event = (body: string, status: EventStatus): MatrixEvent =>
    ({ status, getContent: () => ({ body }) }) as unknown as MatrixEvent;

const bodies = (events: MatrixEvent[]): string[] => events.map((e) => e.getContent().body);

describe("pendingEventsToShow", () => {
    const sending = event("on its way", EventStatus.SENDING);
    const failed = event("never sent", EventStatus.NOT_SENT);
    const queued = event("waiting", EventStatus.QUEUED);

    it("shows everything in flight at the live end", () => {
        expect(bodies(pendingEventsToShow([sending, failed, queued], true))).toEqual([
            "on its way",
            "never sent",
            "waiting",
        ]);
    });

    /*
     * The bug: a gappy sync leaves the window able to paginate forwards while the reader believes they
     * are at the bottom, and upstream then shows no pending events at all - so messages that had failed
     * were nowhere on screen. They will never arrive by pagination; they are the reader's own text.
     */
    it("still shows what failed away from the live end", () => {
        expect(bodies(pendingEventsToShow([sending, failed, queued], false))).toEqual(["never sent"]);
    });

    it("keeps a message merely in flight out of a history view", () => {
        expect(pendingEventsToShow([sending], false)).toEqual([]);
        expect(pendingEventsToShow([queued], false)).toEqual([]);
    });

    it("copies rather than handing back the room's own list", () => {
        const pending = [sending];
        const shown = pendingEventsToShow(pending, true);
        shown.push(failed);
        expect(pending).toHaveLength(1);
    });
});
