/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import { type RoomMember } from "matrix-js-sdk/src/matrix";

import { whoIsTypingString } from "./WhoIsTyping";

describe("whoIsTypingString", () => {
    const m = (name: string): RoomMember => ({ name, userId: `@${name.toLowerCase()}:example.org` }) as RoomMember;
    const doing =
        (kinds: Record<string, string>) =>
        (member: RoomMember): any =>
            kinds[member.name] ?? "text";

    it("says who is typing", () => {
        expect(whoIsTypingString([], 3)).toBe("");
        expect(whoIsTypingString([m("Ada")], 3)).toBe("Ada is typing …");
        expect(whoIsTypingString([m("Ada"), m("Grace")], 3)).toBe("Ada and Grace are typing …");
        expect(whoIsTypingString([m("Ada"), m("Grace"), m("Linus"), m("Ken")], 3)).toBe(
            "Ada, Grace and 2 others are typing …",
        );
    });

    it.each([
        ["recording_voice", "Ada is recording a voice message …"],
        ["recording_video", "Ada is recording a video …"],
        ["uploading_photo", "Ada is sending a photo …"],
        ["uploading_video", "Ada is sending a video …"],
        ["uploading_file", "Ada is sending a file …"],
        ["uploading_voice", "Ada is sending a voice message …"],
        ["choosing_sticker", "Ada is choosing a sticker …"],
    ])("says what one person is doing: %s", (kind, expected) => {
        expect(whoIsTypingString([m("Ada")], 3, doing({ Ada: kind }))).toBe(expected);
    });

    it("leaves plain typing as it was", () => {
        expect(whoIsTypingString([m("Ada")], 3, doing({}))).toBe("Ada is typing …");
    });

    it("says several people are typing, whatever each is doing", () => {
        expect(whoIsTypingString([m("Ada"), m("Grace")], 3, doing({ Ada: "recording_voice" }))).toBe(
            "Ada and Grace are typing …",
        );
    });
});
