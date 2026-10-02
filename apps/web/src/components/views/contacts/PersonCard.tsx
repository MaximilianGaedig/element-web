/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useEffect, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ContactCard } from "./ContactCard";
import { PersonCardMenu } from "./PersonCardMenu";
import { type Person } from "../../../utils/contacts/people";
import { type Call, callHistory, indexedCallHistory } from "../../../utils/contacts/calls";
import { usePersonPresence } from "../../../utils/contacts/presence";
import { type Week, personWeek } from "../../../utils/contacts/activity";
import { type SharedRoom, askSharedRooms, callsWith, sharedRooms } from "../../../utils/contacts/shared";
import { type Verification, realAccounts, verificationOf, verify } from "../../../utils/contacts/verification";
import { callInRoom, messagePerson, openRoom } from "../../../utils/contacts/actions";
import { allPeople, chosenName, manualLinks, namePerson, takeOutAccount } from "../../../utils/contacts/people";
import { isFavourite, setFavourite } from "../../../utils/contacts/favourites";
import { splitName } from "../../../utils/contacts/names";
import { publishedCardOf } from "../../../utils/contacts/publish";
import { chosenColour, setColour } from "../../../utils/contacts/appearance";
import { cardFor, saveCard } from "../../../utils/contacts/card";
import { deleteRevision, forgetHistory, historyFor, recordRevision } from "../../../utils/contacts/history";
import { ringtoneOf, setRingtone, setTextTone, textToneOf, uploadTone } from "../../../utils/contacts/tones";
import { cardForExport, downloadVCard, toVCard } from "../../../utils/contacts/vcard";

interface Props {
    client: MatrixClient;
    person: Person;
    /** Where back goes, when the card is shown somewhere without a back of its own. */
    onBack?: () => void;
    /** Called once a change to them has been written, so whoever holds the person reads them again. */
    onChanged: () => void;
    /** Every call there is, when the caller already has them; the card reads them itself otherwise. */
    calls?: Call[];
    /** The actions menu, where whoever shows the card has one of its own; the card brings one otherwise. */
    menu?: ReactNode;
    /** The accounts the reader merged by hand; read here when the caller does not already hold them. */
    linkedIds?: ReadonlySet<string>;
    /** Takes one account out of them; done here when the caller has no way of its own. */
    onUnlinkAccount?: (mxid: string) => void;
}

/**
 * Every call, at once from the loaded timelines and then from the server's index where it has one - the
 * contacts list's calls, for a card shown on its own.
 */
function useCallHistory(client: MatrixClient, wanted: boolean): Call[] {
    const [calls, setCalls] = useState<Call[]>(() => (wanted ? callHistory(client) : []));
    useEffect(() => {
        if (!wanted) return;
        let alive = true;
        setCalls(callHistory(client));
        void indexedCallHistory(client).then((indexed) => {
            if (alive && indexed) setCalls(indexed);
        });
        return () => {
            alive = false;
        };
    }, [client, wanted]);
    return calls;
}

/**
 * The person an account belongs to, with every account they have - or undefined until that is known.
 *
 * Twice, as the contacts list does it: at once from what the client already holds, which finds the people
 * the reader has chats with, and then with what the networks publish about everyone. The second is what
 * ties somebody's accounts together and carries their numbers and usernames; from the first alone the
 * card opened from a chat's member list was the same person with half of them missing, and a group's
 * member the reader has no chat with was nobody at all.
 */
export function usePersonFor(client: MatrixClient, userId: string | undefined): [Person | undefined, () => void] {
    const [person, setPerson] = useState<Person>();
    const [at, setAt] = useState(0);
    useEffect(() => {
        if (!userId) return;
        let alive = true;
        let whole = false;
        const find = (people: Person[]): Person | undefined =>
            people.find((one) => one.accounts.some((account) => account.mxid === userId));
        void allPeople(client, { ask: false })
            // Only while the whole answer is still out, and only somebody: it must not undo the answer.
            .then((people) => alive && !whole && find(people) && setPerson(find(people)))
            .catch(() => undefined);
        void allPeople(client, { also: [userId] })
            .then((people) => {
                whole = true;
                if (alive) setPerson(find(people));
            })
            // Not knowing who they are is not knowing them: Element's own profile shows instead.
            .catch(() => alive && !whole && setPerson(undefined));
        return () => {
            alive = false;
        };
    }, [client, userId, at]);
    return [person, (): void => setAt((n) => n + 1)];
}

/**
 * A person's card with everything it can do wired in: the same card from the contacts list and from
 * clicking somebody anywhere else, so what can be seen and changed about a person does not depend on where
 * they were opened from.
 */
export function PersonCard({
    client,
    person,
    onBack,
    onChanged,
    calls,
    menu,
    linkedIds,
    onUnlinkAccount,
}: Props): JSX.Element {
    const presence = usePersonPresence(client, person);
    const history = useCallHistory(client, !calls);
    /*
     * What the server and the crypto say about whoever is open.
     *
     * Both are asked rather than worked out here: the rooms you are both in come from the homeserver
     * (MSC2666, which it advertises) and find the ones this client has never synced, and the identity
     * check is the crypto's answer about their cross-signing. Neither can be had synchronously, so the
     * card shows what there is and fills in when they answer.
     */
    const [groups, setGroups] = useState<SharedRoom[]>([]);
    const [verification, setVerification] = useState<Verification>();
    const [week, setWeek] = useState<Week>();
    useEffect(() => {
        let alive = true;
        setWeek(undefined);
        void personWeek(client, person).then((found) => alive && setWeek(found));
        setGroups(sharedRooms(client, person));
        void askSharedRooms(client, person).then((found) => alive && setGroups(found));
        void verificationOf(client, person).then((said) => alive && setVerification(said));
        return () => {
            alive = false;
        };
    }, [client, person]);

    return (
        <ContactCard
            person={person}
            onBack={onBack}
            onMessage={(who, mxid) => messagePerson(client, who, mxid)}
            nickname={chosenName(client, person)}
            onRename={(who, name) => void namePerson(client, who, name).then(onChanged)}
            onCall={(_who, roomId, video) => callInRoom(roomId, video)}
            favourite={isFavourite(client, person.rooms)}
            onFavourite={
                person.rooms.length ? (who, on) => void setFavourite(client, who.rooms, on).then(onChanged) : undefined
            }
            /*
             * Its own menu and its own way of taking an account out, where the caller brought neither: the
             * card opened from a chat had the facts and none of the actions, so fixing a wrong merge meant
             * going to the contacts list to find the same person again.
             */
            menu={menu ?? <PersonCardMenu client={client} person={person} onChanged={onChanged} />}
            presence={presence}
            calls={callsWith(calls ?? history, person)}
            week={week}
            groups={groups}
            verification={verification}
            onVerify={() => {
                const [mxid] = realAccounts(client, person);
                if (mxid) void verify(client, mxid);
            }}
            onOpenRoom={openRoom}
            onUnlinkAccount={onUnlinkAccount ?? ((id) => void takeOutAccount(client, id).then(onChanged))}
            linkedIds={linkedIds ?? new Set(manualLinks(client).flat())}
            colour={chosenColour(client, person)}
            onColour={(next) => void setColour(client, person, next).then(onChanged)}
            /*
             * The card, or the name read into its parts when there is no card: editing a bridged
             * contact used to person a form with an empty first and last name beside their display
             * name, which asks the reader to retype what is already on the screen.
             */
            card={cardFor(client, person) ?? publishedCardOf(person) ?? splitName(person.name)}
            onCard={(next) => {
                /*
                 * What it said before is kept first, then the change is written: a record taken
                 * after the write has nothing to record, and one taken and then not followed by a
                 * write claims a change that never happened.
                 */
                const was = cardFor(client, person);
                void recordRevision(client, person, was, "edit")
                    .then(() => saveCard(client, person, next))
                    .then(onChanged);
            }}
            ringtone={ringtoneOf(client, person)}
            textTone={textToneOf(client, person)}
            onTone={(which, file) => {
                const set = which === "ring" ? setRingtone : setTextTone;
                if (!file) {
                    void set(client, person, undefined).then(onChanged);
                    return;
                }
                void uploadTone(client, file)
                    .then((tone) => set(client, person, tone))
                    .then(onChanged);
            }}
            history={historyFor(client, person)}
            /*
             * Restoring is itself a save: what the card says now is recorded first, so putting an
             * old version back can be put back too. The same thing a password manager does when
             * you restore an entry from its history, and for the same reason - a restore onto the
             * wrong contact is exactly the mistake the history exists to undo.
             */
            onRestore={(revision) => {
                const was = cardFor(client, person);
                void recordRevision(client, person, was, "restore")
                    .then(() => saveCard(client, person, revision.was))
                    .then(onChanged);
            }}
            onDeleteRevision={(revision) => void deleteRevision(client, person, revision.ts).then(onChanged)}
            onEmptyHistory={() => void forgetHistory(client, person).then(onChanged)}
            onExport={() =>
                downloadVCard(`${person.name}.vcf`, toVCard(cardForExport(person, cardFor(client, person))))
            }
            onPhoto={(file) => {
                /*
                 * Uploaded to the reader's own media and kept as an mxc: URI, not inlined: a photo
                 * in account data is sent to every device on every sync, which is not what account
                 * data is for.
                 */
                const was = cardFor(client, person);
                void client
                    .uploadContent(file, { type: file.type })
                    .then(({ content_uri: photoUrl }) =>
                        recordRevision(client, person, was, "edit").then(() =>
                            saveCard(client, person, { ...was, photoUrl }),
                        ),
                    )
                    .then(onChanged);
            }}
        />
    );
}
