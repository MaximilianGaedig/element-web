/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { ListenedVoiceMessages } from "./ListenedVoiceMessages";

const SINCE = "mx_voice_message_listened_since";

function event(id: string, sender: string, ts: number, sending = false): MatrixEvent {
    return {
        getId: () => id,
        getSender: () => sender,
        getTs: () => ts,
        isSending: () => sending,
    } as unknown as MatrixEvent;
}

describe("ListenedVoiceMessages", () => {
    beforeEach(() => {
        localStorage.clear();
        // The module keeps what it read; a fresh page would start empty.
        ListenedVoiceMessages.reset();
        localStorage.setItem(SINCE, "1000");
    });

    it("counts a message from somebody else, that arrived since this began, as unplayed", () => {
        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@them:x", 2000), "@me:x")).toBe(true);
    });

    it("does not count messages from before this began: there is no telling what was heard elsewhere", () => {
        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@them:x", 500), "@me:x")).toBe(false);
    });

    it("does not count my own messages, sent or still sending", () => {
        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@me:x", 2000), "@me:x")).toBe(false);
        expect(ListenedVoiceMessages.isUnplayed(event("$b", "@them:x", 2000, true), "@me:x")).toBe(false);
    });

    it("stops counting a message once it has been played, and tells listeners", () => {
        const listener = vi.fn();
        ListenedVoiceMessages.subscribe(listener);

        ListenedVoiceMessages.mark("$a");

        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@them:x", 2000), "@me:x")).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("remembers across a reload", () => {
        ListenedVoiceMessages.mark("$a");
        ListenedVoiceMessages.reset();

        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@them:x", 2000), "@me:x")).toBe(false);
    });

    it("starts counting from the first time it is asked", () => {
        localStorage.removeItem(SINCE);
        vi.spyOn(Date, "now").mockReturnValue(5000);

        expect(ListenedVoiceMessages.isUnplayed(event("$a", "@them:x", 4000), "@me:x")).toBe(false);
        expect(ListenedVoiceMessages.isUnplayed(event("$b", "@them:x", 6000), "@me:x")).toBe(true);
        expect(localStorage.getItem(SINCE)).toBe("5000");
    });

    it("keeps only the most recent two thousand", () => {
        for (let i = 0; i < 2002; i++) ListenedVoiceMessages.mark(`$${i}`);

        expect(ListenedVoiceMessages.isUnplayed(event("$0", "@them:x", 2000), "@me:x")).toBe(true);
        expect(ListenedVoiceMessages.isUnplayed(event("$2001", "@them:x", 2000), "@me:x")).toBe(false);
    });
});
