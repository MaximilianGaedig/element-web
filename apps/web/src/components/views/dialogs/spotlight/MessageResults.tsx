/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The "Messages" group of the search view, and the filter chips that narrow it.
 *
 * A hit says what Telegram's says: the chat it was in (avatar and name), when, who said it, and the line
 * with the words that matched marked. Pressing one opens that chat at that message, which is the only
 * reason to look a message up. Among the other results the group shows its first few hits and "Show all"
 * in its heading turns it into the whole view (the Messages tab); there the list pages itself as its end
 * comes into view, with skeleton rows where the next page will be.
 */

import React, { type JSX, useEffect, useMemo, useRef } from "react";
import { ChatFilter } from "@vector-im/compound-web";
import { ErrorIcon, SearchIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t, _td } from "../../../../languageHandler";
import { formatRelativeTime } from "../../../../DateUtils";
import RoomAvatar from "../../avatars/RoomAvatar";
import { Option } from "./Option";
import { SpotlightEmptyState } from "./SpotlightEmptyState";
import AccessibleButton from "../../elements/AccessibleButton";
import { type MessageHit, type MessageSearch } from "./useMessageSearch";
import { snippetParts } from "./messageSnippet";
import {
    MESSAGE_CHATS,
    MESSAGE_KINDS,
    MESSAGE_WHENS,
    type MessageChat,
    type MessageFilter,
    type MessageKind,
    type MessageWhen,
} from "./messageFilters";

/** How many hits the group shows among the other results before "Show all". */
const PREVIEW_COUNT = 3;
const SKELETON_KEYS = ["a", "b", "c"];

const KIND_LABELS = {
    media: _td("spotlight_dialog|kind_media"),
    links: _td("spotlight_dialog|kind_links"),
    files: _td("spotlight_dialog|kind_files"),
    music: _td("spotlight_dialog|kind_music"),
    voice: _td("spotlight_dialog|kind_voice"),
} as const;
const CHAT_LABELS = {
    direct: _td("spotlight_dialog|chat_direct"),
    group: _td("spotlight_dialog|chat_group"),
} as const;
const WHEN_LABELS = {
    day: _td("spotlight_dialog|when_day"),
    week: _td("spotlight_dialog|when_week"),
    month: _td("spotlight_dialog|when_month"),
} as const;

function Chip<T extends string>({
    value,
    current,
    label,
    onChange,
}: {
    value: T;
    current: T;
    label: string;
    /** Pressing the chip that is already on turns it off. */
    onChange(this: void, value: T | "any"): void;
}): JSX.Element {
    const on = value === current;
    return (
        <ChatFilter selected={on} aria-pressed={on} onClick={() => onChange(on ? "any" : value)}>
            {label}
        </ChatFilter>
    );
}

/**
 * What kind, where and when, as one row of the room list's own filter chips that scrolls sideways rather
 * than wraps, the three groups set apart by a thin rule: the same cuts as Telegram's global search.
 */
export function MessageFilterChips({
    filter,
    onChange,
}: {
    filter: MessageFilter;
    onChange(this: void, filter: MessageFilter): void;
}): JSX.Element {
    return (
        <div className="mx_SpotlightDialog_chipRow" role="group" aria-label={_t("spotlight_dialog|filters")}>
            {MESSAGE_KINDS.map((kind) => (
                <Chip<MessageKind>
                    key={kind}
                    value={kind}
                    current={filter.kind}
                    label={_t(KIND_LABELS[kind])}
                    onChange={(next) => onChange({ ...filter, kind: next })}
                />
            ))}
            <span className="mx_SpotlightDialog_chipDivider" aria-hidden />
            {MESSAGE_CHATS.map((chat) => (
                <Chip<MessageChat>
                    key={chat}
                    value={chat}
                    current={filter.chat}
                    label={_t(CHAT_LABELS[chat])}
                    onChange={(next) => onChange({ ...filter, chat: next })}
                />
            ))}
            <span className="mx_SpotlightDialog_chipDivider" aria-hidden />
            {MESSAGE_WHENS.map((when) => (
                <Chip<MessageWhen>
                    key={when}
                    value={when}
                    current={filter.when}
                    label={_t(WHEN_LABELS[when])}
                    onChange={(next) => onChange({ ...filter, when: next })}
                />
            ))}
        </div>
    );
}

function Hit({
    hit,
    highlights,
    onOpen,
}: {
    hit: MessageHit;
    highlights: string[];
    onOpen(this: void, hit: MessageHit): void;
}): JSX.Element {
    const { event, room } = hit;
    const content = event.getContent();
    const body = String((content["m.new_content"] ?? content).body ?? "");
    const sender = room.getMember(event.getSender()!)?.name ?? event.sender?.name ?? event.getSender() ?? "";
    const id = event.getId()!;
    return (
        <Option
            id={`mx_SpotlightDialog_button_message_${id}`}
            className="mx_SpotlightDialog_message"
            onClick={() => onOpen(hit)}
            aria-label={`${room.name}, ${sender}: ${body}`}
        >
            <RoomAvatar room={room} size="48px" />
            <div className="mx_SpotlightDialog_message_text">
                <div className="mx_SpotlightDialog_message_head">
                    <span className="mx_SpotlightDialog_message_room">{room.name}</span>
                    <time className="mx_SpotlightDialog_message_date" dateTime={new Date(event.getTs()).toISOString()}>
                        {formatRelativeTime(new Date(event.getTs()))}
                    </time>
                </div>
                <div className="mx_SpotlightDialog_message_line">
                    <span className="mx_SpotlightDialog_message_sender">{sender}: </span>
                    {snippetParts(body, highlights).map((part) =>
                        part.match ? <mark key={part.at}>{part.text}</mark> : <span key={part.at}>{part.text}</span>,
                    )}
                </div>
            </div>
        </Option>
    );
}

function Skeletons(): JSX.Element {
    return (
        <>
            {SKELETON_KEYS.map((key) => (
                <li key={key} className="mx_SpotlightDialog_messageSkeleton" aria-hidden>
                    <span className="mx_SpotlightDialog_skeletonAvatar" />
                    <span className="mx_SpotlightDialog_skeletonLines">
                        <span />
                        <span />
                    </span>
                </li>
            ))}
        </>
    );
}

interface Props {
    search: MessageSearch;
    term: string;
    /** Only the first few, with a way to the rest; absent when this is the whole view. */
    preview?: boolean;
    onOpen(this: void, hit: MessageHit): void;
    onShowAll?(this: void): void;
}

export function MessageResults({ search, term, preview, onOpen, onShowAll }: Props): JSX.Element | null {
    const { hits, loading, loadingMore, hasMore, failed, loadMore, count } = search;
    const highlights = useMemo(() => [...search.highlights, term.trim()], [search.highlights, term]);
    const end = useRef<HTMLDivElement>(null);

    // The whole view pages itself as its end comes into view.
    useEffect(() => {
        const node = end.current;
        if (preview || !node || !hasMore || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => entries.some((entry) => entry.isIntersecting) && loadMore(),
            { root: node.closest("#mx_SpotlightDialog_content"), rootMargin: "0px 0px 240px 0px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [preview, hasMore, loadMore, hits.length]);

    // Among other results a group with nothing in it is not worth a heading.
    if (preview && !loading && !hits.length) return null;

    if (!preview && !loading && !loadingMore && !hits.length) {
        return failed ? (
            <SpotlightEmptyState icon={<ErrorIcon />} title={_t("spotlight_dialog|messages_failed")} />
        ) : (
            <SpotlightEmptyState
                icon={<SearchIcon />}
                title={_t("spotlight_dialog|messages_none")}
                description={_t("spotlight_dialog|messages_none_hint")}
            />
        );
    }

    const shown = preview ? hits.slice(0, PREVIEW_COUNT) : hits;
    const showAll = preview && onShowAll && (hits.length > PREVIEW_COUNT || hasMore);
    // Telegram heads the whole list with how many there are; the server counts before the chips narrow it.
    const heading =
        !preview && count !== undefined && !loading
            ? _t("spotlight_dialog|messages_count", { count })
            : _t("spotlight_dialog|messages_label");
    return (
        <div
            className="mx_SpotlightDialog_section mx_SpotlightDialog_results mx_SpotlightDialog_messages"
            role="group"
            aria-labelledby="mx_SpotlightDialog_section_messages"
        >
            <div className="mx_SpotlightDialog_sectionHeader">
                <h4 id="mx_SpotlightDialog_section_messages">{heading}</h4>
                {showAll && (
                    <AccessibleButton
                        kind="link_inline"
                        className="mx_SpotlightDialog_showAll"
                        tabIndex={-1}
                        onClick={onShowAll}
                    >
                        {_t("action|show_all")}
                    </AccessibleButton>
                )}
            </div>
            <div>
                {shown.map((hit) => (
                    <Hit key={hit.event.getId()} hit={hit} highlights={highlights} onOpen={onOpen} />
                ))}
                {(loading || (loadingMore && !preview)) && <Skeletons />}
                {failed && <p className="mx_SpotlightDialog_messagesNote">{_t("spotlight_dialog|messages_failed")}</p>}
                {!preview && <div ref={end} className="mx_SpotlightDialog_messagesEnd" aria-hidden />}
            </div>
        </div>
    );
}
