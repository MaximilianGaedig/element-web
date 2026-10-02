/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, waitFor } from "test-utils-rtl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonCard } from "./PersonCard";
import * as contactCardModule from "./ContactCard";
import * as menuModule from "./PersonCardMenu";
import { LINKS_EVENT_TYPE, type Person } from "../../../utils/contacts/people";
import { stubClient } from "test-utils";

type CardProps = React.ComponentProps<typeof contactCardModule.ContactCard>;

const person: Person = {
    id: "tel:+49170",
    name: "Ada Klein",
    accounts: [
        { network: "Signal", mxid: "@signal_ada:e", remoteId: "ada", keys: ["tel:+49170"] },
        { network: "WhatsApp", mxid: "@wa_ada:e", remoteId: "49170", keys: ["tel:+49170"] },
    ],
    keys: ["tel:+49170"],
    rooms: [],
    saved: false,
    details: [],
};

/*
 * The card opened from a chat was handed no menu and no way of taking an account out, so it showed a
 * person's facts with none of the actions the same card has in the contacts list.
 */
describe("PersonCard shown on its own", () => {
    let card: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        card = vi.spyOn(contactCardModule, "ContactCard").mockImplementation(() => <div data-testid="card" />);
        vi.spyOn(menuModule, "PersonCardMenu").mockImplementation(() => <div data-testid="menu" />);
    });

    it("brings its own menu and its own way of taking an account out", async () => {
        const client = stubClient();
        let held: object = { links: [["@signal_ada:e", "@x:e"]] };
        vi.spyOn(client, "getAccountData").mockImplementation(((type: string) =>
            type === LINKS_EVENT_TYPE ? { getContent: () => held } : undefined) as never);
        vi.spyOn(client, "setAccountData").mockImplementation((async (_type: string, next: object) => {
            held = next;
            return {};
        }) as never);
        const onChanged = vi.fn();

        render(<PersonCard client={client} person={person} onChanged={onChanged} />);

        const props = card.mock.calls.at(-1)![0] as CardProps;
        // The accounts the reader merged, read here because nobody handed them in.
        expect([...props.linkedIds!]).toEqual(["@signal_ada:e", "@x:e"]);
        expect(React.isValidElement(props.menu)).toBe(true);
        expect((props.menu as React.ReactElement).type).toBe(menuModule.PersonCardMenu);

        props.onUnlinkAccount!("@wa_ada:e");
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(held).toMatchObject({ apart: ["@wa_ada:e"] });
    });

    it("uses what it is handed where the caller has its own", () => {
        const client = stubClient();
        const menu = <span>theirs</span>;
        const onUnlinkAccount = vi.fn();
        const linkedIds = new Set(["@only:e"]);
        render(
            <PersonCard
                client={client}
                person={person}
                onChanged={() => {}}
                menu={menu}
                onUnlinkAccount={onUnlinkAccount}
                linkedIds={linkedIds}
            />,
        );
        const props = card.mock.calls.at(-1)![0] as CardProps;
        expect(props.menu).toBe(menu);
        expect(props.linkedIds).toBe(linkedIds);
        props.onUnlinkAccount!("@wa_ada:e");
        expect(onUnlinkAccount).toHaveBeenCalledWith("@wa_ada:e");
    });
});
