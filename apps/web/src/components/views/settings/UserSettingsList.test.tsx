/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { ClientEvent, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";

import { UserSettingsList } from "./UserSettingsList";
import { UserTab } from "../dialogs/UserTab";
import SettingsStore from "../../../settings/SettingsStore";
import SdkConfig from "../../../SdkConfig";
import { UIFeature } from "../../../settings/UIFeature";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { TgNavigationContext } from "../telegram/TgNavigation";
import { rememberSettingsSearchText, setUserSettingsSection } from "../../../utils/userSettingsSection";
import { requestSettingsFocus } from "../../../utils/settingsFocus";
import { roomListPanelView, setRoomListPanelView } from "../../../utils/roomListPanelView";

describe("<UserSettingsList />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;

    const renderList = (handheld = false): ReturnType<typeof render> =>
        render(
            <TgNavigationContext.Provider value={{ handheld }}>
                <UserSettingsList />
            </TgNavigationContext.Provider>,
            clientAndSDKContextRenderOptions(client, sdkContext),
        );
    const names = (): string[] =>
        within(screen.getByRole("listbox", { name: "Settings" }))
            .getAllByRole("option")
            .map((button) => button.textContent ?? "");

    beforeEach(() => {
        vi.mocked(client.secretStorage.getDefaultKeyId).mockResolvedValue("key");
        SdkConfig.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => setUserSettingsSection(undefined));
        rememberSettingsSearchText("");
        setRoomListPanelView("rooms");
    });

    /* This test client has voip on and features in beta, so Voice & Video and Labs are there too. */
    it("lists the sections the settings dialog had, in its order", () => {
        renderList();
        expect(names()).toEqual([
            "Account",
            "Sessions",
            "Appearance",
            "Notifications",
            "Preferences",
            "Keyboard",
            "Sidebar",
            "Voice & Video",
            "Security & Privacy",
            "Encryption",
            "Labs",
            "Bridges",
            "Activity",
            "Storage",
            "Help & About",
        ]);
    });

    it("lists the sections only some setups have when they have them", () => {
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation((name: any, ...rest: any[]): any =>
            name === UIFeature.Voip || name === "feature_mjolnir" ? true : (getValue as any)(name, ...rest),
        );
        SdkConfig.put({ show_labs_settings: true });
        renderList();
        for (const name of ["Voice & Video", "Labs", "Ignored users"]) {
            expect(screen.getByRole("option", { name })).toBeInTheDocument();
        }
    });

    it("opens a section as navigation, with the section asked for", async () => {
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
        renderList();
        await userEvent.click(screen.getByRole("option", { name: "Appearance" }));
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings, initialTabId: UserTab.Appearance });
    });

    it("marks the section open beside it, and the first while none is asked for", () => {
        renderList();
        expect(screen.getByRole("option", { name: "Account" })).toHaveAttribute("aria-selected", "true");

        act(() => setUserSettingsSection(UserTab.Help));
        expect(screen.getByRole("option", { name: "Help & About" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("option", { name: "Account" })).toHaveAttribute("aria-selected", "false");
    });

    describe("keyboard", () => {
        it("has one stop in the tab order, on the open section, and moves with the arrows, Home and End", async () => {
            renderList();
            const option = (name: string): HTMLElement => screen.getByRole("option", { name });
            const stops = (): string[] =>
                screen
                    .getAllByRole("option")
                    .filter((o) => o.tabIndex === 0)
                    .map((o) => o.textContent ?? "");
            expect(stops()).toEqual(["Account"]);

            option("Account").focus();
            await userEvent.keyboard("{ArrowDown}");
            expect(option("Sessions")).toHaveFocus();
            expect(stops()).toEqual(["Sessions"]);
            await userEvent.keyboard("{ArrowUp}{ArrowUp}");
            expect(option("Account")).toHaveFocus();
            await userEvent.keyboard("{End}");
            expect(option("Help & About")).toHaveFocus();
            await userEvent.keyboard("{Home}");
            expect(option("Account")).toHaveFocus();
        });

        it("chooses with Enter and with Space", async () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            renderList();
            screen.getByRole("option", { name: "Appearance" }).focus();
            await userEvent.keyboard("{Enter}");
            expect(dispatch).toHaveBeenCalledWith({
                action: Action.ViewUserSettings,
                initialTabId: UserTab.Appearance,
            });
            dispatch.mockClear();
            await userEvent.keyboard(" ");
            expect(dispatch).toHaveBeenCalledTimes(1);
        });

        it("gives the focus back to a row when asked, as Escape out of its section does", () => {
            renderList();
            act(() => requestSettingsFocus(UserTab.Help));
            expect(screen.getByRole("option", { name: "Help & About" })).toHaveFocus();
        });

        it("takes a request made before it was there", () => {
            requestSettingsFocus("search");
            renderList();
            expect(screen.getByRole("combobox", { name: "Search settings" })).toHaveFocus();
        });
    });

    describe("search", () => {
        const search = async (text: string): Promise<void> => {
            await userEvent.type(screen.getByRole("combobox", { name: "Search settings" }), text);
        };

        it("finds a setting by its label and opens its section, asking for it to be shown", async () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            renderList();
            await search("previews");
            const option = await screen.findByRole("option", { name: "Enable previews Preferences" });
            expect(option).toHaveTextContent("Preferences");
            await userEvent.click(option);
            expect(dispatch).toHaveBeenCalledWith({
                action: Action.ViewUserSettings,
                initialTabId: UserTab.Preferences,
                props: { highlight: expect.stringContaining("previews") },
            });
        });

        it("walks the results with the arrows from the field, and Enter chooses the one pointed at", async () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            renderList();
            await search("timestamps");
            const field = screen.getByRole("combobox", { name: "Search settings" });
            const first = screen.getAllByRole("option")[0];
            expect(field).toHaveAttribute("aria-activedescendant", first.id);
            await userEvent.keyboard("{ArrowDown}");
            expect(field).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
            expect(field).toHaveFocus();
            await userEvent.keyboard("{Enter}");
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.ViewUserSettings, initialTabId: UserTab.Preferences }),
            );
        });

        it("says how many it found, politely, and when there are none", async () => {
            renderList();
            await search("timestamps");
            expect(screen.getByRole("status")).toHaveTextContent(/^\d+ results?$/);
            await search("zzzzqq");
            expect(screen.getByRole("status")).toHaveTextContent("No results");
            expect(screen.getByText("No settings match")).toBeInTheDocument();
        });

        it("clears with Escape, and the text is kept when the list is left and come back to", async () => {
            const { unmount } = renderList();
            await search("sessions");
            unmount();
            renderList();
            expect(screen.getByRole("combobox", { name: "Search settings" })).toHaveValue("sessions");
            await userEvent.click(screen.getByRole("combobox", { name: "Search settings" }));
            await userEvent.keyboard("{Escape}");
            expect(screen.getByRole("combobox", { name: "Search settings" })).toHaveValue("");
        });
    });

    it("goes back to the chats", async () => {
        setRoomListPanelView("settings");
        renderList();
        await userEvent.click(screen.getByRole("button", { name: "Back" }));
        expect(roomListPanelView()).toBe("rooms");
    });

    it("marks Encryption while recovery is not set up, until it is", async () => {
        vi.mocked(client.secretStorage.getDefaultKeyId).mockResolvedValue(null);
        renderList();
        const encryption = screen.getByRole("option", { name: "Encryption" });
        await waitFor(() => expect(encryption).toHaveAttribute("data-alert"));

        vi.mocked(client.secretStorage.getDefaultKeyId).mockResolvedValue("key");
        client.emit(ClientEvent.AccountData, new MatrixEvent({ type: "m.secret_storage.default_key" }));
        await waitFor(() => expect(encryption).not.toHaveAttribute("data-alert"));
    });

    describe("on a phone", () => {
        it("leaves out the keyboard shortcuts", () => {
            renderList(true);
            expect(screen.queryByRole("option", { name: "Keyboard" })).toBeNull();
        });

        /* Nothing is showing beside it: the list is the screen until a section is chosen. */
        it("marks nothing while no section is chosen", () => {
            renderList(true);
            expect(screen.queryByRole("option", { selected: true })).toBeNull();
        });
    });
});
