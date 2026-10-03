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
import { setUserSettingsSection } from "../../../utils/userSettingsSection";
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
        within(screen.getByRole("list", { name: "Settings" }))
            .getAllByRole("button")
            .map((button) => button.textContent ?? "");

    beforeEach(() => {
        vi.mocked(client.secretStorage.getDefaultKeyId).mockResolvedValue("key");
        SdkConfig.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        act(() => setUserSettingsSection(undefined));
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
            expect(screen.getByRole("button", { name })).toBeInTheDocument();
        }
    });

    it("opens a section as navigation, with the section asked for", async () => {
        const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
        renderList();
        await userEvent.click(screen.getByRole("button", { name: "Appearance" }));
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings, initialTabId: UserTab.Appearance });
    });

    it("marks the section open beside it, and the first while none is asked for", () => {
        renderList();
        expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("aria-current", "page");

        act(() => setUserSettingsSection(UserTab.Help));
        expect(screen.getByRole("button", { name: "Help & About" })).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("button", { name: "Account" })).not.toHaveAttribute("aria-current");
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
        const encryption = screen.getByRole("button", { name: "Encryption" });
        await waitFor(() => expect(encryption).toHaveAttribute("data-alert"));

        vi.mocked(client.secretStorage.getDefaultKeyId).mockResolvedValue("key");
        client.emit(ClientEvent.AccountData, new MatrixEvent({ type: "m.secret_storage.default_key" }));
        await waitFor(() => expect(encryption).not.toHaveAttribute("data-alert"));
    });

    describe("on a phone", () => {
        it("leaves out the keyboard shortcuts", () => {
            renderList(true);
            expect(screen.queryByRole("button", { name: "Keyboard" })).toBeNull();
        });

        /* Nothing is showing beside it: the list is the screen until a section is chosen. */
        it("marks nothing while no section is chosen", () => {
            renderList(true);
            expect(screen.queryByRole("button", { current: "page" })).toBeNull();
        });
    });
});
