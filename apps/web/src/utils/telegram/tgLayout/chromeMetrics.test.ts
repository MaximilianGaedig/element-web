/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { setChromeMetric } from "./chromeMetrics";

describe("setChromeMetric", () => {
    let el: HTMLElement;
    beforeEach(() => {
        el = document.createElement("div");
    });

    it("writes the value the first time it is asked", () => {
        expect(setChromeMetric(el, "--tg-header-bottom", 56)).toBe(true);
        expect(el.style.getPropertyValue("--tg-header-bottom")).toBe("56px");
    });

    it("does not write again for the same value", () => {
        setChromeMetric(el, "--tg-header-bottom", 56);
        // A ResizeObserver fires for reasons that did not change this measurement; writing anyway
        // would move every message in the list for nothing.
        expect(setChromeMetric(el, "--tg-header-bottom", 56)).toBe(false);
    });

    it("ignores a change too small to see, which is what a rect produces constantly", () => {
        setChromeMetric(el, "--tg-header-bottom", 56);
        expect(setChromeMetric(el, "--tg-header-bottom", 56.4)).toBe(false);
        expect(setChromeMetric(el, "--tg-header-bottom", 55.5001)).toBe(false);
        expect(el.style.getPropertyValue("--tg-header-bottom")).toBe("56px");
    });

    it("writes a change big enough to matter", () => {
        setChromeMetric(el, "--tg-header-bottom", 56);
        expect(setChromeMetric(el, "--tg-header-bottom", 57)).toBe(true);
        expect(el.style.getPropertyValue("--tg-header-bottom")).toBe("57px");
    });

    it("rounds rather than truncating, so a measurement does not drift down", () => {
        setChromeMetric(el, "--tg-composer-block", 47.6);
        expect(el.style.getPropertyValue("--tg-composer-block")).toBe("48px");
    });

    it("keeps each property's own last value", () => {
        setChromeMetric(el, "--tg-header-bottom", 56);
        setChromeMetric(el, "--tg-composer-block", 48);
        expect(setChromeMetric(el, "--tg-header-bottom", 56)).toBe(false);
        expect(el.style.getPropertyValue("--tg-composer-block")).toBe("48px");
    });
});
