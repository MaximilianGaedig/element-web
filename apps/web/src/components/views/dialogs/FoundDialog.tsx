/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What your chats turned out to contain, by kind.
 *
 * Each of these was already offered once, under the message it was found in, and then forgotten - so the
 * appointment somebody sent three weeks ago is findable only by remembering which chat it was in. Here
 * they are collected (utils/detect/collected.ts): what has not happened yet, soonest first; the numbers;
 * the addresses; what is on its way; what has been linked.
 *
 * Every row says where it came from and goes there when pressed, because a list of facts with no way back
 * to who said them is a list nobody can act on. Nothing here was fetched and nothing is sent: it is a
 * reading of messages this device already had.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import CalendarIcon from "@vector-im/compound-design-tokens/assets/web/icons/calendar";
import PhoneIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import PlaceIcon from "@vector-im/compound-design-tokens/assets/web/icons/location-pin";
import OnTheWayIcon from "@vector-im/compound-design-tokens/assets/web/icons/send";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import GoIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-up-right";

import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import Spinner from "../elements/Spinner";
import { type Collected, collectedOf } from "../../../utils/detect/collected";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { formatFullDateNoDay, formatRelativeTime, formatTime } from "../../../DateUtils";
import RoomAvatar from "../avatars/RoomAvatar";

/**
 * The lists, in the order somebody would want them: what is coming first, because that is the only one
 * with a deadline in it.
 */
const SECTIONS = [
    { id: "when", icon: CalendarIcon, kinds: ["datetime"] },
    { id: "who", icon: PhoneIcon, kinds: ["phone"] },
    { id: "where", icon: PlaceIcon, kinds: ["address"] },
    { id: "onway", icon: OnTheWayIcon, kinds: ["flight", "parcel"] },
    { id: "links", icon: LinkIcon, kinds: ["url"] },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface Props {
    onFinished(this: void): void;
}

/** What a row says on its face: the found thing, said the way it would be said out loud. */
function label(row: Collected): string {
    if (row.kind !== "datetime") return row.extra && row.kind !== "url" ? `${row.extra} ${row.text}` : row.text;
    const when = new Date(row.at);
    // A day without a time is a day; a time is worth the hour it named.
    return row.extra === "time" ? `${formatFullDateNoDay(when)}, ${formatTime(when)}` : formatFullDateNoDay(when);
}

export default function FoundDialog({ onFinished }: Props): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const [section, setSection] = useState<SectionId>("when");
    const [rows, setRows] = useState<Collected[]>();
    /** Arrangements that have already happened, kept below the ones that have not. */
    const [past, setPast] = useState<Collected[]>([]);

    useEffect(() => {
        let gone = false;
        setRows(undefined);
        setPast([]);
        const chosen = SECTIONS.find((one) => one.id === section)!;
        const userId = client.getSafeUserId();
        void Promise.all(chosen.kinds.map((kind) => collectedOf(userId, kind))).then((lists) => {
            if (gone) return;
            // Two kinds in one list ("on the way") are shown together, newest first.
            setRows(lists.flat().sort((a, b) => (section === "when" ? a.at - b.at : b.at - a.at)));
        });
        if (section === "when") {
            void collectedOf(userId, "datetime", { past: true }).then((old) => !gone && setPast(old));
        }
        return () => {
            gone = true;
        };
    }, [client, section]);

    const counts = useMemo(() => ({ shown: rows?.length ?? 0, past: past.length }), [rows, past]);

    /** Where it came from: the chat, at the message, which is the only way to check any of this. */
    const goTo = (row: Collected): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: row.room,
            event_id: row.event,
            highlighted: true,
            metricsTrigger: undefined,
        });
        onFinished();
    };

    const list = (entries: Collected[]): JSX.Element[] =>
        entries.map((row) => {
            const room = client.getRoom(row.room);
            const who = room?.getMember(row.sender)?.name ?? row.sender;
            return (
                <li key={row.id} className="mx_FoundDialog_row">
                    <button
                        type="button"
                        className="mx_FoundDialog_what"
                        onClick={() => goTo(row)}
                        title={_t("found|go_to_message")}
                    >
                        <span className="mx_FoundDialog_label">{label(row)}</span>
                        <span className="mx_FoundDialog_from">
                            {room && <RoomAvatar room={room} size="16px" />}
                            {room ? `${room.name} · ${who}` : who}
                            {" · "}
                            {formatRelativeTime(new Date(row.ts))}
                        </span>
                        {/* What the message actually said, where that is not the label itself. */}
                        {row.kind === "datetime" && <span className="mx_FoundDialog_said">“{row.text}”</span>}
                    </button>
                    {row.url && (
                        <a
                            className="mx_FoundDialog_go"
                            href={row.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={_t("found|open")}
                        >
                            <GoIcon />
                        </a>
                    )}
                </li>
            );
        });

    return (
        <BaseDialog
            className="mx_FoundDialog"
            onFinished={onFinished}
            title={_t("found|title")}
            contentId="mx_FoundDialog_content"
        >
            <nav className="mx_FoundDialog_sections">
                {SECTIONS.map(({ id, icon: Icon }) => (
                    <Button
                        key={id}
                        kind={id === section ? "primary" : "secondary"}
                        size="md"
                        className="mx_FoundDialog_section"
                        aria-pressed={id === section}
                        onClick={() => setSection(id)}
                    >
                        <Icon />
                        {_t(`found|${id}` as "found|when")}
                    </Button>
                ))}
            </nav>

            <div id="mx_FoundDialog_content" className="mx_FoundDialog_content">
                {rows === undefined ? (
                    <Spinner />
                ) : counts.shown === 0 && counts.past === 0 ? (
                    /*
                     * Nothing yet is the usual first answer: the reading happens in idle time and works
                     * back through the chats, so a list that is empty now may not be in a minute.
                     */
                    <p className="mx_FoundDialog_none">{_t("found|nothing_yet")}</p>
                ) : (
                    <>
                        <ul className="mx_FoundDialog_list">{list(rows)}</ul>
                        {section === "when" && past.length > 0 && (
                            <>
                                <h3 className="mx_FoundDialog_heading">{_t("found|already_happened")}</h3>
                                <ul className="mx_FoundDialog_list mx_FoundDialog_list_past">{list(past)}</ul>
                            </>
                        )}
                    </>
                )}
            </div>
        </BaseDialog>
    );
}
