/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { act, render, waitFor } from "test-utils-rtl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubClient } from "test-utils";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { PersonCardMenu } from "./PersonCardMenu";
import * as menuModule from "./PersonMenu";
import * as peopleModule from "../../../utils/contacts/people";
import * as actionsModule from "../../../utils/contacts/actions";
import * as favouritesModule from "../../../utils/contacts/favourites";
import * as tagsModule from "../../../utils/contacts/tags";
import * as vcardModule from "../../../utils/contacts/vcard";
import ContentMessages from "../../../ContentMessages";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";
import { LINKS_EVENT_TYPE, type Person } from "../../../utils/contacts/people";

type MenuProps = React.ComponentProps<typeof menuModule.PersonMenu>;

const ada: Person = {
    id: "tel:+49170",
    name: "Ada Klein",
    accounts: [
        { network: "Signal", mxid: "@signal_ada:e", remoteId: "ada", keys: ["tel:+49170"], roomId: "!sig:e" },
        { network: "WhatsApp", mxid: "@wa_ada:e", remoteId: "49170", keys: ["tel:+49170"] },
    ],
    keys: ["tel:+49170"],
    rooms: ["!sig:e"],
    saved: false,
    details: [],
};
const bob: Person = { ...ada, id: "@tg_bob:e", name: "Bob", accounts: [{ ...ada.accounts[0], mxid: "@tg_bob:e" }] };

/*
 * A card opened from a chat had no menu. This one is built for one person from what the client holds, and
 * has to do what the contacts list's menu does: these are the actions, each checked to reach what it names.
 */
describe("PersonCardMenu", () => {
    let client: MatrixClient;
    let held: { links?: string[][] };
    let menu: ReturnType<typeof vi.spyOn>;
    const onChanged = vi.fn();
    const props = (): MenuProps => menu.mock.calls.at(-1)![0] as MenuProps;

    beforeEach(() => {
        onChanged.mockClear();
        client = stubClient();
        held = { links: [["@signal_ada:e", "@other:e"]] };
        vi.spyOn(client, "getAccountData").mockImplementation(((type: string) =>
            type === LINKS_EVENT_TYPE ? { getContent: () => held } : undefined) as never);
        vi.spyOn(client, "setAccountData").mockImplementation((async (_type: string, next: object) => {
            held = next;
            return {};
        }) as never);
        vi.spyOn(client, "getIgnoredUsers").mockReturnValue(["@signal_ada:e"]);
        vi.spyOn(client, "setIgnoredUsers").mockResolvedValue({});
        vi.spyOn(peopleModule, "allPeople").mockResolvedValue([ada, bob]);
        menu = vi.spyOn(menuModule, "PersonMenu").mockImplementation(() => <div />);
    });

    it("says what is true of them: merged by the reader, and not blocked while one account still is not", () => {
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);
        expect(props().people).toEqual([ada]);
        expect(props().linked).toBe(true);
        // Only one of their two accounts is on the ignore list.
        expect(props().blocked).toBe(false);
    });

    it("reads who they could be merged with once the menu is opened, and not themselves", async () => {
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);
        expect(peopleModule.allPeople).not.toHaveBeenCalled();
        act(() => props().onOpenChange(true));
        await waitFor(() => expect(props().others).toEqual([bob]));
    });

    it("merges, separates and renames, and says so each time", async () => {
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);

        props().onMerge([ada]);
        expect(onChanged).not.toHaveBeenCalled();

        props().onMerge([ada, bob]);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(held.links![0]).toEqual(expect.arrayContaining(["@signal_ada:e", "@wa_ada:e", "@tg_bob:e"]));

        props().onSeparate(ada);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
        expect(held.links!.flat()).not.toContain("@signal_ada:e");

        props().onRename(ada, "Ada K");
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
        expect(peopleModule.chosenNames(client)["@signal_ada:e"]).toBe("Ada K");
    });

    it("blocks every account they have, and unblocks them all again", async () => {
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);
        props().onBlock!(ada, true);
        expect(client.setIgnoredUsers).toHaveBeenLastCalledWith(expect.arrayContaining(["@signal_ada:e", "@wa_ada:e"]));
        props().onBlock!(ada, false);
        expect(client.setIgnoredUsers).toHaveBeenLastCalledWith([]);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    });

    it("messages, calls, favours and files them the way the list's menu does", async () => {
        const message = vi.spyOn(actionsModule, "messagePerson").mockImplementation(() => {});
        const call = vi.spyOn(actionsModule, "callInRoom").mockImplementation(() => {});
        const favour = vi.spyOn(favouritesModule, "setFavourite").mockResolvedValue(undefined);
        const tag = vi.spyOn(tagsModule, "setInTag").mockResolvedValue(undefined);
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);

        props().onMessage(ada, "@wa_ada:e");
        expect(message).toHaveBeenCalledWith(client, ada, "@wa_ada:e");
        props().onCall(ada, "!sig:e", true);
        expect(call).toHaveBeenCalledWith("!sig:e", true);
        props().onFavourite([ada], true);
        expect(favour).toHaveBeenCalledWith(client, ["!sig:e"], true);
        props().onTag!({ id: "family", name: "Family", members: [] }, true);
        expect(tag).toHaveBeenCalledWith(client, "family", ada, true);
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
        // The card is already what is open.
        expect(props().onOpen(ada)).toBeUndefined();
    });

    it("hands them on as a vCard: out of the app, and into the chat that is open", async () => {
        const share = vi.spyOn(vcardModule, "shareVCard").mockResolvedValue(undefined);
        const send = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(ContentMessages, "sharedInstance").mockReturnValue({ sendContentToRoom: send } as never);
        const roomId = vi.spyOn(SDKContextClass.instance.roomViewStore, "getRoomId").mockReturnValue("!open:e");
        render(<PersonCardMenu client={client} person={ada} onChanged={onChanged} />);

        props().onExport!(ada);
        expect(share).toHaveBeenCalledWith("Ada Klein.vcf", expect.stringContaining("BEGIN:VCARD"));

        props().onSend!(ada);
        await waitFor(() => expect(send).toHaveBeenCalled());
        const [file, room] = send.mock.calls[0];
        expect((file as File).name).toBe("Ada Klein.vcf");
        expect(room).toBe("!open:e");

        // Nowhere to send it when no chat is open.
        roomId.mockReturnValue(null);
        send.mockClear();
        props().onSend!(ada);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(send).not.toHaveBeenCalled();
    });
});
