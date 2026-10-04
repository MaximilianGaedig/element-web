/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LowPowerController from "./LowPowerController";
import { SettingLevel } from "../SettingLevel";
import { lowPower } from "../../utils/lowPower";

function prefersReducedMotion(reduced: boolean): void {
    vi.stubGlobal("window", { matchMedia: vi.fn().mockReturnValue({ matches: reduced }) });
}

describe("LowPowerController", () => {
    beforeEach(() => prefersReducedMotion(false));

    afterEach(() => {
        lowPower.reset();
        vi.unstubAllGlobals();
    });

    it("leaves the setting alone while power is not being saved", () => {
        const controller = new LowPowerController();
        expect(controller.getValueOverride(SettingLevel.DEVICE, "", true, SettingLevel.DEVICE)).toBeNull();
        expect(controller.settingDisabled).toBe(false);
    });

    it("turns the setting off and disables it while power is being saved", () => {
        lowPower.setMode("on");
        const controller = new LowPowerController();
        expect(controller.getValueOverride(SettingLevel.DEVICE, "", true, SettingLevel.DEVICE)).toBe(false);
        expect(controller.settingDisabled).toBe(true);
    });

    it("does not follow reduced motion unless asked to", () => {
        prefersReducedMotion(true);
        const controller = new LowPowerController();
        expect(controller.getValueOverride(SettingLevel.DEVICE, "", true, SettingLevel.DEVICE)).toBeNull();
        expect(controller.settingDisabled).toBe(false);
    });

    it("also follows reduced motion when asked to", () => {
        const controller = new LowPowerController(true);
        expect(controller.getValueOverride(SettingLevel.DEVICE, "", true, SettingLevel.DEVICE)).toBeNull();

        prefersReducedMotion(true);
        expect(controller.getValueOverride(SettingLevel.DEVICE, "", true, SettingLevel.DEVICE)).toBe(false);
        expect(controller.settingDisabled).toBe(true);
    });
});
