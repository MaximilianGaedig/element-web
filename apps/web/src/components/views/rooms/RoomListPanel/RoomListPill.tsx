/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What this column is showing, as one pill floating over it, and a search button of its own beside it.
 *
 * A row of controls above the list costs that row in every chat, permanently, on the screen with the least
 * of it to spare; a pill floats and the list scrolls under it. It is also where the switch between the
 * chats, the people, the calls and the settings belongs: those are four views of one column, so one control
 * moves between them and none of them needs a strip of its own underneath.
 *
 * Search sits apart from the pill as the microphone sits apart from the composer: a round island of the
 * same height at the start of the row, because it is a different kind of control from the three places the
 * pill moves between. Over people, a + at the other end adds somebody, where iOS keeps its compose button.
 * What it searches depends on the view. Over the chats it opens the search everything else in the app uses
 * (the Ctrl+K dialog), which already covers rooms, people and messages; over the settings it goes to the
 * settings' own field (which that dialog covers as well). Over people and calls it
 * searches that list in place: the pill gives up its width and the button grows into a field, so it reads
 * as the same control doing something else rather than one control vanishing and another appearing.
 */

import React, { type JSX, type ComponentType, type SVGAttributes, useEffect, useRef } from "react";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import SettingsIcon from "@vector-im/compound-design-tokens/assets/web/icons/settings";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import PlusIcon from "@vector-im/compound-design-tokens/assets/web/icons/plus";

import { _t } from "../../../../languageHandler";
import { useSlidingIndicator } from "../../../../hooks/useSlidingIndicator";
import {
    type RoomListPanelView,
    setRoomListPanelView,
    useRoomListPanelView,
} from "../../../../utils/roomListPanelView";
import { setSearchOpen, setSearchQuery, usePanelSearch } from "../../../../utils/panelSearch";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { setAddingContact, useAddingContact } from "../../../../utils/contacts/adding";
import { type BarAction, useBarActions } from "../../../../utils/roomListBarActions";
import { useUserSettingsSection } from "../../../../utils/userSettingsSection";
import { requestSettingsFocus } from "../../../../utils/settingsFocus";
import { preloadSettingsPage } from "../../settings/settingsPreload";
import { useTgNavigation } from "../../telegram/TgNavigation";

function Entry({
    Icon,
    label,
    current,
    onClick,
    onWarm,
    innerRef,
}: {
    Icon: ComponentType<SVGAttributes<SVGElement>>;
    label: string;
    current: boolean;
    onClick: () => void;
    /** About to be pressed: a pointer is over it, or the keyboard has reached it. */
    onWarm?: () => void;
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
            onPointerEnter={onWarm}
            onFocus={onWarm}
        >
            <Icon width="22" height="22" aria-hidden />
            <span>{label}</span>
        </button>
    );
}

/** One of a screen's own two answers, in place of search or add; it grows out of the island it replaces. */
function ActionIsland({
    action,
    side,
    hidden,
}: {
    action: BarAction;
    side: "start" | "end";
    hidden: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            className={`mx_RoomListPill_island mx_RoomListPill_action mx_RoomListPill_action_${side}`}
            data-primary={action.primary || undefined}
            data-hidden={hidden || undefined}
            inert={hidden || undefined}
            onClick={action.onClick}
        >
            {action.label}
        </button>
    );
}

export function RoomListPill({ canSearch = true }: { canSearch?: boolean }): JSX.Element {
    const view = useRoomListPanelView();
    const { open, query } = usePanelSearch();
    const adding = useAddingContact();
    /* A screen over the column can put its own two answers in the islands (roomListBarActions.ts). */
    const actions = useBarActions();
    /*
     * The islands swap by transition, both kept in the same place: the last actions stay rendered while they
     * fade back into search and add, so going back animates as well as coming in.
     */
    const lastActions = useRef(actions);
    if (actions) lastActions.current = actions;
    const shownActions = actions ?? lastActions.current;
    const go = (next: RoomListPanelView) => (): void => setRoomListPanelView(next);
    /*
     * The settings are a page as well as a view of this column, so they are opened as a page is, and
     * MatrixChat turns the column to them (MatrixChat.viewSettings). Pressed again while open, nothing: on
     * a desktop it would throw away the section being read for the first one.
     */
    const { handheld } = useTgNavigation();
    // On a phone a section is the whole screen over the list: the bar is shown over it too (UserSettingsPage).
    const openSection = useUserSettingsSection();
    const sectionOpen = handheld && !!openSection;
    /*
     * With a section open on a phone the entry for the settings, as the list's own way back, goes to the
     * list of them: there is nothing else it could mean there.
     */
    const openSettings = (): void => {
        if (view !== "settings" || sectionOpen) defaultDispatcher.dispatch({ action: Action.ViewUserSettings });
    };
    /* People and calls are searched in place; the chats by the app's own search, the settings by their own. */
    const searchesInPlace = view === "contacts" || view === "calls";
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

    const placeholder = view === "calls" ? _t("contacts|search_calls") : _t("contacts|search_people");
    const onSearch = (): void => {
        if (view === "settings") {
            // The field is in the list: on a phone with a section open that is the screen behind this one.
            if (sectionOpen) defaultDispatcher.dispatch({ action: Action.ViewUserSettings });
            requestSettingsFocus("search");
        } else if (!searchesInPlace) defaultDispatcher.fire(Action.OpenSpotlight);
        else setSearchOpen(!open);
    };

    return (
        <div
            className="mx_RoomListPill_bar"
            data-searching={open || undefined}
            data-actions={actions ? true : undefined}
        >
            {canSearch && (
                <div
                    className="mx_RoomListPill_island mx_RoomListPill_find"
                    data-hidden={actions ? true : undefined}
                    inert={actions ? true : undefined}
                >
                    <button
                        type="button"
                        // Where keyboard landmark navigation (Ctrl+F6) takes you for "search the room list".
                        id="room-list-search-button"
                        className="mx_RoomListPill_islandButton"
                        aria-label={_t("action|search")}
                        aria-expanded={searchesInPlace ? open : undefined}
                        // Open, it is the field's own magnifier: pressing it again goes back to the field.
                        onClick={open ? () => field.current?.focus() : onSearch}
                        tabIndex={open ? -1 : 0}
                    >
                        <SearchIcon width="22" height="22" aria-hidden />
                    </button>
                    {searchesInPlace && (
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
                    )}
                    {open && (
                        <button
                            type="button"
                            className="mx_RoomListPill_islandButton mx_RoomListPill_close"
                            aria-label={_t("action|close")}
                            onClick={() => setSearchOpen(false)}
                        >
                            <CloseIcon width="20" height="20" aria-hidden />
                        </button>
                    )}
                </div>
            )}
            {shownActions && <ActionIsland action={shownActions.start} side="start" hidden={!actions} />}

            <nav
                className="mx_RoomListPill"
                aria-label={_t("room_list|pill_label")}
                inert={open || !!actions || undefined}
            >
                {style && <span className="mx_RoomListPill_selection" style={style} aria-hidden />}
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
                <Entry
                    Icon={SettingsIcon}
                    label={_t("common|settings")}
                    current={view === "settings"}
                    onClick={openSettings}
                    onWarm={preloadSettingsPage}
                    innerRef={itemRef("settings")}
                />
            </nav>

            {/* Gone while its editor is open: pressing it again would open a second editor over the first. */}
            {view === "contacts" && !adding && (
                <button
                    type="button"
                    className="mx_RoomListPill_island mx_RoomListPill_add"
                    aria-label={_t("contacts|add_contact")}
                    data-hidden={actions ? true : undefined}
                    inert={actions ? true : undefined}
                    onClick={() => setAddingContact(true)}
                >
                    <PlusIcon width="22" height="22" aria-hidden />
                </button>
            )}
            {shownActions && <ActionIsland action={shownActions.end} side="end" hidden={!actions} />}
        </div>
    );
}
