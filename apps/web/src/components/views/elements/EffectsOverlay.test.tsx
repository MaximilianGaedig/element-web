/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, waitFor } from "test-utils-rtl";

import dis from "../../../dispatcher/dispatcher";
import EffectsOverlay from "./EffectsOverlay.tsx";

describe("<EffectsOverlay/>", () => {
    let isStarted: boolean;
    beforeEach(() => {
        isStarted = false;
        vi.doMock("../../../effects/confetti/index.ts", () => {
            return {
                default: class Confetti {
                    start = () => {
                        isStarted = true;
                    };
                    stop = vi.fn();
                },
            };
        });
    });

    afterEach(() => vi.useRealTimers());

    it("should render", () => {
        const { asFragment } = render(<EffectsOverlay getRoomWidth={() => 100} />);
        expect(asFragment()).toMatchSnapshot();
    });

    // Sized to the room all the time, every room kept open for switching held a full-room canvas.
    it("has no canvas to speak of until an effect plays, then the room's", async () => {
        const { container } = render(<EffectsOverlay getRoomWidth={() => 100} />);
        const canvas = container.querySelector("canvas")!;
        expect([canvas.width, canvas.height]).toEqual([0, 0]);

        dis.dispatch({ action: "effects.confetti" });

        await waitFor(() => expect(isStarted).toBe(true));
        expect(canvas.width).toBe(100);
        expect(canvas.height).toBeGreaterThan(0);
    });

    it("should start the confetti effect", async () => {
        render(<EffectsOverlay getRoomWidth={() => 100} />);
        dis.dispatch({ action: "effects.confetti" });
        await waitFor(() => expect(isStarted).toBe(true));
    });

    it("should start the confetti effect when the event is not outdated", async () => {
        const eventDate = new Date("2024-09-01");
        const date = new Date("2024-09-02");
        vi.setSystemTime(date);

        render(<EffectsOverlay getRoomWidth={() => 100} />);
        dis.dispatch({ action: "effects.confetti", event: { getTs: () => eventDate.getTime() } });
        await waitFor(() => expect(isStarted).toBe(true));
    });
});
