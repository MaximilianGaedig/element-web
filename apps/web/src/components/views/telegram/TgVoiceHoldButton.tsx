/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { ChevronUpIcon, LockSolidIcon, MicOnSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { haptic } from "../../../utils/haptics";
import {
    CANCEL_AT,
    type Drag,
    dragFrom,
    feedbackOf,
    HOLD_MS,
    type HoldOutcome,
    LOCK_AFTER_INTERRUPTION_MS,
    locknessOf,
    outcomeOnRelease,
    outcomeWhileDragging,
    RETOUCH_MS,
    scaleOf,
    SHORTEST_RECORDING_MS,
    velocityOf,
} from "../../../utils/telegram/voiceHold";

/** How long "Hold to record" stays up after a tap. */
const HINT_MS = 2500;

/** Where the recording is in being held: under the finger, or locked on with the finger gone. */
export type VoiceHold = "holding" | "locked";

interface Props {
    /** Starts recording. Resolves to whether a recording is now running. */
    onBegin: () => Promise<boolean>;
    onSend: () => void;
    onCancel: () => void;
    /** Told as the hold starts, locks, and ends. */
    onHoldChange: (hold: VoiceHold | null) => void;
    /** How much has been recorded so far, in milliseconds. */
    recordedMs: () => number;
    /** A click from a mouse or the keyboard, which cannot hold: starts or stops a recording. */
    onToggle: () => void;
}

const NO_DRAG: Drag = { dx: 0, dy: 0 };
/** What the hold writes onto the composer for its styles to draw from. */
const DRAWN = ["--tg-voice-dx", "--tg-voice-dy", "--tg-voice-lockness", "--tg-voice-scale", "--tg-voice-cancelness"];

/**
 * The microphone, held to record as on Telegram iOS: hold it to record and let go to send, slide left
 * to cancel, slide up to lock the recording on. A tap says to hold. The rules are in utils/telegram/voiceHold.
 *
 * Marked `data-tg-holds-touch`: a touch that starts here is this button's for as long as it lasts, and
 * the chat's own gestures (swiping back, the long press that opens a menu) leave it alone.
 */
export function TgVoiceHoldButton({
    onBegin,
    onSend,
    onCancel,
    onHoldChange,
    recordedMs,
    onToggle,
}: Props): JSX.Element {
    const buttonRef = useRef<HTMLDivElement | null>(null);
    const [holding, setHolding] = useState(false);
    const [hint, setHint] = useState(false);

    /** One touch, from the finger going down to what it ended in. */
    const touch = useRef<{
        pointerId: number;
        start: { x: number; y: number };
        samples: { x: number; y: number; t: number }[];
        drag: Drag;
        holdTimer?: number;
        interruptedTimer?: number;
        /** The recording being started, once the hold was long enough to be one. */
        began?: Promise<boolean>;
        told: { cancel: boolean; lock: boolean };
    } | null>(null);
    const lastTouchAt = useRef(0);
    const lastPointerType = useRef("");
    const hintTimer = useRef<number | undefined>(undefined);

    // What the rest of the composer draws from: how far the finger has gone, on the composer itself.
    const draw = useCallback((drag: Drag | null): void => {
        const composer = buttonRef.current?.closest<HTMLElement>(".mx_MessageComposer");
        if (!composer) return;
        if (!drag) {
            for (const name of DRAWN) composer.style.removeProperty(name);
            return;
        }
        // How far towards cancelling, 0 to 1: what the "slide to cancel" label fades by.
        composer.style.setProperty("--tg-voice-cancelness", String(Math.min(1, -drag.dx / CANCEL_AT)));
        composer.style.setProperty("--tg-voice-dx", `${drag.dx}px`);
        composer.style.setProperty("--tg-voice-dy", `${drag.dy}px`);
        composer.style.setProperty("--tg-voice-lockness", String(locknessOf(drag)));
        composer.style.setProperty("--tg-voice-scale", String(scaleOf(drag)));
    }, []);

    const showHint = useCallback((): void => {
        setHint(true);
        window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(false), HINT_MS);
    }, []);

    const end = useCallback(
        async (outcome: HoldOutcome): Promise<void> => {
            const current = touch.current;
            if (!current) return;
            touch.current = null;
            window.clearTimeout(current.holdTimer);
            window.clearTimeout(current.interruptedTimer);
            buttonRef.current?.releasePointerCapture?.(current.pointerId);
            draw(null);
            setHolding(false);

            // The recording may still be starting (the first one asks for the microphone).
            const recording = await current.began;
            if (!recording) {
                onHoldChange(null);
                return;
            }
            if (outcome === "lock") {
                haptic("medium");
                onHoldChange("locked");
                return;
            }
            if (outcome === "send" && recordedMs() >= SHORTEST_RECORDING_MS) {
                onSend();
            } else {
                // Cancelled, or so short it was a slip of the finger: thrown away, and the tap explained.
                if (outcome === "send") showHint();
                else haptic("light");
                onCancel();
            }
            onHoldChange(null);
        },
        [draw, onCancel, onHoldChange, onSend, recordedMs, showHint],
    );

    const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>): void => {
        lastPointerType.current = ev.pointerType;
        if (ev.pointerType !== "touch" || !ev.isPrimary || touch.current) return;
        const now = Date.now();
        if (now - lastTouchAt.current < RETOUCH_MS) return;
        lastTouchAt.current = now;
        setHint(false);
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
        const start = { x: ev.clientX, y: ev.clientY };
        const current: NonNullable<typeof touch.current> = {
            pointerId: ev.pointerId,
            start,
            samples: [{ ...start, t: performance.now() }],
            drag: NO_DRAG,
            told: { cancel: false, lock: false },
        };
        current.holdTimer = window.setTimeout(() => {
            current.holdTimer = undefined;
            haptic("medium");
            setHolding(true);
            onHoldChange("holding");
            draw(current.drag);
            current.began = onBegin();
        }, HOLD_MS);
        touch.current = current;
    };

    const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>): void => {
        const current = touch.current;
        if (!current || ev.pointerId !== current.pointerId) return;
        current.samples.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
        if (current.samples.length > 20) current.samples.shift();
        current.drag = dragFrom(current.start, { x: ev.clientX, y: ev.clientY });
        if (!current.began) return;
        draw(current.drag);

        // A tick as the finger reaches the point where letting go cancels, or locks.
        const telling = feedbackOf(current.drag);
        if (telling.cancel && !current.told.cancel) haptic("light");
        if (telling.lock && !current.told.lock) haptic("light");
        current.told = telling;

        const outcome = outcomeWhileDragging(current.drag);
        if (outcome) void end(outcome);
    };

    const onPointerUp = (ev: React.PointerEvent<HTMLDivElement>): void => {
        const current = touch.current;
        if (!current || ev.pointerId !== current.pointerId) return;
        if (!current.began) {
            // Let go before it became a hold: a tap, which records nothing.
            window.clearTimeout(current.holdTimer);
            touch.current = null;
            buttonRef.current?.releasePointerCapture?.(current.pointerId);
            showHint();
            return;
        }
        void end(outcomeOnRelease(current.drag, velocityOf(current.samples)));
    };

    const onPointerCancel = (ev: React.PointerEvent<HTMLDivElement>): void => {
        const current = touch.current;
        if (!current || ev.pointerId !== current.pointerId) return;
        if (!current.began) {
            window.clearTimeout(current.holdTimer);
            touch.current = null;
            return;
        }
        // The system took the touch (a prompt, a call): the recording carries on, and locks.
        current.interruptedTimer = window.setTimeout(() => void end("lock"), LOCK_AFTER_INTERRUPTION_MS);
    };

    useEffect(
        () => () => {
            window.clearTimeout(hintTimer.current);
            window.clearTimeout(touch.current?.holdTimer);
            window.clearTimeout(touch.current?.interruptedTimer);
        },
        [],
    );

    return (
        <>
            {holding && (
                <span className="mx_TgVoiceHold_lock" aria-hidden="true">
                    <LockSolidIcon />
                    <ChevronUpIcon className="mx_TgVoiceHold_lockArrow" />
                </span>
            )}
            {hint && (
                <span className="mx_TgVoiceHold_hint" role="status">
                    {_t("tg_layout|voice_hold_hint")}
                </span>
            )}
            <AccessibleButton
                ref={buttonRef}
                className={`mx_TgSendButton mx_TgSendButton_record${holding ? " mx_TgSendButton_holding" : ""}`}
                // A finger holds; a mouse or the keyboard cannot, and starts or stops the recording instead.
                onClick={(): void => {
                    if (lastPointerType.current !== "touch") onToggle();
                    lastPointerType.current = "";
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onContextMenu={(ev: React.MouseEvent): void => ev.preventDefault()}
                title={_t("composer|voice_message_button")}
                data-testid="tgrecordbtn"
                data-tg-holds-touch=""
            >
                <span className="mx_TgSendButton_icon">
                    <MicOnSolidIcon />
                </span>
            </AccessibleButton>
        </>
    );
}
