/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The settings, as the column beside the chats shows them: the list of sections, with the chosen one open
 * in the page beside it - Telegram's settings, and the list the settings dialog used to keep down its own
 * left edge. On a phone the list is the whole screen and a section slides over it, as a chat does.
 *
 * Both lists (the sections, and what a search found) are listboxes with one stop in the tab order and the
 * arrow keys, Home and End inside it, as the Authoring Practices have it; Enter and Space choose.
 *
 * Choosing a section is navigation (Action.ViewUserSettings, #/settings/<section>) rather than state of
 * this list's own, so a link to one, the back button and the browser's history all agree with it.
 */

import React, { type JSX, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconButton } from "@vector-im/compound-web";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import { ClientEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type OpenToTabPayload } from "../../../dispatcher/payloads/OpenToTabPayload";
import { UserTab } from "../dialogs/UserTab";
import { searchSettings } from "./settingsSearch";
import { preloadSettingsData } from "./settingsPreload";
import { onSettingsFocusRequest } from "../../../utils/settingsFocus";
import { resolveUserSettingsSection, useUserSettingsSections } from "./userSettingsSections";
import {
    rememberSettingsSearchText,
    settingsSearchText,
    useUserSettingsSection,
} from "../../../utils/userSettingsSection";
import { setRoomListPanelView } from "../../../utils/roomListPanelView";
import { useTgNavigation } from "../telegram/TgNavigation";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { NoChange, useEventEmitterAsyncState, type AsyncStateCallbackResult } from "../../../hooks/useEventEmitter";

/** `highlight` is the setting's label, for the page to scroll to and flash (UserSettingsPage). */
function openSection(id: UserTab, highlight?: string): void {
    defaultDispatcher.dispatch<OpenToTabPayload>({
        action: Action.ViewUserSettings,
        initialTabId: id,
        props: highlight ? { highlight } : undefined,
    });
}

/**
 * Whether the account has no recovery set up, which the Encryption section is marked for until it does: the
 * one setting worth drawing the eye to from the list, as the dialog's tab did.
 */
function useRecoveryMissing(): boolean {
    const client = useMatrixClientContext();
    return useEventEmitterAsyncState(
        client,
        ClientEvent.AccountData,
        async (event?: MatrixEvent): AsyncStateCallbackResult<boolean> => {
            if (event === undefined || event.getType() === "m.secret_storage.default_key") {
                return !(await client.secretStorage.getDefaultKeyId());
            }
            return new NoChange();
        },
        [client],
        false,
    );
}

/** The next row for an arrow key, or undefined for a key that is not one. */
function step(key: string, from: number, count: number): number | undefined {
    switch (key) {
        case "ArrowDown":
            return Math.min(from + 1, count - 1);
        case "ArrowUp":
            return Math.max(from - 1, 0);
        case "Home":
            return 0;
        case "End":
            return count - 1;
    }
}

/** Enter and Space choose, on anything that is not a button of its own. */
const isChoose = (event: KeyboardEvent): boolean => event.key === "Enter" || event.key === " ";

export function UserSettingsList(): JSX.Element {
    const { handheld } = useTgNavigation();
    const all = useUserSettingsSections();
    const sections = handheld ? all.filter((section) => !section.needsKeyboard) : all;
    const asked = useUserSettingsSection();
    /*
     * Beside the page the first section is showing when none was asked for, so it is the one marked; on a
     * phone nothing is showing yet, and nothing is marked on a list you have yet to choose from.
     */
    const current = handheld ? asked : resolveUserSettingsSection(all, asked).id;
    const recoveryMissing = useRecoveryMissing();
    const client = useMatrixClientContext();
    // The list is up before any section is: the code and the sessions are on their way by the time one is.
    useEffect(() => preloadSettingsData(client), [client]);

    const [query, setQueryState] = useState(settingsSearchText);
    const setQuery = (text: string): void => {
        rememberSettingsSearchText(text);
        setQueryState(text);
    };
    const field = useRef<HTMLInputElement>(null);
    const rows = useRef(new Map<string, HTMLElement>());
    const searching = query.trim() !== "";
    const results = searching ? searchSettings(query, sections) : [];
    const resultKey = (section: UserTab, label?: string): string => `result-${section}-${label ?? ""}`;
    /* The row that takes the tab stop: the open section, or else the first. */
    const [focused, setFocused] = useState<UserTab | undefined>();
    const stop = sections.find((section) => section.id === (focused ?? current))?.id ?? sections[0].id;
    const [active, setActive] = useState(0);
    const activeResult = Math.min(active, results.length - 1);

    // The search button in the bar at the foot of the column, and Escape out of a section, land here.
    useEffect(
        () =>
            onSettingsFocusRequest((target) => {
                if (target === "search") field.current?.focus();
                else rows.current.get(target)?.focus();
            }),
        [],
    );

    const choose = (section: UserTab, highlight?: string): void => {
        if (highlight) setQuery("");
        openSection(section, highlight);
    };

    const onSectionKeyDown = (event: KeyboardEvent, index: number): void => {
        if (isChoose(event)) {
            event.preventDefault();
            choose(sections[index].id);
            return;
        }
        const to = step(event.key, index, sections.length);
        if (to === undefined) return;
        event.preventDefault();
        setFocused(sections[to].id);
        rows.current.get(sections[to].id)?.focus();
    };

    /* The focus stays in the field while the arrows move through what it found, as a combobox's does. */
    const onFieldKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            setQuery("");
            return;
        }
        if (!searching || results.length === 0) return;
        if (event.key === "Enter") {
            event.preventDefault();
            const { section, label } = results[activeResult];
            choose(section, label);
            return;
        }
        const to = step(event.key, activeResult, results.length);
        if (to === undefined || event.key === "Home" || event.key === "End") return;
        event.preventDefault();
        setActive(to);
    };

    return (
        <div className="mx_UserSettingsList">
            <div className="mx_UserSettingsList_header">
                <IconButton aria-label={_t("action|back")} onClick={() => setRoomListPanelView("rooms")} size="32px">
                    <BackIcon />
                </IconButton>
                <h2 className="mx_UserSettingsList_title">{_t("common|settings")}</h2>
            </div>
            <div className="mx_UserSettingsList_search">
                <SearchIcon width="20" height="20" aria-hidden />
                <input
                    ref={field}
                    type="search"
                    role="combobox"
                    aria-expanded={searching && results.length > 0}
                    aria-controls="mx_UserSettingsList_results"
                    aria-autocomplete="list"
                    aria-activedescendant={
                        searching && results.length > 0
                            ? resultKey(results[activeResult].section, results[activeResult].label)
                            : undefined
                    }
                    value={query}
                    placeholder={_t("tg_layout|settings_search")}
                    aria-label={_t("tg_layout|settings_search")}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onFieldKeyDown}
                />
            </div>
            {/* Said, not shown: how many there are is what a screen reader cannot see by looking. */}
            <div className="mx_UserSettingsList_status" role="status" aria-live="polite">
                {searching && _t("tg_layout|settings_results", { count: results.length })}
            </div>
            {searching ? (
                <ul
                    id="mx_UserSettingsList_results"
                    className="mx_UserSettingsList_sections mx_UserSettingsList_results"
                    role="listbox"
                    aria-label={_t("action|search")}
                >
                    {results.length === 0 && (
                        <li role="none" className="mx_UserSettingsList_empty">
                            {_t("tg_layout|settings_search_empty")}
                        </li>
                    )}
                    {results.map(({ section, label, sectionLabel }, index) => (
                        <li key={resultKey(section, label)} role="none">
                            <div
                                role="option"
                                id={resultKey(section, label)}
                                // The field keeps the focus; this is the one it points at.
                                aria-selected={index === activeResult}
                                className="mx_UserSettingsList_section mx_UserSettingsList_result"
                                // Reached by the field's arrows; focusable only for the click that lands on it.
                                tabIndex={-1}
                                onKeyDown={(event) => {
                                    if (!isChoose(event)) return;
                                    event.preventDefault();
                                    choose(section, label);
                                }}
                                onClick={() => choose(section, label)}
                                onMouseMove={() => setActive(index)}
                            >
                                <span className="mx_UserSettingsList_resultLabel">{label ?? sectionLabel}</span>
                                {label && <span className="mx_UserSettingsList_resultSection">{sectionLabel}</span>}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <ul
                    className="mx_UserSettingsList_sections"
                    role="listbox"
                    aria-orientation="vertical"
                    aria-label={_t("common|settings")}
                >
                    {sections.map(({ id, label, Icon }, index) => (
                        <li key={id} role="none">
                            <div
                                role="option"
                                ref={(element) => {
                                    if (element) rows.current.set(id, element);
                                    else rows.current.delete(id);
                                }}
                                className="mx_UserSettingsList_section"
                                aria-selected={id === current}
                                tabIndex={id === stop ? 0 : -1}
                                data-alert={(id === UserTab.Encryption && recoveryMissing) || undefined}
                                onFocus={() => setFocused(id)}
                                onKeyDown={(event) => onSectionKeyDown(event, index)}
                                onClick={() => choose(id)}
                            >
                                <Icon width="24" height="24" aria-hidden />
                                <span>{_t(label)}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
