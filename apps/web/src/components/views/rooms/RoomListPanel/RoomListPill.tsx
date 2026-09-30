/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What this column is showing, and what it is being searched for, as one pill floating over it.
 *
 * A row of controls above the list costs that row in every chat, permanently, on the screen with the least
 * of it to spare; a pill floats and the list scrolls under it. It is also where the switch between the
 * chats, the people and the calls belongs: those are three views of one column, so one control moves
 * between them and none of them needs a strip of its own underneath.
 *
 * Searching is the fourth thing in it rather than a box somewhere else, because it is a search of this
 * column whichever of the three is showing. Pressing it turns the pill into the field: the entries slide
 * aside and give up their width instead of being replaced, so it reads as the same object doing something
 * else rather than one control vanishing and another appearing.
 */

import React, { type JSX, type ComponentType, type SVGAttributes, useEffect, useRef } from "react";

import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { _t } from "../../../../languageHandler";
import { useSlidingIndicator } from "../../../../hooks/useSlidingIndicator";
import {
    type RoomListPanelView,
    setRoomListPanelView,
    useRoomListPanelView,
} from "../../../../utils/roomListPanelView";
import { setSearchOpen, setSearchQuery, usePanelSearch } from "../../../../utils/panelSearch";

function Entry({
    Icon,
    label,
    current,
    onClick,
    innerRef,
}: {
    Icon: ComponentType<SVGAttributes<SVGElement>>;
    label: string;
    current: boolean;
    onClick: () => void;
    innerRef?: (el: HTMLElement | null) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            ref={innerRef}
            className="mx_RoomListPill_entry"
            // Where you are, rather than only which button is tinted: a mark a screen reader can hear too.
            aria-current={current ? "page" : undefined}
            onClick={onClick}
        >
            <Icon width="22" height="22" aria-hidden />
            <span>{label}</span>
        </button>
    );
}

export function RoomListPill(): JSX.Element {
    const view = useRoomListPanelView();
    const { open, query } = usePanelSearch();
    const go = (next: RoomListPanelView) => (): void => setRoomListPanelView(next);
    /*
     * The mark on the current entry travels to it, as the shared media strip's does: a selection that
     * blinks from one entry to another says two things happened, where one thing moved.
     */
    const { itemRef, style } = useSlidingIndicator<RoomListPanelView>(view);
    const field = useRef<HTMLInputElement>(null);

    // Opening it puts the caret in it: a search that must be pressed and then clicked is two gestures.
    useEffect(() => {
        if (open) field.current?.focus();
    }, [open]);

    const placeholder =
        view === "calls"
            ? _t("contacts|search_calls")
            : view === "contacts"
              ? _t("contacts|search_people")
              : _t("action|search");

    return (
        <nav className="mx_RoomListPill" aria-label={_t("room_list|pill_label")} data-searching={open || undefined}>
            {style && !open && <span className="mx_RoomListPill_selection" style={style} aria-hidden />}
            <div className="mx_RoomListPill_views" inert={open || undefined}>
                <Entry
                    Icon={ChatIcon}
                    label={_t("room_list|messages")}
                    current={view === "rooms"}
                    onClick={go("rooms")}
                    innerRef={itemRef("rooms")}
                />
                <Entry
                    Icon={UserProfileIcon}
                    label={_t("contacts|people")}
                    current={view === "contacts"}
                    onClick={go("contacts")}
                    innerRef={itemRef("contacts")}
                />
                <Entry
                    Icon={VoiceCallIcon}
                    label={_t("contacts|calls")}
                    current={view === "calls"}
                    onClick={go("calls")}
                    innerRef={itemRef("calls")}
                />
            </div>

            <div className="mx_RoomListPill_search">
                <input
                    ref={field}
                    type="search"
                    value={query}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    tabIndex={open ? 0 : -1}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => event.key === "Escape" && setSearchOpen(false)}
                />
            </div>

            <button
                type="button"
                className="mx_RoomListPill_find"
                aria-label={open ? _t("action|close") : _t("action|search")}
                aria-expanded={open}
                onClick={() => setSearchOpen(!open)}
            >
                {open ? <CloseIcon width="22" height="22" /> : <SearchIcon width="22" height="22" />}
            </button>
        </nav>
    );
}
