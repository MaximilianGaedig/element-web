/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The syntax highlighter is loaded ahead of a code block being drawn: arriving late, it re-wraps the
 * block after its row has been measured and the timeline jumps. It used to be loaded for every chat
 * opened, code or not - ~1 MB of script and what compiling it costs, in every session, for the few
 * chats that ever show code. Now it is loaded for a chat that has some.
 */

import type { MatrixEvent, Room } from "matrix-js-sdk/src/matrix";

/** How far back a chat is looked through for code when it is opened. */
const LOOK_BACK = 200;

/** Whether a message has a code block: `<pre>` in its formatted body, or a fence in its plain one. */
export function hasCodeBlock(event: MatrixEvent): boolean {
    const content = event.getContent();
    if (typeof content.formatted_body === "string" && content.formatted_body.includes("<pre")) return true;
    return typeof content.body === "string" && content.body.includes("```");
}

/** Whether the messages a chat has loaded at its end hold any code. */
export function roomHasCodeBlock(room: Room): boolean {
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= Math.max(0, events.length - LOOK_BACK); i--) {
        if (hasCodeBlock(events[i])) return true;
    }
    return false;
}

let loading: Promise<unknown> | undefined;

/** Starts loading the highlighter, once. */
export function preloadCodeHighlighter(): void {
    loading ??= import("highlight.js").catch(() => {
        loading = undefined;
    });
}
