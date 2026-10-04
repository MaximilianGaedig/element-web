/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { type ReactElement } from "react";
import { vi, describe, it, expect, beforeEach, afterEach, type MockedObject } from "vitest";
import { act, fireEvent, render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import {
    clientAndSDKContextRenderOptions,
    getMockClientWithEventEmitter,
    mockClientMethodsUser,
    mockClientMethodsServer,
    mockPlatformPeg,
    mockClientMethodsCrypto,
    mockClientMethodsRooms,
    useMockMediaDevices,
    TestSDKContext,
} from "test-utils";
import { makeDelegatedAuthMetadata } from "test-utils/auth.ts";

import SettingsStore from "../../../settings/SettingsStore";
import SdkConfig from "../../../SdkConfig";
import { UserTab } from "../dialogs/UserTab";
import UserSettingsPage, { type UserSettingsPageProps } from "./UserSettingsPage";
import { UIFeature } from "../../../settings/UIFeature";
import { TgNavigationContext } from "../telegram/TgNavigation";
import { roomListPanelView, setRoomListPanelView } from "../../../utils/roomListPanelView";
import { onSettingsFocusRequest } from "../../../utils/settingsFocus";
import { setUserSettingsSection } from "../../../utils/userSettingsSection";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";

mockPlatformPeg({
    supportsSpellCheckSettings: vi.fn().mockReturnValue(false),
    getAppVersion: vi.fn().mockResolvedValue("1"),
});

vi.mock("../../../settings/SettingsStore", () => ({
    default: {
        getValue: vi.fn(),
        getValueAt: vi.fn(),
        canSetValue: vi.fn(),
        monitorSetting: vi.fn(),
        watchSetting: vi.fn(),
        unwatchSetting: vi.fn(),
        getFeatureSettingNames: vi.fn(),
        getBetaInfo: vi.fn(),
        getDisplayName: vi.fn(),
        getDescription: vi.fn(),
        shouldHaveWarning: vi.fn(),
        disabledMessage: vi.fn(),
        settingIsOveriddenAtConfigLevel: vi.fn(),
        doesSettingSupportLevel: vi.fn(),
    },
}));

// One section that can be made to fail, to see what that does to the rest of the settings.
const { keyboardTab } = vi.hoisted(() => ({ keyboardTab: { fails: false } }));
vi.mock("./tabs/user/KeyboardUserSettingsTab", () => ({
    default: () => {
        if (keyboardTab.fails) throw new Error("keyboard tab broke");
        return <div>Keyboard shortcuts</div>;
    },
}));

// The account section stands for any that closes the settings: it does once the account is deactivated.
vi.mock("./tabs/user/AccountUserSettingsTab", () => ({
    default: ({ closeSettingsFn }: { closeSettingsFn: () => void }) => (
        <button onClick={closeSettingsFn}>Close settings</button>
    ),
}));

describe("<UserSettingsPage />", () => {
    const userId = "@alice:server.org";
    const mockSettingsStore = vi.mocked(SettingsStore);
    let mockClient!: MockedObject<MatrixClient>;
    let sdkContext: TestSDKContext;

    const renderPage = (props: UserSettingsPageProps = {}, handheld = false): ReturnType<typeof render> => {
        const page: ReactElement = (
            <TgNavigationContext.Provider value={{ handheld, goBack: vi.fn() }}>
                <UserSettingsPage {...props} />
            </TgNavigationContext.Provider>
        );
        return render(page, clientAndSDKContextRenderOptions(mockClient, sdkContext));
    };
    // The page's own header; a failed section's error has a heading of its own.
    const title = (): string | null | undefined => document.getElementById("mx_UserSettingsPage_title")?.textContent;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = getMockClientWithEventEmitter({
            ...mockClientMethodsUser(userId),
            ...mockClientMethodsServer(),
            ...mockClientMethodsCrypto(),
            ...mockClientMethodsRooms(),
            getIgnoredUsers: vi.fn().mockResolvedValue([]),
            getPushers: vi.fn().mockResolvedValue([]),
            getProfileInfo: vi.fn().mockResolvedValue({}),
            getMediaConfig: vi.fn(),
            getAuthMetadata: vi.fn().mockResolvedValue(makeDelegatedAuthMetadata()),
            getSyncState: vi.fn().mockReturnValue("SYNCING"),
        });
        sdkContext = new TestSDKContext();
        sdkContext._client = mockClient;
        mockSettingsStore.getValue.mockReturnValue(false);
        mockSettingsStore.getValueAt.mockReturnValue(false);
        mockSettingsStore.getFeatureSettingNames.mockReturnValue([]);
        SdkConfig.reset();
        SdkConfig.put({ brand: "Test" });
    });

    afterEach(() => setRoomListPanelView("rooms"));

    it("keeps the other sections reachable when one fails", () => {
        keyboardTab.fails = true;
        vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { rerender } = renderPage({ section: UserTab.Keyboard });

            // The failed section says so in its place, under its own header.
            expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
            expect(title()).toEqual("Keyboard");

            // ...and another section opens as usual, not as the failure of the one before.
            rerender(
                <TgNavigationContext.Provider value={{ handheld: false }}>
                    <UserSettingsPage section={UserTab.Help} />
                </TgNavigationContext.Provider>,
            );
            expect(title()).toEqual("Help & About");
            expect(screen.queryByText("Something went wrong!")).toBeNull();
        } finally {
            keyboardTab.fails = false;
        }
    });

    it("shows the account when no section is asked for", () => {
        renderPage();
        expect(title()).toEqual("Account");
    });

    it("shows the section asked for", () => {
        renderPage({ section: UserTab.Help });
        expect(title()).toEqual("Help & About");
    });

    it("shows the account when the section asked for does not exist in this setup", () => {
        // The ignored users are only there with their lab on.
        renderPage({ section: UserTab.Mjolnir });
        expect(title()).toEqual("Account");
    });

    it.each([
        [UserTab.SessionManager, "Sessions"],
        [UserTab.Appearance, "Appearance"],
        [UserTab.Notifications, "Notifications"],
        [UserTab.Preferences, "Preferences"],
        [UserTab.Sidebar, "Sidebar"],
        [UserTab.Security, "Security & Privacy"],
    ])("shows %s under its own name", (section, name) => {
        renderPage({ section });
        expect(title()).toEqual(name);
    });

    it("shows voice and video when voip is on", () => {
        useMockMediaDevices();
        mockSettingsStore.getValue.mockImplementation((settingName: any): any => settingName === UIFeature.Voip);
        renderPage({ section: UserTab.Voice });
        expect(title()).toEqual("Voice & Video");
    });

    it("shows labs when show_labs_settings is on", () => {
        SdkConfig.add({ show_labs_settings: true });
        renderPage({ section: UserTab.Labs });
        expect(title()).toEqual("Labs");
    });

    it("shows the ignored users when their lab is on", () => {
        mockSettingsStore.getValue.mockImplementation((settingName): any => settingName === "feature_mjolnir");
        renderPage({ section: UserTab.Mjolnir });
        expect(title()).toEqual("Ignored users");
    });

    /* There is nothing to close: it is a page, and no dialog chrome comes with it. */
    it("has no close button", () => {
        renderPage({ section: UserTab.Help });
        expect(screen.queryByRole("button", { name: "Close dialog" })).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    describe("on a phone", () => {
        /* Until a section is chosen, the list of them is the screen. */
        it("shows nothing while no section is chosen", () => {
            const { container } = renderPage({}, true);
            expect(container).toBeEmptyDOMElement();
        });

        it("shows the section chosen with the way back to the list", () => {
            renderPage({ section: UserTab.Help }, true);
            expect(title()).toEqual("Help & About");
            expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
        });

        /* The column with the bar is behind the section: without its own, there would be no way to the chats. */
        it("keeps the navigation bar available with a section open, as on the list", async () => {
            setRoomListPanelView("settings");
            renderPage({ section: UserTab.Help }, true);
            const bar = screen.getByRole("navigation", { name: "Chats, people, calls and settings" });
            for (const name of ["Messages", "People", "Calls", "Settings"]) {
                expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
            }
            expect(within(bar).getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
            await userEvent.click(within(bar).getByRole("button", { name: "Calls" }));
            expect(roomListPanelView()).toBe("calls");
        });

        it("has the settings button go to the list of sections from a section", async () => {
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            setRoomListPanelView("settings");
            act(() => setUserSettingsSection(UserTab.Help));
            renderPage({ section: UserTab.Help }, true);
            await userEvent.click(screen.getByRole("button", { name: "Settings" }));
            expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings });
            act(() => setUserSettingsSection(undefined));
        });

        it("has no navigation bar beside the list on a desktop, where the column has it", () => {
            renderPage({ section: UserTab.Help }, false);
            expect(screen.queryByRole("navigation")).toBeNull();
        });
    });

    describe("keyboard", () => {
        it("moves the focus to the section's name when one opens", () => {
            renderPage({ section: UserTab.Help });
            expect(screen.getByRole("heading", { name: "Help & About" })).toHaveFocus();
        });

        it("gives the focus back to the list's row for the section on Escape", async () => {
            const asked = vi.fn();
            const stop = onSettingsFocusRequest(asked);
            renderPage({ section: UserTab.Help });
            await userEvent.keyboard("{Escape}");
            expect(asked).toHaveBeenCalledWith(UserTab.Help);
            stop();
        });

        it("also goes back a screen on a phone", async () => {
            const goBack = vi.fn();
            render(
                <TgNavigationContext.Provider value={{ handheld: true, goBack }}>
                    <UserSettingsPage section={UserTab.Help} />
                </TgNavigationContext.Provider>,
                clientAndSDKContextRenderOptions(mockClient, sdkContext),
            );
            await userEvent.keyboard("{Escape}");
            expect(goBack).toHaveBeenCalledTimes(1);
        });

        it("leaves Escape to a control that has already used it", () => {
            const asked = vi.fn();
            // Whatever an earlier test left unclaimed is taken first, and is not what is being asked.
            const stop = onSettingsFocusRequest(asked);
            asked.mockClear();
            renderPage({ section: UserTab.Help });
            const heading = screen.getByRole("heading", { name: "Help & About" });
            // Something under the page that used the key, as a menu closing itself does.
            heading.addEventListener("keydown", (event) => event.preventDefault());
            fireEvent.keyDown(heading, { key: "Escape" });
            expect(asked).not.toHaveBeenCalled();
            stop();
        });
    });

    /* Switching to the chats and back unmounts the page: where it was scrolled is what comes back. */
    it("scrolls a section back to where it was left", () => {
        const first = renderPage({ section: UserTab.Help });
        const body = (): HTMLElement => document.querySelector(".mx_UserSettingsPage_body")!;
        body().scrollTop = 120;
        fireEvent.scroll(body());
        first.unmount();

        renderPage({ section: UserTab.Help });
        expect(body().scrollTop).toBe(120);
    });

    /* "Close the settings", from inside a section (the account, once it is deactivated), leaves them. */
    it("leaves the settings when a section closes them", async () => {
        setRoomListPanelView("settings");
        renderPage({ section: UserTab.Account });
        await userEvent.click(screen.getByRole("button", { name: "Close settings" }));
        expect(roomListPanelView()).toBe("rooms");
    });
});
