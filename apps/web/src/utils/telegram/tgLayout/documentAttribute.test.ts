/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { holdDocumentAttribute } from "./documentAttribute";

const NAME = "data-test-tier";
const attr = (): string | null => document.documentElement.getAttribute(NAME);

describe("holdDocumentAttribute", () => {
    afterEach(() => document.documentElement.removeAttribute(NAME));

    it("sets the attribute and removes it when the last holder lets go", () => {
        const release = holdDocumentAttribute(NAME, "mobile");
        expect(attr()).toBe("mobile");
        release();
        expect(attr()).toBeNull();
    });

    it("keeps the attribute while another holder still wants it", () => {
        // React mounts the next instance before unmounting the last, so the two overlap.
        const first = holdDocumentAttribute(NAME, "mobile");
        const second = holdDocumentAttribute(NAME, "mobile");
        first();
        expect(attr()).toBe("mobile");
        second();
        expect(attr()).toBeNull();
    });

    it("takes the newest holder's value", () => {
        const mobile = holdDocumentAttribute(NAME, "mobile");
        const large = holdDocumentAttribute(NAME, "large");
        expect(attr()).toBe("large");
        mobile();
        expect(attr()).toBe("large");
        large();
    });

    it("holds the attribute absent for undefined, without disturbing the count", () => {
        const held = holdDocumentAttribute(NAME, "mobile");
        const off = holdDocumentAttribute(NAME, undefined);
        expect(attr()).toBeNull();
        off();
        expect(attr()).toBeNull();
        held();
        expect(attr()).toBeNull();
    });

    it("ignores a release called twice, so one holder cannot free another's", () => {
        const first = holdDocumentAttribute(NAME, "mobile");
        const second = holdDocumentAttribute(NAME, "mobile");
        first();
        first();
        expect(attr()).toBe("mobile");
        second();
        expect(attr()).toBeNull();
    });
});
