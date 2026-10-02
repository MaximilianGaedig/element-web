/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { IconButton } from "@vector-im/compound-web";
import OverflowIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";

import { _t } from "../../../languageHandler";
import { PersonMenu } from "./PersonMenu";
import {
    type Person,
    accountId,
    accountsOf,
    allPeople,
    linkAccounts,
    manualLinks,
    namePerson,
    unlinkAccounts,
} from "../../../utils/contacts/people";
import { callInRoom, messagePerson } from "../../../utils/contacts/actions";
import { isFavourite, setFavourite } from "../../../utils/contacts/favourites";
import { contactTags, setInTag } from "../../../utils/contacts/tags";
import { cardFor } from "../../../utils/contacts/card";
import { cardForExport, shareVCard, toVCard } from "../../../utils/contacts/vcard";

interface Props {
    client: MatrixClient;
    person: Person;
    /** Called once a change to them has been written, so whoever holds the person reads them again. */
    onChanged: () => void;
}

/**
 * The person menu for a card shown on its own - opened from a chat's member list, say - with everything
 * the contacts list's menu does.
 *
 * The contacts list builds its menu out of state it already holds (who else is in the list, who is picked).
 * A card opened anywhere else had no menu at all, so merging somebody with their other account, blocking
 * them or putting them in a list meant leaving the chat, finding them again among the contacts and doing
 * it there. This reads what the menu needs for one person and nothing more.
 */
export function PersonCardMenu({ client, person, onChanged }: Props): JSX.Element {
    const [open, setOpen] = useState(false);
    /* Who they could be merged with. Read when the menu first opens: it is the whole list of people. */
    const [others, setOthers] = useState<Person[]>([]);
    useEffect(() => {
        if (!open) return;
        let alive = true;
        void allPeople(client, { ask: false })
            .then((people) => alive && setOthers(people.filter((one) => one.id !== person.id)))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [client, open, person.id]);

    const linked = new Set(manualLinks(client).flat());
    const ignored = new Set(client.getIgnoredUsers());
    const theirs = person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);

    return (
        <PersonMenu
            client={client}
            people={[person]}
            others={others}
            favourited={isFavourite(client, person.rooms)}
            linked={person.accounts.some((account) => linked.has(accountId(account)))}
            blocked={!!theirs.length && theirs.every((mxid) => ignored.has(mxid))}
            open={open}
            onOpenChange={setOpen}
            onMessage={(who, mxid) => messagePerson(client, who, mxid)}
            onCall={(_who, roomId, video) => callInRoom(roomId, video)}
            onMerge={(people) => {
                if (people.length < 2) return;
                void linkAccounts(client, accountsOf(people)).then(onChanged);
            }}
            onSeparate={(who) => void unlinkAccounts(client, accountsOf([who])).then(onChanged)}
            onRename={(who, name) => void namePerson(client, who, name).then(onChanged)}
            onFavourite={(people, on) =>
                void setFavourite(
                    client,
                    people.flatMap((one) => one.rooms),
                    on,
                ).then(onChanged)
            }
            // The card is what is open already.
            onOpen={() => undefined}
            onBlock={(who, blocked) => {
                // Every account they have: blocking one would leave the same human on the next network along.
                const next = new Set(client.getIgnoredUsers());
                for (const account of who.accounts) {
                    if (!account.mxid) continue;
                    if (blocked) next.add(account.mxid);
                    else next.delete(account.mxid);
                }
                void client.setIgnoredUsers([...next]).then(onChanged);
            }}
            onExport={(who) => void shareVCard(`${who.name}.vcf`, toVCard(cardForExport(who, cardFor(client, who))))}
            onSend={(who) => {
                const text = toVCard(cardForExport(who, cardFor(client, who)));
                const file = new File([text], `${who.name}.vcf`, { type: "text/vcard" });
                // Loaded when used: the uploader and the stores are large modules, and a card that is only
                // being shown should not pull them in - nor sit in an import cycle with them at startup.
                void Promise.all([
                    import("../../../ContentMessages"),
                    import("../../../contexts/SDKContextClass.ts"),
                ]).then(([{ default: ContentMessages }, { SDKContextClass }]) => {
                    const roomId = SDKContextClass.instance.roomViewStore.getRoomId();
                    if (!roomId) return;
                    return ContentMessages.sharedInstance().sendContentToRoom(
                        file,
                        roomId,
                        undefined,
                        client,
                        undefined,
                    );
                });
            }}
            tags={contactTags(client)}
            onTag={(tag, member) => void setInTag(client, tag.id, person, member).then(onChanged)}
            trigger={
                // Always there, as the card's other header buttons are: the list's own menu control hides
                // until its row is pointed at, and a card has no row to point at.
                <IconButton size="32px" aria-label={_t("common|options")}>
                    <OverflowIcon />
                </IconButton>
            }
        />
    );
}
