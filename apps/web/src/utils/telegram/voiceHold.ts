/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Recording a voice message by holding the microphone, as Telegram iOS does it: hold to record, let go to
 * send, slide left to cancel, slide up to lock the recording on so the finger can leave.
 *
 * The rules and every number here are Telegram iOS's (GPL-2.0, github.com/TelegramMessenger/Telegram-iOS):
 * the touch tracking of `submodules/LegacyComponents/Sources/TGModernConversationInputMicButton.m`, and
 * the hold delay of `ChatTextInputMediaRecordingButton.swift`. Points there are CSS pixels here.
 */

/** How long the button is held before recording starts. Let go sooner and it was a tap. */
export const HOLD_MS = 190;
/** A touch this soon after the last one is ignored: a double tap is not two recordings. */
export const RETOUCH_MS = 400;
/** Slid this far left, the recording is cancelled on the spot. */
export const CANCEL_AT = 150;
/** Let go this far left and it is cancelled; also where the finger is told it is about to be. */
export const CANCEL_ON_RELEASE_AT = 100;
/** Slid this far up, the recording locks on the spot. */
export const LOCK_AT = 110;
/** Let go this far up and it locks; also where the finger is told it is about to. */
export const LOCK_ON_RELEASE_AT = 60;
/** A flick this fast (pixels a second) left or up does what sliding the whole way would have. */
export const FLICK_SPEED = 400;
/** The lock closes over this much upward travel. */
export const LOCKNESS_TRAVEL = 105;
/** The button shrinks towards its smallest over this much leftward travel. */
export const SHRINK_TRAVEL = 300;
export const SMALLEST_SCALE = 0.4;
/** A touch the system takes away (a call, a permission prompt) locks the recording after this long. */
export const LOCK_AFTER_INTERRUPTION_MS = 1000;
/** A recording shorter than this was a slip of the finger: it is thrown away, not sent. */
export const SHORTEST_RECORDING_MS = 500;

export interface Drag {
    /** How far left of where the finger went down, as a negative number; never positive. */
    dx: number;
    /** How far up, as a negative number; never positive. */
    dy: number;
}

export type HoldOutcome = "send" | "cancel" | "lock";

/** Only leftward and upward travel counts: right and down do nothing. */
export function dragFrom(start: { x: number; y: number }, now: { x: number; y: number }): Drag {
    return { dx: Math.min(0, now.x - start.x), dy: Math.min(0, now.y - start.y) };
}

/** What a drag does while the finger is still down: it cancels or locks at the far thresholds. */
export function outcomeWhileDragging({ dx, dy }: Drag): "cancel" | "lock" | null {
    if (dx < -CANCEL_AT) return "cancel";
    if (dy < -LOCK_AT) return "lock";
    return null;
}

/**
 * What letting go does. The direction travelled furthest is the one that counts; a flick in it, or
 * having gone past the nearer threshold, cancels or locks, and anything else sends.
 */
export function outcomeOnRelease(drag: Drag, velocity: { x: number; y: number }): HoldOutcome {
    let { dx, dy } = drag;
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
    if (velocity.x < -FLICK_SPEED || dx < -CANCEL_ON_RELEASE_AT) return "cancel";
    if (velocity.y < -FLICK_SPEED || dy < -LOCK_ON_RELEASE_AT) return "lock";
    return "send";
}

/** How far closed the lock is, 0 to 1. */
export function locknessOf({ dy }: Drag): number {
    return Math.min(1, Math.abs(dy) / LOCKNESS_TRAVEL);
}

/** How large the button is drawn as it is slid towards cancelling, 1 down to the smallest. */
export function scaleOf({ dx }: Drag): number {
    return Math.max(SMALLEST_SCALE, Math.min(1, 1 - -dx / SHRINK_TRAVEL));
}

/** Whether the finger has reached the point where it is told what letting go will do. */
export function feedbackOf({ dx, dy }: Drag): { cancel: boolean; lock: boolean } {
    return { cancel: dx < -CANCEL_ON_RELEASE_AT, lock: dy < -LOCK_ON_RELEASE_AT };
}

/** The speed of a pointer, in pixels a second, from where it was a moment ago. */
export function velocityOf(samples: { x: number; y: number; t: number }[], windowMs = 100): { x: number; y: number } {
    const last = samples[samples.length - 1];
    if (!last) return { x: 0, y: 0 };
    const first = samples.find((sample) => last.t - sample.t <= windowMs) ?? last;
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}
