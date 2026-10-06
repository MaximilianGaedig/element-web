/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { stubClient } from "test-utils";
import { TgTranscript } from "./TgTranscript";

const storedMediaText = vi.fn();
const saveMediaText = vi.fn();
const transcribe = vi.fn();

vi.mock("../../../utils/detect/mediaText", () => ({ storedMediaText, saveMediaText }));
vi.mock("../../../utils/detect/transcribe", () => ({ transcribe }));
vi.mock("../../../utils/MediaEventHelper", () => ({
    MediaEventHelper: class {
        public sourceBlob = { value: Promise.resolve(new Blob(["audio"])) };
    },
}));

describe("<TgTranscript />", () => {
    const event = new MatrixEvent({ event_id: "$voice", room_id: "!room:example.org", type: "m.room.message" });

    beforeEach(() => {
        stubClient();
        storedMediaText.mockReset().mockResolvedValue({ transcript: "the old words" });
        saveMediaText.mockReset().mockResolvedValue(undefined);
        transcribe.mockReset().mockResolvedValue("the new words");
    });

    it("shows what the server already knows", async () => {
        render(<TgTranscript mxEvent={event} />);
        expect(await screen.findByText(/the old words/)).toBeInTheDocument();
    });

    it("works the words out again, replaces them, and tells the server", async () => {
        render(<TgTranscript mxEvent={event} />);
        await screen.findByText(/the old words/);

        await userEvent.click(screen.getByRole("button", { name: "Transcribe again" }));

        expect(await screen.findByText(/the new words/)).toBeInTheDocument();
        expect(screen.queryByText(/the old words/)).not.toBeInTheDocument();
        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(saveMediaText).toHaveBeenCalledWith(
            expect.anything(),
            "!room:example.org",
            "$voice",
            "transcript",
            "the new words",
        );
    });
});
