/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "test-utils-rtl";

import { TgVoiceHoldButton } from "./TgVoiceHoldButton";
import { HOLD_MS, LOCK_AFTER_INTERRUPTION_MS, RETOUCH_MS } from "../../../utils/telegram/voiceHold";

describe("<TgVoiceHoldButton />", () => {
    const onBegin = vi.fn();
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const onHoldChange = vi.fn();
    const onToggle = vi.fn();
    let recorded = 0;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.setSystemTime(1_000_000);
        onBegin.mockResolvedValue(true);
        recorded = 3000;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const open = (): { button: HTMLElement; composer: HTMLElement } => {
        const { container } = render(
            <div className="mx_MessageComposer">
                <TgVoiceHoldButton
                    onBegin={onBegin}
                    onSend={onSend}
                    onCancel={onCancel}
                    onHoldChange={onHoldChange}
                    recordedMs={() => recorded}
                    onToggle={onToggle}
                />
            </div>,
        );
        return { button: screen.getByTestId("tgrecordbtn"), composer: container.firstElementChild as HTMLElement };
    };

    const finger = (x: number, y: number): object => ({
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: y,
    });
    const down = (button: HTMLElement, x = 300, y = 600): boolean => fireEvent.pointerDown(button, finger(x, y));
    /** Finger down, and held long enough to be recording. */
    const hold = async (button: HTMLElement): Promise<void> => {
        down(button);
        await act(async () => {
            vi.advanceTimersByTime(HOLD_MS);
        });
    };
    const settle = (): Promise<void> => act(async () => {});

    it("says to hold when it is only tapped, and records nothing", () => {
        const { button } = open();

        down(button);
        act(() => {
            vi.advanceTimersByTime(HOLD_MS - 1);
        });
        fireEvent.pointerUp(button, finger(300, 600));

        expect(onBegin).not.toHaveBeenCalled();
        expect(screen.getByRole("status")).toHaveTextContent("Hold to record a voice message");
    });

    it("starts recording once held, and sends when the finger is let go", async () => {
        const { button } = open();

        await hold(button);
        expect(onBegin).toHaveBeenCalledTimes(1);
        expect(onHoldChange).toHaveBeenLastCalledWith("holding");

        fireEvent.pointerUp(button, finger(300, 600));
        await settle();

        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        expect(onHoldChange).toHaveBeenLastCalledWith(null);
    });

    it("throws away a recording too short to be meant, and says to hold", async () => {
        const { button } = open();
        recorded = 300;

        await hold(button);
        fireEvent.pointerUp(button, finger(300, 600));
        await settle();

        expect(onSend).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("draws how far the finger has gone onto the composer, and clears it when the hold ends", async () => {
        const { button, composer } = open();

        await hold(button);
        fireEvent.pointerMove(button, finger(240, 570));

        expect(composer.style.getPropertyValue("--tg-voice-dx")).toBe("-60px");
        expect(composer.style.getPropertyValue("--tg-voice-dy")).toBe("-30px");
        expect(composer.style.getPropertyValue("--tg-voice-cancelness")).toBe("0.4");
        expect(composer.style.getPropertyValue("--tg-voice-scale")).toBe("0.8");

        fireEvent.pointerUp(button, finger(300, 600));
        await settle();
        expect(composer.style.getPropertyValue("--tg-voice-dx")).toBe("");
    });

    it("cancels on the spot when slid far enough left, without waiting for the finger to lift", async () => {
        const { button } = open();

        await hold(button);
        fireEvent.pointerMove(button, finger(149, 600));
        await settle();

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSend).not.toHaveBeenCalled();
        expect(onHoldChange).toHaveBeenLastCalledWith(null);

        // The finger lifting afterwards does nothing more
        fireEvent.pointerUp(button, finger(149, 600));
        await settle();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("cancels when let go part of the way left", async () => {
        const { button } = open();

        await hold(button);
        fireEvent.pointerMove(button, finger(190, 600));
        fireEvent.pointerUp(button, finger(190, 600));
        await settle();

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSend).not.toHaveBeenCalled();
    });

    it("locks the recording on when slid up, and leaves it running", async () => {
        const { button } = open();

        await hold(button);
        fireEvent.pointerMove(button, finger(300, 489));
        await settle();

        expect(onHoldChange).toHaveBeenLastCalledWith("locked");
        expect(onSend).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("locks when let go part of the way up", async () => {
        const { button } = open();

        await hold(button);
        fireEvent.pointerMove(button, finger(300, 530));
        fireEvent.pointerUp(button, finger(300, 530));
        await settle();

        expect(onHoldChange).toHaveBeenLastCalledWith("locked");
    });

    it("sends when the finger drifts that far slowly instead", async () => {
        const { button } = open();

        await hold(button);
        vi.advanceTimersByTime(1000);
        fireEvent.pointerMove(button, finger(300, 600));
        vi.advanceTimersByTime(1000);
        fireEvent.pointerMove(button, finger(250, 600));
        fireEvent.pointerUp(button, finger(250, 600));
        await settle();

        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("takes a quick flick left for a cancel", async () => {
        const { button } = open();

        await hold(button);
        // Held still for a second, then 50px in a twentieth of one: 1000px a second
        vi.advanceTimersByTime(1000);
        fireEvent.pointerMove(button, finger(300, 600));
        vi.advanceTimersByTime(50);
        fireEvent.pointerMove(button, finger(250, 600));
        fireEvent.pointerUp(button, finger(250, 600));
        await settle();

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("locks, after a moment, a recording whose touch the system took away", async () => {
        const { button } = open();

        await hold(button);
        fireEvent.pointerCancel(button, finger(300, 600));
        expect(onHoldChange).toHaveBeenLastCalledWith("holding");

        await act(async () => {
            vi.advanceTimersByTime(LOCK_AFTER_INTERRUPTION_MS);
        });

        expect(onHoldChange).toHaveBeenLastCalledWith("locked");
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("ignores a second touch right after the first", async () => {
        const { button } = open();

        down(button);
        fireEvent.pointerUp(button, finger(300, 600));
        vi.setSystemTime(1_000_000 + RETOUCH_MS - 1);
        await hold(button);

        expect(onBegin).not.toHaveBeenCalled();
    });

    it("ends the hold quietly when the recording could not start", async () => {
        onBegin.mockResolvedValue(false);
        const { button } = open();

        await hold(button);
        fireEvent.pointerUp(button, finger(300, 600));
        await settle();

        expect(onSend).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
        expect(onHoldChange).toHaveBeenLastCalledWith(null);
    });

    it("starts or stops a recording on a click from a mouse or the keyboard, which cannot hold", () => {
        const { button } = open();

        fireEvent.pointerDown(button, { pointerId: 2, pointerType: "mouse", isPrimary: true });
        fireEvent.click(button);

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onBegin).not.toHaveBeenCalled();
    });

    it("does not also treat the click a touch ends in as a toggle", () => {
        const { button } = open();

        down(button);
        fireEvent.pointerUp(button, finger(300, 600));
        fireEvent.click(button);

        expect(onToggle).not.toHaveBeenCalled();
    });

    it("is marked as owning its touches, and keeps the browser's menu off a held finger", () => {
        const { button } = open();

        expect(button).toHaveAttribute("data-tg-holds-touch");
        expect(fireEvent.contextMenu(button)).toBe(false);
    });
});
