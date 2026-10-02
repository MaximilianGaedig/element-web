/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import ReducedMotionController from "./ReducedMotionController";
import { type SettingLevel } from "../SettingLevel";
import { lowPower } from "../../utils/lowPower";

/**
 * For settings that spend power on show - media that plays by itself, effects over the timeline: off
 * while low-power mode is on (utils/lowPower), whatever they are set to, and back as they were after.
 *
 * It can also stand in for the reduced-motion controller on a setting that is both, since a setting takes
 * one controller: asked to, it turns the setting off for a reader who prefers reduced motion too.
 */
export default class LowPowerController extends ReducedMotionController {
    public constructor(private readonly alsoReducedMotion = false) {
        super();
    }

    public getValueOverride(
        level: SettingLevel,
        roomId: string,
        calculatedValue: any,
        calculatedAtLevel: SettingLevel | null,
    ): any {
        if (lowPower.isOn()) return false;
        return this.alsoReducedMotion
            ? super.getValueOverride(level, roomId, calculatedValue, calculatedAtLevel)
            : null; // no override
    }

    public get settingDisabled(): boolean {
        return lowPower.isOn() || (this.alsoReducedMotion && super.settingDisabled);
    }
}
