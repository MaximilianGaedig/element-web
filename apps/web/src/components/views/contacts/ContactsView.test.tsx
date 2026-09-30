/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { act, fireEvent, render, screen, waitFor, type RenderResult } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ContactsView } from "./ContactsView";
import { type Call } from "../../../utils/contacts/calls";
import { type Person } from "../../../utils/contacts/people";
import * as peopleModule from "../../../utils/contacts/people";
import * as callsModule from "../../../utils/contacts/calls";
import * as favouritesModule from "../../../utils/contacts/favourites";
import * as appearanceModule from "../../../utils/contacts/appearance";
import { clearSearch, setSearchQuery } from "../../../utils/panelSearch";
import dis from "../../../dispatcher/dispatcher";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { Action } from "../../../dispatcher/actions";

const member = { userId: "@ada:e", name: "Ada" };
const client = {
    getSafeUserId: () => "@me:e",
    // A room, with the state a room has: a stub without it only proves the client never reads it.
    getRoom: () => ({
        getMember: () => member,
        tags: {},
        currentState: { getStateEvents: () => [] },
        // A room, with the account data a room has: the card reads a ringtone off it.
        getAccountData: () => undefined,
    }),
    getAccountData: () => undefined,
    getVisibleRooms: () => [],
    // Presence is read per account, so a client without it is one the rows cannot be built from.
    getUser: () => null,
    // ...and kept live off the client's presence events, as the room list keeps its own.
    on: () => undefined,
    off: () => undefined,
    removeListener: () => undefined,
    // Blocking is the homeserver's ignore list, which the rows read to know whether somebody is on it.
    getIgnoredUsers: () => [],
    // A card asks the crypto whether it has checked who somebody is, and the server which rooms are shared.
    getCrypto: () => undefined,
    _unstable_getSharedRooms: async () => [],
} as unknown as MatrixClient;

const person = (name: string, saved = false): Person => ({
    id: name,
    name,
    accounts: [{ network: "Signal", mxid: `@${name}:e`, remoteId: name, keys: [], saved }],
    keys: [],
    rooms: [`!${name}:e`],
    saved,
    details: [],
});

const call = (over: Partial<Call> = {}): Call => ({
    // The row shows `title`, so a fixture that overrode only `name` made every call read as the same person.
    title: over.name ?? "Ada",
    eventId: "$call",
    roomId: "!room:e",
    userId: "@ada:e",
    name: "Ada",
    group: false,
    network: "Signal",
    ts: 1_700_000_000_000,
    outgoing: false,
    video: false,
    outcome: "missed",
    ...over,
});

/* The bar at the bottom of the column decides which list this is, so the test says which one too. */
const open = (tab: "people" | "calls" = "people"): RenderResult =>
    render(<ContactsView tab={tab} onFinished={() => {}} />);

beforeEach(() => {
    clearSearch();
    vi.restoreAllMocks();
    /*
     * The peg, as the dialog reads it. Stubbing MatrixClientContext instead is what let a null client
     * reach production: Modal gives a dialog no such provider, so that context is always null there,
     * and a test which stubs it proves the one thing the dialog never does.
     */
    vi.spyOn(MatrixClientPeg, "safeGet").mockReturnValue(client);
    vi.spyOn(peopleModule, "allPeople").mockResolvedValue([]);
    vi.spyOn(peopleModule, "manualLinks").mockReturnValue([]);
    vi.spyOn(peopleModule, "dismissedSuggestions").mockReturnValue([]);
    vi.spyOn(callsModule, "callHistory").mockReturnValue([]);
    vi.spyOn(favouritesModule, "favourites").mockReturnValue([]);
});

describe("ContactsView people", () => {
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

        // The search is the bar at the foot of the column, not a box in this screen, so it is set there.
        act(() => setSearchQuery("ada"));
        await waitFor(() => expect(screen.getAllByText(/ada/i).length).toBeGreaterThan(1));
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

describe("ContactsView filing names", () => {
    /*
     * The bug: a bridged contact is one display name and no card, and the list filed everyone by that whole
     * string - so choosing "sort by last name" changed nothing at all for almost every row in it.
     */
    it("files a bridged contact under their family name when that is the order", async () => {
        vi.spyOn(appearanceModule, "nameOrder").mockReturnValue("last");
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Aleksandra Kowalczyk")]);
        open();
        await waitFor(() => expect(screen.getByText("Aleksandra Kowalczyk")).toBeInTheDocument());

        // Filed under K, not A, while still being shown under the name the network gave.
        expect(screen.getByRole("heading", { name: "K" })).toBeInTheDocument();
    });

    it("files them under their first name in the other order", async () => {
        vi.spyOn(appearanceModule, "nameOrder").mockReturnValue("first");
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Aleksandra Kowalczyk")]);
        open();
        await waitFor(() => expect(screen.getByText("Aleksandra Kowalczyk")).toBeInTheDocument());
        expect(screen.getByRole("heading", { name: "A" })).toBeInTheDocument();
    });
});

describe("ContactsView keeping your place", () => {
    /*
     * Opening somebody and coming back used to return the reader to the top of the list: the card was
     * returned *instead of* the list, so the list unmounted, and a list that unmounts comes back scrolled
     * to A. The card is a layer over it now, and this checks the mechanism that makes that true - the very
     * same list element is still there underneath - because a scroll position cannot be measured in jsdom.
     */
    it("keeps the list mounted while a card is open", async () => {
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Bob")]);
        open();
        await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
        const list = document.querySelector(".mx_Contacts_list");

        await userEvent.click(screen.getByText("Ada"));
        // The card is up: its own header is in the layer over the list.
        expect(document.querySelector(".mx_Contacts_layer")).toBeInTheDocument();
        // The same list node, not a new one that happens to look the same.
        expect(document.querySelector(".mx_Contacts_list")).toBe(list);
        // And what it covers is out of reach rather than a second copy of every control.
        expect(document.querySelector(".mx_Contacts_under")).toHaveAttribute("inert");
    });
});

describe("ContactsView merging by hand", () => {
    /*
     * The merging that matters: only the identifiers some networks publish can put two accounts together on
     * their own, so the reader saying "these are the same person" is the rest of it. It happens in the row's
     * own menu now - it used to take the list away for a screen per step, then bring it back.
     */
    const menuFor = async (name: string): Promise<void> => {
        const row = screen.getByText(name).closest(".mx_Contacts_rowWith")!;
        fireEvent.contextMenu(row);
    };

    it("offers the other people to merge with, never the person themselves", async () => {
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Bob"), person("Cyd")]);
        open();
        await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

        await menuFor("Ada");
        await userEvent.click(await screen.findByRole("menuitem", { name: "Same person as…" }));

        expect(await screen.findByRole("menuitem", { name: "Bob" })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: "Cyd" })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: "Ada" })).not.toBeInTheDocument();
    });

    it("records both sides when one is chosen", async () => {
        const link = vi.spyOn(peopleModule, "linkAccounts").mockResolvedValue(undefined);
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Bob")]);
        open();
        await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

        await menuFor("Ada");
        await userEvent.click(await screen.findByRole("menuitem", { name: "Same person as…" }));
        await userEvent.click(await screen.findByRole("menuitem", { name: "Bob" }));

        expect(link).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["@Ada:e", "@Bob:e"]));
    });

    /*
     * Several at once, which is what a list of near-duplicates actually needs: picking them one pair at a
     * time was the same two-step answer repeated for every account the same person has.
     */
    it("merges everybody picked in one go", async () => {
        const link = vi.spyOn(peopleModule, "linkAccounts").mockResolvedValue(undefined);
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([person("Ada"), person("Bob"), person("Cyd")]);
        open();
        await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

        /*
         * Picking starts from the row's own menu, and from then on a press picks rather than opens - so the
         * second and third are one press each. A modifier press does the same without the menu.
         */
        await menuFor("Ada");
        await userEvent.click(await screen.findByRole("menuitem", { name: "Select" }));
        await userEvent.click(screen.getByText("Bob"));
        await userEvent.click(screen.getByText("Cyd"));
        expect(screen.getByText("3 selected")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Same person" }));
        expect(link).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["@Ada:e", "@Bob:e", "@Cyd:e"]));
    });
});

describe("ContactsView calls", () => {
    const openCalls = async (): Promise<void> => {
        open("calls");
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

        // The info button is gone: it sat on its own surface beside the row and did what the row did, so
        // who the caller is now lives in the row's menu with everything else that is not "open the call".
        fireEvent.contextMenu(screen.getByText("Ada").closest(".mx_Contacts_rowWith")!);
        await userEvent.click(await screen.findByRole("menuitem", { name: "Show Ada" }));
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

        await userEvent.click(screen.getByRole("tab", { name: "Not in contacts" }));
        expect(screen.queryByText("Ada")).not.toBeInTheDocument();
        expect(screen.getByText("Zed")).toBeInTheDocument();
    });

    it("says so when the filters leave nothing, rather than looking like no calls at all", async () => {
        vi.spyOn(callsModule, "callHistory").mockReturnValue([call({ outgoing: true, outcome: "answered" })]);
        await openCalls();
        await userEvent.click(screen.getByRole("tab", { name: "Missed" }));
        expect(screen.getByText("No calls match")).toBeInTheDocument();
    });
});
