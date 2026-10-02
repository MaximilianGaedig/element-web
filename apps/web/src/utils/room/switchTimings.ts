/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * How long switching to a room takes, as the reader sees it: from the room being asked for to its
 * messages being on screen.
 *
 * "Is switching chats instant" was answered by feel. This says it in milliseconds, per switch and by how
 * the room was found - still mounted from before, mounted ahead of the click, or built from nothing -
 * so that a change meant to make it faster can be seen to have, and the slow case told from the fast.
 *
 * Import-free on purpose: it is called from the app's shell.
 */

/** How a room was found when it was switched to. */
export type SwitchKind = "kept" | "ahead" | "cold";

export interface SwitchTiming {
    roomId: string;
    kind: SwitchKind;
    /** From the room being asked for to the frame after its view was in front, in ms. */
    shown: number;
    /** From the room being asked for to the frame after a message of it was in the page, in ms. */
    messages?: number;
}

export interface SwitchSummary {
    switches: SwitchTiming[];
    /** The median for each kind of switch there has been: to its messages where known, else to its view. */
    median: Partial<Record<SwitchKind, number>>;
    line: string;
}

const KEEP = 50;
/** A room with nothing to show never gets a message; stop looking after this long. */
const GIVE_UP_MS = 5000;

const timings: SwitchTiming[] = [];
let asked: { roomId: string; at: number } | undefined;

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

/** After the next paint: two frames, since the first callback runs before the frame it is in is drawn. */
function afterPaint(then: () => void): void {
    if (typeof requestAnimationFrame === "undefined") {
        setTimeout(then, 0);
        return;
    }
    requestAnimationFrame(() => requestAnimationFrame(then));
}

/** The reader asked for this room: the clock starts here. */
export function switchAsked(roomId: string): void {
    asked = { roomId, at: now() };
}

function median(values: number[]): number | undefined {
    if (!values.length) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Whether a message of the room is in the page, inside the view that is in front. */
function hasMessage(root: ParentNode): boolean {
    return !!root.querySelector('.mx_RoomView_kept[data-active="true"] [data-event-id]');
}

/**
 * The room's view is in the page and in front. Called once the switch has been committed, with how the
 * room was found; records how long that took and then how long until a message of it is there.
 */
export function switchShown(roomId: string, kind: SwitchKind, root: ParentNode = document): void {
    // Shown without having been asked for through here (a reload into a room, a redirect): no clock.
    const started = asked?.roomId === roomId ? asked.at : undefined;
    asked = undefined;
    if (started === undefined) return;

    afterPaint(() => {
        const timing: SwitchTiming = { roomId, kind, shown: Math.round(now() - started) };
        timings.push(timing);
        if (timings.length > KEEP) timings.shift();

        if (hasMessage(root)) {
            timing.messages = timing.shown;
            return;
        }
        if (typeof MutationObserver === "undefined" || !("body" in root || "querySelector" in root)) return;
        const target = (root as Document).body ?? (root as Element);
        const observer = new MutationObserver(() => {
            if (!hasMessage(root)) return;
            observer.disconnect();
            clearTimeout(giveUp);
            afterPaint(() => (timing.messages = Math.round(now() - started)));
        });
        const giveUp = setTimeout(() => observer.disconnect(), GIVE_UP_MS);
        observer.observe(target, { childList: true, subtree: true });
    });
}

/** Every switch recorded, the median by kind, and one line that says it. */
export function switchTimings(): SwitchSummary {
    const kinds: SwitchKind[] = ["kept", "ahead", "cold"];
    const medians: Partial<Record<SwitchKind, number>> = {};
    for (const kind of kinds) {
        const value = median(timings.filter((one) => one.kind === kind).map((one) => one.messages ?? one.shown));
        if (value !== undefined) medians[kind] = Math.round(value);
    }
    const line =
        kinds
            .filter((kind) => medians[kind] !== undefined)
            .map((kind) => `${kind} ${medians[kind]} ms (${timings.filter((one) => one.kind === kind).length})`)
            .join(" | ") || "no switches yet";
    return { switches: [...timings], median: medians, line: `mx_switch: ${line}` };
}

/**
 * Forget what was recorded.
 * @knipignore - exported for tests
 */
export function resetSwitchTimings(): void {
    timings.length = 0;
    asked = undefined;
}
