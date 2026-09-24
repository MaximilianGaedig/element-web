/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * People, and the calls with them.
 *
 * Two lists the room list cannot be: one row per person rather than per conversation (so somebody who is on
 * WhatsApp and Signal is one row saying so, and somebody whose number you have but never messaged is a row at
 * all), and every call in one place rather than buried in the chat it happened in.
 *
 * Both are built from what the client already holds plus what the bridges will say (utils/contacts/), and both
 * are lists of things to open: a person opens the chat with them, a call jumps to the call in its chat.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";

import { _t } from "../../../languageHandler";
import BaseDialog from "../dialogs/BaseDialog";
import { type Call, callHistory } from "../../../utils/contacts/calls";
import { type Person, allPeople } from "../../../utils/contacts/people";
import { readKey } from "../../../utils/contacts/identity";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { DirectoryMember, startDmOnFirstMessage } from "../../../utils/direct-messages";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { formatRelativeTime } from "../../../DateUtils";
import Spinner from "../elements/Spinner";

const AVATAR_SIZE = "32px";

interface Props {
    /** Which list to open on: people, or the calls with them. */
    initialTab?: "people" | "calls";
    onFinished(): void;
}

/** A face for a row, from whatever the network gave us. */
function Face({ name, avatarUrl }: { name: string; avatarUrl?: string }): JSX.Element {
    const url = avatarUrl ? mediaFromMxc(avatarUrl).getSquareThumbnailHttp(32) : null;
    return <BaseAvatar name={name} idName={name} url={url ?? undefined} size={AVATAR_SIZE} />;
}

/** How long a call lasted, in the shortest form that is still true. */
function readDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function PersonRow({ person, onOpen }: { person: Person; onOpen(person: Person): void }): JSX.Element {
    /*
     * What to say under the name: their number when a network published one - that is the thing that made
     * these accounts one person - and otherwise which networks they are on, which is the next most useful
     * fact and the reason this list exists.
     */
    const networks = [...new Set(person.accounts.map((account) => account.network))];
    const detail = person.keys.length ? readKey(person.keys[0]) : networks.join(" · ");

    return (
        <button type="button" className="mx_ContactsDialog_row" onClick={() => onOpen(person)}>
            <Face name={person.name} avatarUrl={person.avatarUrl} />
            <span className="mx_ContactsDialog_rowText">
                <span className="mx_ContactsDialog_name">{person.name}</span>
                <span className="mx_ContactsDialog_detail">{detail}</span>
            </span>
            <span className="mx_ContactsDialog_networks">
                {networks.map((network) => (
                    <span key={network} className="mx_ContactsDialog_network">
                        {network}
                    </span>
                ))}
            </span>
        </button>
    );
}

function CallRow({ call, onOpen }: { call: Call; onOpen(call: Call): void }): JSX.Element {
    const what = call.outgoing
        ? _t("contacts|call_outgoing")
        : call.outcome === "missed"
          ? _t("contacts|call_missed")
          : call.outcome === "declined"
            ? _t("contacts|call_declined")
            : _t("contacts|call_incoming");
    const detail = [what, call.network, call.seconds !== undefined ? readDuration(call.seconds) : undefined]
        .filter(Boolean)
        .join(" · ");

    return (
        <button
            type="button"
            className={`mx_ContactsDialog_row${call.outcome === "missed" && !call.outgoing ? " mx_ContactsDialog_row_missed" : ""}`}
            onClick={() => onOpen(call)}
        >
            <Face name={call.name} avatarUrl={call.avatarUrl} />
            <span className="mx_ContactsDialog_rowText">
                <span className="mx_ContactsDialog_name">{call.name}</span>
                <span className="mx_ContactsDialog_detail">{detail}</span>
            </span>
            <span className="mx_ContactsDialog_when">{formatRelativeTime(new Date(call.ts))}</span>
            {call.video ? <VideoCallIcon aria-hidden /> : <VoiceCallIcon aria-hidden />}
        </button>
    );
}

export function ContactsDialog({ initialTab = "people", onFinished }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const [tab, setTab] = useState(initialTab);
    const [people, setPeople] = useState<Person[]>();
    const [query, setQuery] = useState("");

    // Asked for once per opening: the bridges answer in their own time and the list fills in when they do.
    useEffect(() => {
        let alive = true;
        void allPeople(client).then((found) => {
            if (alive) setPeople(found);
        });
        return () => {
            alive = false;
        };
    }, [client]);

    const calls = useMemo(() => callHistory(client), [client]);

    const shown = useMemo(() => {
        const term = query.trim().toLowerCase();
        if (!term) return people ?? [];
        return (people ?? []).filter(
            (person) =>
                person.name.toLowerCase().includes(term) ||
                person.keys.some((key) => key.includes(term)) ||
                person.accounts.some((account) => account.network.toLowerCase().includes(term)),
        );
    }, [people, query]);

    /** A person is somewhere to go: the chat that exists, else a new one with whichever account can. */
    const openPerson = useCallback(
        (person: Person): void => {
            const existing = person.rooms[0];
            if (existing) {
                dis.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: existing,
                    metricsTrigger: undefined,
                });
                onFinished();
                return;
            }
            const account = person.accounts.find((one) => one.mxid);
            if (!account?.mxid) return;
            void startDmOnFirstMessage(client, [
                new DirectoryMember({
                    user_id: account.mxid,
                    display_name: account.name,
                    avatar_url: account.avatarUrl,
                }),
            ]);
            onFinished();
        },
        [client, onFinished],
    );

    /** A call is somewhere to go: the call itself, in the chat it happened in. */
    const openCall = useCallback(
        (call: Call): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: call.roomId,
                event_id: call.eventId,
                highlighted: true,
                metricsTrigger: undefined,
            });
            onFinished();
        },
        [onFinished],
    );

    return (
        <BaseDialog className="mx_ContactsDialog" onFinished={onFinished} title={_t("contacts|title")} hasCancel={true}>
            <div className="mx_ContactsDialog_tabs" role="tablist">
                <Button
                    kind={tab === "people" ? "primary" : "tertiary"}
                    size="md"
                    role="tab"
                    aria-selected={tab === "people"}
                    Icon={UserProfileIcon}
                    onClick={() => setTab("people")}
                >
                    {_t("contacts|people")}
                </Button>
                <Button
                    kind={tab === "calls" ? "primary" : "tertiary"}
                    size="md"
                    role="tab"
                    aria-selected={tab === "calls"}
                    Icon={VoiceCallIcon}
                    onClick={() => setTab("calls")}
                >
                    {_t("contacts|calls")}
                </Button>
            </div>

            {tab === "people" ? (
                <>
                    <input
                        className="mx_ContactsDialog_search"
                        type="search"
                        value={query}
                        placeholder={_t("contacts|search_people")}
                        onChange={(event) => setQuery(event.target.value)}
                        autoFocus
                    />
                    <div className="mx_ContactsDialog_list">
                        {people === undefined && <Spinner />}
                        {people !== undefined && !shown.length && (
                            <p className="mx_ContactsDialog_empty">{_t("contacts|no_people")}</p>
                        )}
                        {shown.map((person) => (
                            <PersonRow key={person.id} person={person} onOpen={openPerson} />
                        ))}
                    </div>
                </>
            ) : (
                <div className="mx_ContactsDialog_list">
                    {!calls.length && <p className="mx_ContactsDialog_empty">{_t("contacts|no_calls")}</p>}
                    {calls.map((call) => (
                        <CallRow key={`${call.roomId}:${call.eventId}`} call={call} onOpen={openCall} />
                    ))}
                </div>
            )}
        </BaseDialog>
    );
}

export default ContactsDialog;
