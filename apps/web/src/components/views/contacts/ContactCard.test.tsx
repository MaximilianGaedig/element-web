/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ContactCard } from "./ContactCard";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { type Person } from "../../../utils/contacts/people";
import { type Call } from "../../../utils/contacts/calls";

const person = (over: Partial<Person> = {}): Person => ({
    id: "tel:+49170",
    name: "Ada Klein",
    accounts: [
        { network: "Signal", mxid: "@signal_ada:e", remoteId: "ada", keys: ["tel:+49170"], roomId: "!sig:e" },
        { network: "WhatsApp", mxid: "@wa_ada:e", remoteId: "49170", keys: ["tel:+49170"] },
    ],
    keys: ["tel:+49170"],
    rooms: ["!sig:e"],
    saved: true,
    details: [{ kind: "phone", value: "+49170" }],
    ...over,
});

describe("ContactCard", () => {
    /*
     * The way out of a wrong merge was offered only on accounts the reader had merged by hand, so an
     * account the client grouped by a shared number could not be removed at all.
     */
    it("offers to take out any account of a person who has more than one", async () => {
        const onUnlinkAccount = vi.fn();
        render(
            <ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onUnlinkAccount={onUnlinkAccount} />,
        );
        // Neither account is in linkedIds: both were grouped by their number.
        expect(screen.getByRole("button", { name: "Not the same person on Signal" })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Not the same person on WhatsApp" }));
        expect(onUnlinkAccount).toHaveBeenCalledWith("@wa_ada:e");
    });

    it("offers nothing to take out of a person with one account", () => {
        const one = person();
        render(
            <ContactCard
                person={{ ...one, accounts: one.accounts.slice(0, 1) }}
                onBack={() => {}}
                onMessage={() => {}}
                onUnlinkAccount={() => {}}
            />,
        );
        expect(screen.queryByRole("button", { name: /Not the same person/ })).toBeNull();
    });

    /* Two accounts on a card read as a network and a name each: not enough to know which one is wrong. */
    it("opens an account to show what it is and what tied it to this person", async () => {
        render(
            <ContactCard person={person()} onBack={() => {}} onMessage={() => {}} linkedIds={new Set(["@wa_ada:e"])} />,
        );
        expect(screen.queryByTestId("account-details")).toBeNull();

        const inspect = screen.getByRole("button", { name: "About this WhatsApp account" });
        await userEvent.click(inspect);

        const details = screen.getByTestId("account-details");
        expect(inspect).toHaveAttribute("aria-expanded", "true");
        expect(details).toHaveTextContent("ID on WhatsApp");
        expect(details).toHaveTextContent("49170");
        expect(details).toHaveTextContent("@wa_ada:e");
        expect(details).toHaveTextContent("it has the same +49170 as the Signal account");
        expect(details).toHaveTextContent("you merged it");
        expect(details).toHaveTextContent("No chat yet");

        // One at a time: opening the other closes this one.
        await userEvent.click(screen.getByRole("button", { name: "About this Signal account" }));
        expect(screen.getAllByTestId("account-details")).toHaveLength(1);
        expect(screen.getByTestId("account-details")).toHaveTextContent("You have a chat with this account");

        await userEvent.click(screen.getByRole("button", { name: "About this Signal account" }));
        expect(screen.queryByTestId("account-details")).toBeNull();
    });

    it("shows every kind of detail a network published, not only what could be matched", () => {
        render(
            <ContactCard
                person={person({
                    details: [
                        { kind: "phone", value: "+49170" },
                        { kind: "email", value: "ada@example.com" },
                        { kind: "handle", value: "@adaklein" },
                    ],
                })}
                onBack={() => {}}
                onMessage={() => {}}
            />,
        );
        expect(screen.getByText("+49170")).toBeInTheDocument();
        expect(screen.getByText("ada@example.com")).toBeInTheDocument();
        // The username: no use for matching, still a fact about the person.
        expect(screen.getByText("@adaklein")).toBeInTheDocument();
        expect(screen.getByText("Username")).toBeInTheDocument();
    });

    // The bridges carry a network's bio into the profile (MSC4440); the card shows it under the name.
    it("shows their bio from whichever account has one", async () => {
        vi.spyOn(MatrixClientPeg, "get").mockReturnValue({
            getExtendedProfile: async (mxid: string) =>
                mxid === person().accounts[1]?.mxid
                    ? { "gay.fomx.biography": { "m.text": [{ body: "Builds boats" }] } }
                    : {},
        } as unknown as MatrixClient);
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} />);
        expect(await screen.findByText("Builds boats")).toBeInTheDocument();
    });

    // The label was the raw key "action|message", which no catalogue has.
    // The card's calls were a label and a date; they are drawn as the calls tab draws them now.
    it("draws its calls as the calls tab does: the mark, how long, and missed ones marked", () => {
        const call = (over: Partial<Call>): Call => ({
            eventId: "$c",
            roomId: "!r:x",
            userId: "@a:x",
            name: "A",
            network: "Messenger",
            ts: Date.now(),
            outgoing: false,
            video: false,
            outcome: "answered",
            group: false,
            title: "A",
            ...over,
        });
        render(
            <ContactCard
                person={person()}
                onBack={() => {}}
                onMessage={() => {}}
                calls={[call({ eventId: "$1", outcome: "missed" }), call({ eventId: "$2", seconds: 125 })]}
            />,
        );

        expect(screen.getAllByRole("img", { name: "Missed" }).length).toBeGreaterThan(0);
        expect(screen.getByText(/2m 5s/)).toBeInTheDocument();
        expect(document.querySelector(".mx_ContactCard_call.mx_Contacts_row_missed")).not.toBeNull();
    });

    it("labels the message button in words", () => {
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} />);
        expect(screen.getByRole("button", { name: "Message" })).toBeInTheDocument();
        expect(screen.queryByText("action|message")).toBeNull();
    });

    it("shows the line a network uses to tell people of the same name apart", () => {
        const p = person();
        p.accounts[0].context = "Works at Acme";
        render(<ContactCard person={p} onBack={() => {}} onMessage={() => {}} />);
        expect(screen.getByText("Works at Acme")).toBeInTheDocument();
    });

    it("says which networks the person is on, which is why they are one row", () => {
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} />);
        expect(screen.getByRole("heading", { name: "Ada Klein" })).toBeInTheDocument();
        expect(screen.getByText("Signal")).toBeInTheDocument();
        expect(screen.getByText("WhatsApp")).toBeInTheDocument();
        // The number that made them one person, without its scheme.
        expect(screen.getByText("+49170")).toBeInTheDocument();
    });

    it("opens the chat on the network whose row was used", async () => {
        const onMessage = vi.fn();
        render(<ContactCard person={person()} onBack={() => {}} onMessage={onMessage} />);
        // The row itself, which starts with the network's name - not the controls beside it that mention it.
        await userEvent.click(screen.getByRole("button", { name: /^WhatsApp/ }));
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Klein" }), "@wa_ada:e");
    });

    it("offers no call where no chat exists to hold one", () => {
        const nowhere = person();
        // Per account, not per person: which chat is picked decides which network carries the call.
        for (const account of nowhere.accounts) delete account.roomId;
        render(<ContactCard person={nowhere} onBack={() => {}} onMessage={() => {}} onCall={vi.fn()} />);
        expect(screen.queryByRole("button", { name: "Call" })).not.toBeInTheDocument();
    });

    /*
     * The iOS question is not "call?" but "call on what?". Somebody reachable on three networks has three
     * ways to be called, and the menu is where that is chosen - one entry per chat that exists, because a
     * call placed in a chat is carried by that chat's bridge.
     */
    it("asks which network to call on", async () => {
        const p = person();
        p.accounts[1].roomId = "!wa:e";
        render(<ContactCard person={p} onBack={() => {}} onMessage={() => {}} onCall={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Call" }));
        expect(await screen.findByText("Voice call on Signal")).toBeInTheDocument();
        expect(screen.getByText("Video call on WhatsApp")).toBeInTheDocument();
    });

    it("calls in the chat that was chosen, not simply the first", async () => {
        const onCall = vi.fn();
        const p = person();
        p.accounts[1].roomId = "!wa:e";
        render(<ContactCard person={p} onBack={() => {}} onMessage={() => {}} onCall={onCall} />);

        await userEvent.click(screen.getByRole("button", { name: "Call" }));
        await userEvent.click(await screen.findByText("Video call on WhatsApp"));
        expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Klein" }), "!wa:e", true);
    });

    it("shows the name the reader gave them, with the network's own beneath it", () => {
        render(
            <ContactCard person={person()} onBack={() => {}} onMessage={() => {}} nickname="Mum" onRename={() => {}} />,
        );
        expect(screen.getByRole("heading", { name: "Mum" })).toBeInTheDocument();
        expect(screen.getByText("Ada Klein")).toBeInTheDocument();
    });

    it("renames on submit, and says nothing on cancel", async () => {
        const onRename = vi.fn();
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onRename={onRename} />);

        await userEvent.click(screen.getByRole("button", { name: "Rename" }));
        const field = screen.getByRole("textbox");
        await userEvent.clear(field);
        await userEvent.type(field, "Mum");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "tel:+49170" }), "Mum");

        onRename.mockClear();
        await userEvent.click(screen.getByRole("button", { name: "Rename" }));
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onRename).not.toHaveBeenCalled();
    });

    it("marks and unmarks a favourite, saying which it is", async () => {
        const onFavourite = vi.fn();
        const { rerender } = render(
            <ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onFavourite={onFavourite} />,
        );
        const add = screen.getByRole("button", { name: "Add to favourites" });
        expect(add).toHaveAttribute("aria-pressed", "false");
        await userEvent.click(add);
        expect(onFavourite).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Klein" }), true);

        rerender(
            <ContactCard
                person={person()}
                onBack={() => {}}
                onMessage={() => {}}
                favourite
                onFavourite={onFavourite}
            />,
        );
        const remove = screen.getByRole("button", { name: "Remove from favourites" });
        expect(remove).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(remove);
        expect(onFavourite).toHaveBeenLastCalledWith(expect.anything(), false);
    });

    /*
     * The editor is reachable, which it was not when it was first built: the whole form existed and
     * nothing on the card opened it, because Edit still only renamed the nickname.
     */
    it("opens the whole card from Edit, not just the name", async () => {
        const onCard = vi.fn();
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onCard={onCard} />);
        await userEvent.click(screen.getByRole("button", { name: "Edit contact" }));

        // A field that only the full editor has, rather than the one-line rename it used to open.
        expect(screen.getByLabelText("Company")).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText("Company"), "Vector");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onCard).toHaveBeenCalledWith(expect.objectContaining({ company: "Vector" }));
    });

    /*
     * Separating used to be a button on the card and another in the list. Both are gone: undoing a merge
     * is in the person's menu, as a destructive item, so it cannot be hit while reaching for anything else
     * - and the card shows that same menu rather than keeping its own copy of any of it.
     */
    it("keeps no actions of its own beside the menu it is given", () => {
        render(
            <ContactCard
                person={person()}
                onBack={() => {}}
                onMessage={() => {}}
                menu={<button type="button">Options</button>}
            />,
        );
        expect(screen.queryByRole("button", { name: "Separate" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Options" })).toBeInTheDocument();
    });
});
