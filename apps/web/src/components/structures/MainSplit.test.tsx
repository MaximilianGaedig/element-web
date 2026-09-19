/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import React from "react";
import { act, render, fireEvent } from "test-utils-rtl";

import MainSplit from "./MainSplit";
import { PosthogAnalytics } from "../../PosthogAnalytics.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import SettingsStore from "../../settings/SettingsStore";

describe("<MainSplit/>", () => {
    const children = (
        <div>
            Child<span>Foo</span>Bar
        </div>
    );
    const panel = <div>Right panel</div>;
    let sdkContext: SDKContextClass;

    beforeEach(() => {
        localStorage.clear();
        sdkContext = new SDKContextClass();
        // Element's layout unless a test opts into the fork's Telegram-style one (on by default).
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: any[]) =>
            name === "telegramStyleLayout" ? false : (getValue as any)(name, ...rest)) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders", () => {
        const { asFragment, container } = render(
            <MainSplit children={children} panel={panel} analyticsRoomType="other_room" />,
        );
        expect(asFragment()).toMatchSnapshot();
        // Assert it matches the default width of 320
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("320px");
    });

    it("respects defaultSize prop", () => {
        const { asFragment, container } = render(
            <MainSplit children={children} panel={panel} defaultSize={500} analyticsRoomType="other_room" />,
        );
        expect(asFragment()).toMatchSnapshot();
        // Assert it matches the default width of 350
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("500px");
    });

    it("prefers size stashed in LocalStorage to the defaultSize prop", () => {
        localStorage.setItem("mx_rhs_size_thread", "333");
        const { container } = render(
            <MainSplit
                children={children}
                panel={panel}
                sizeKey="thread"
                defaultSize={400}
                analyticsRoomType="other_room"
            />,
        );
        expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.style.width).toBe("333px");
    });

    it("should report to analytics on resize stop", () => {
        const { container } = render(
            <MainSplit
                children={children}
                panel={panel}
                sizeKey="thread"
                defaultSize={400}
                analyticsRoomType="other_room"
            />,
            { wrapper: ({ children }) => <SDKContext.Provider value={sdkContext}>{children}</SDKContext.Provider> },
        );

        const spy = vi.spyOn(PosthogAnalytics.instance, "trackEvent");

        const handle = container.querySelector(".mx_ResizeHandle--horizontal")!;
        expect(handle).toBeInTheDocument();
        fireEvent.mouseDown(handle);
        fireEvent.resize(handle, { clientX: 0 });
        fireEvent.mouseUp(handle);

        expect(spy).toHaveBeenCalledWith({
            eventName: "WebPanelResize",
            panel: "right",
            roomType: "other_room",
            size: 400,
        });
    });

    describe("in the Telegram-style layout", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.mocked(SettingsStore.getValue).mockImplementation(((name: string) =>
                name === "telegramStyleLayout" ? true : undefined) as any);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const wrapper = ({ children }: { children: React.ReactNode }): React.ReactNode => (
            <SDKContext.Provider value={sdkContext}>{children}</SDKContext.Provider>
        );

        it("slides the panel in over tweb's 300ms without animating the first render", () => {
            const { container, rerender } = render(
                <MainSplit children={children} panel={panel} collapsedRhs analyticsRoomType="other_room" />,
                { wrapper },
            );
            expect(container.querySelector(".mx_RightPanel_ResizeWrapper")).toBeNull();

            rerender(<MainSplit children={children} panel={panel} analyticsRoomType="other_room" />);
            const pane = container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!;
            expect(pane.dataset.tgPane).toBe("in");
            expect(pane.style.getPropertyValue("--MainSplit-panel-width")).toBe("320px");
            act(() => void vi.advanceTimersByTime(300));
            expect(pane.dataset.tgPane).toBeUndefined();
        });

        it("keeps the closed panel for tweb's 250ms slide-out", () => {
            const { container, rerender, getByText } = render(
                <MainSplit children={children} panel={panel} analyticsRoomType="other_room" />,
                { wrapper },
            );
            expect(
                container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.dataset.tgPane,
            ).toBeUndefined();

            rerender(<MainSplit children={children} panel={panel} collapsedRhs analyticsRoomType="other_room" />);
            expect(container.querySelector<HTMLElement>(".mx_RightPanel_ResizeWrapper")!.dataset.tgPane).toBe("out");
            expect(getByText("Right panel")).toBeTruthy();
            act(() => void vi.advanceTimersByTime(250));
            expect(container.querySelector(".mx_RightPanel_ResizeWrapper")).toBeNull();
        });
    });
});
