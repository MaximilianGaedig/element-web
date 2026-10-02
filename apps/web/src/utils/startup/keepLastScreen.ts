/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { buildOf, captureLastScreen, saveLastScreen } from "./lastScreen";

/** How often the screen is kept while the app is in front; leaving it keeps it at once as well. */
const KEEP_EVERY_MS = 90_000;

export interface ScreenSource {
    userId: string;
    /** Whether the room on screen right now is encrypted. */
    openRoomEncrypted: () => boolean;
}

/**
 * Keeps what is on screen for the next start to show (see lastScreen), for as long as the logged-in app
 * is up. Returns how to stop.
 *
 * Kept when the page is left - hidden, closed or reloaded - since that is the screen the reader will
 * expect back, and every so often while it is in front, since a page that is closed is not always given
 * the time to finish writing.
 */
export function keepLastScreen(source: ScreenSource, doc: Document = document): () => void {
    const keep = (): void => {
        try {
            const screen = captureLastScreen(doc, {
                userId: source.userId,
                build: buildOf(doc),
                openRoomEncrypted: source.openRoomEncrypted(),
            });
            // Nothing to keep is not a reason to forget the last one: a dialog over everything, say.
            if (screen) void saveLastScreen(screen).catch(() => undefined);
        } catch {
            // Keeping the screen is a courtesy to the next start. It must never get in this one's way.
        }
    };
    const whenIdle = (): void => {
        if (doc.visibilityState !== "visible") return;
        if (typeof requestIdleCallback === "function") requestIdleCallback(keep, { timeout: 5000 });
        else keep();
    };
    const onHidden = (): void => {
        if (doc.visibilityState === "hidden") keep();
    };

    const timer = setInterval(whenIdle, KEEP_EVERY_MS);
    doc.addEventListener("visibilitychange", onHidden);
    doc.defaultView?.addEventListener("pagehide", keep);
    return () => {
        clearInterval(timer);
        doc.removeEventListener("visibilitychange", onHidden);
        doc.defaultView?.removeEventListener("pagehide", keep);
    };
}
