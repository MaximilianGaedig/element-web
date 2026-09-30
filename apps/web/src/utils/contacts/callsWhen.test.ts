/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { type Call, callsWhen } from "./calls";

const at = (iso: string): Call => ({ ts: new Date(iso).getTime() }) as Call;

describe("callsWhen", () => {
    const calls = [at("2026-03-04T09:30:00"), at("2026-03-04T21:05:00"), at("2026-03-05T09:30:00")];

    it("takes the whole day when the search named only a day", () => {
        expect(callsWhen(calls, new Date("2026-03-04T15:00:00"), false)).toHaveLength(2);
    });

    it("narrows to the hour when the search named a time as well", () => {
        expect(callsWhen(calls, new Date("2026-03-04T09:00:00"), true)).toHaveLength(1);
    });

    it("says nothing happened on a day nothing happened", () => {
        expect(callsWhen(calls, new Date("2026-03-06T10:00:00"), false)).toEqual([]);
    });
});
