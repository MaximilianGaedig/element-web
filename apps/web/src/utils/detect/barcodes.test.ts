/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BARCODES_KEPT, barcodeResultsKept, readBarcodesForEvent } from "./barcodes";

describe("reading the codes in pictures", () => {
    const detect = vi.fn();

    beforeEach(() => {
        detect.mockReset().mockResolvedValue([]);
        vi.stubGlobal(
            "BarcodeDetector",
            class {
                public detect = detect;
            },
        );
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close: vi.fn() }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads a picture once per event", async () => {
        await readBarcodesForEvent("$once", new Blob(["picture"]));
        await readBarcodesForEvent("$once", new Blob(["picture"]));

        expect(detect).toHaveBeenCalledTimes(1);
    });

    it("keeps what it found for the pictures seen lately, not for every picture of the session", async () => {
        for (let i = 0; i < BARCODES_KEPT * 3; i++) await readBarcodesForEvent(`$event${i}`, new Blob(["picture"]));

        expect(barcodeResultsKept()).toBe(BARCODES_KEPT);
    });
});
