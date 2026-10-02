/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Rooms made ready ahead of being opened.
 *
 * Going back to a room shown a moment ago is instant: it is still mounted, behind the one on screen, and
 * switching to it is a matter of which one is in front. A room opened for the first time has none of
 * that - its view is built, its timeline laid out and its tiles rendered after the click, and that is
 * what the reader waits for. Telegram does not make them wait, because it builds a chat before it is
 * asked for.
 *
 * So the rooms the reader is about to open are mounted behind the current one too, as the recently shown
 * ones are. Which rooms those are is said here, by whoever can tell: the room list, when the pointer
 * comes to rest on a room or a finger lands on one, and the rooms at the top of the list once the app
 * has nothing else to do.
 *
 * It holds room IDs and nothing else, so it can be imported from anywhere: what a room being "ahead"
 * amounts to is decided by the view that mounts them (LoggedInView).
 */

/** How many rooms are held ready ahead of the reader, besides the ones they have already shown. */
export const ROOMS_AHEAD = 2;

/**
 * The rooms held ready once this one is asked for: newest first, each once, and no more than the limit -
 * a room got ready and then not opened makes way for the next the reader points at.
 */
export function withAhead(ahead: readonly string[], roomId: string, limit = ROOMS_AHEAD): string[] {
    return [roomId, ...ahead.filter((one) => one !== roomId)].slice(0, limit);
}

/**
 * Whether getting rooms ready is worth what it costs just now.
 *
 * It is work done on a guess - a view built for a room that may never be opened - and a device that is
 * saving power, or a reader who asked for less to be sent, has said not to do work on guesses.
 */
export function mayPrepareRooms(): boolean {
    if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-low-power")) return false;
    const connection = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection;
    return !connection?.saveData;
}

type Listener = () => void;

class RoomsAhead {
    private rooms: readonly string[] = [];
    private readonly listeners = new Set<Listener>();

    /** The rooms held ready, newest first. The same array until it changes, so it can be compared. */
    public list(): readonly string[] {
        return this.rooms;
    }

    /** The reader is about to open this room, as far as anybody can tell. */
    public prepare(roomId: string): void {
        if (this.rooms[0] === roomId || !mayPrepareRooms()) return;
        this.set(withAhead(this.rooms, roomId));
    }

    /** This room no longer needs holding: it was opened, which keeps it mounted in its own right, or left. */
    public forget(roomId: string): void {
        if (!this.rooms.includes(roomId)) return;
        this.set(this.rooms.filter((one) => one !== roomId));
    }

    public clear(): void {
        if (this.rooms.length) this.set([]);
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private set(rooms: readonly string[]): void {
        this.rooms = rooms;
        // A copy, not the set: a listener may unsubscribe while being told.
        for (const listener of Array.from(this.listeners)) listener();
    }
}

export const roomsAhead = new RoomsAhead();
