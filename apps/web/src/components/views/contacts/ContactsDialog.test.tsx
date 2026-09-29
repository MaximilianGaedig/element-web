/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen, waitFor, type RenderResult } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ContactsDialog } from "./ContactsDialog";
import { type Call } from "../../../utils/contacts/calls";
import { type Person } from "../../../utils/contacts/people";
import * as peopleModule from "../../../utils/contacts/people";
import * as callsModule from "../../../utils/contacts/calls";
import * as favouritesModule from "../../../utils/contacts/favourites";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";

const member = { userId: "@ada:e", name: "Ada" };
const client = {
    getSafeUserId: () => "@me:e",
    getRoom: () => ({ getMember: () => member }),
    getAccountData: () => undefined,
    getVisibleRooms: () => [],
} as unknown as MatrixClient;

vi.mock("../../../contexts/MatrixClientContext", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useMatrixClientContext: () => client,
}));

const person = (name: string, saved = false): Person => ({
    id: name,
    name,
    accounts: [{ network: "Signal", mxid: `@${name}:e`, remoteId: name, keys: [], saved }],
    keys: [],
    rooms: [`!${name}:e`],
    saved,
});

const call = (over: Partial<Call> = {}): Call => ({
    eventId: "$call",
    roomId: "!room:e",
    userId: "@ada:e",
    name: "Ada",
    network: "Signal",
    ts: 1_700_000_000_000,
    outgoing: false,
    video: false,
    outcome: "missed",
    ...over,
});

const open = (): RenderResult => render(<ContactsDialog onFinished={() => {}} />);

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(peopleModule, "allPeople").mockResolvedValue([]);
    vi.spyOn(peopleModule, "manualLinks").mockReturnValue([]);
    vi.spyOn(peopleModule, "dismissedSuggestions").mockReturnValue([]);
    vi.spyOn(callsModule, "callHistory").mockReturnValue([]);
    vi.spyOn(favouritesModule, "favourites").mockReturnValue([]);
});

describe("ContactsDialog people", () => {
    it("files people under their initials and offers a letter for each section", async () => {
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Bob"), person("+49 170")]);
        open();

        await waitFor(() => expect(screen.getByRole("heading", { name: "A" })).toBeInTheDocument());
        const index = screen.getByRole("navigation", { name: "Jump to a letter" });
        // Exactly the sections that exist, in their order - no letter with nothing behind it.
        expect([...index.querySelectorAll("button")].map((one) => one.textContent)).toEqual(["A", "B", "#"]);
    });

    it("drops the letters while searching, because a ranked list has no alphabet", async () => {
        // Two names that both match one query and file under different letters: without the guard the
        // index would still have two letters to draw, so this is what proves searching removes it.
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada Klein"), person("Bo Adams")]);
        open();
        await waitFor(() => expect(screen.getByRole("navigation", { name: "Jump to a letter" })).toBeInTheDocument());

        await userEvent.type(screen.getByPlaceholderText("Search people"), "ada");
        expect(screen.getAllByText(/ada/i).length).toBeGreaterThan(1);
        expect(screen.queryByRole("navigation", { name: "Jump to a letter" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "A" })).not.toBeInTheDocument();
    });

    it("offers no index when everybody files under one letter", async () => {
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Alan")]);
        open();
        await waitFor(() => expect(screen.getByRole("heading", { name: "A" })).toBeInTheDocument());
        expect(screen.queryByRole("navigation", { name: "Jump to a letter" })).not.toBeInTheDocument();
    });
});

describe("ContactsDialog calls", () => {
    const openCalls = async (): Promise<void> => {
        open();
        await userEvent.click(screen.getByRole("tab", { name: "Calls" }));
    };

    it("puts the reader's favourites above the calls", async () => {
        vi.spyOn(favouritesModule, "favourites").mockReturnValue([{ roomId: "!fav:e", name: "Ada" }]);
        await openCalls();
        expect(screen.getByLabelText("Favourites")).toHaveTextContent("Ada");
    });

    it("shows the caller rather than the call when the info button is used", async () => {
        const dispatch = vi.spyOn(dis, "dispatch");
        vi.spyOn(callsModule, "callHistory").mockReturnValue([call()]);
        await openCalls();

        await userEvent.click(screen.getByRole("button", { name: "Show Ada" }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ action: Action.ViewUser, member }));
        // The room, but not that call highlighted: this asks who they are, not what happened.
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ action: Action.ViewRoom, room_id: "!room:e" }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ event_id: "$call" }));
    });

    it("narrows to callers no address book holds", async () => {
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada", true)]);
        vi.spyOn(callsModule, "callHistory").mockReturnValue([
            call({ userId: "@Ada:e", name: "Ada" }),
            call({ eventId: "$other", userId: "@zed:e", name: "Zed" }),
        ]);
        await openCalls();
        await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

        await userEvent.click(screen.getByRole("button", { name: "Not in contacts" }));
        expect(screen.queryByText("Ada")).not.toBeInTheDocument();
        expect(screen.getByText("Zed")).toBeInTheDocument();
    });

    it("says so when the filters leave nothing, rather than looking like no calls at all", async () => {
        vi.spyOn(callsModule, "callHistory").mockReturnValue([call({ outgoing: true, outcome: "answered" })]);
        await openCalls();
        await userEvent.click(screen.getByRole("button", { name: "Missed" }));
        expect(screen.getByText("No calls match")).toBeInTheDocument();
    });
});
