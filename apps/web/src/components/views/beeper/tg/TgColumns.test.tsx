/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "test-utils-rtl";

import UIStore from "../../../../stores/UIStore";
import ResizeNotifier from "../../../../utils/ResizeNotifier";
import { TgColumns } from "./TgColumns";
import { STORAGE_KEY_LEFT } from "../../../../utils/beeper/tgLayout/constants";

function setViewport(width: number, height: number): void {
    UIStore.instance.windowWidth = width;
    UIStore.instance.windowHeight = height;
}

function renderColumns(): ReturnType<typeof render> {
    return render(
        <TgColumns
            spacePanel={<div>spaces</div>}
            leftPanel={<div>chat list</div>}
            resizeNotifier={new ResizeNotifier()}
        >
            <div>room</div>
        </TgColumns>,
    );
}

describe("TgColumns", () => {
    const initialWidth = UIStore.instance.windowWidth;
    const initialHeight = UIStore.instance.windowHeight;

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        setViewport(initialWidth, initialHeight);
    });

    it("renders the docked layout with tweb's default width at 1440×900", () => {
        setViewport(1440, 900);
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.screen).toBe("large");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("360px");
        expect(screen.getByText("chat list")).toBeTruthy();
        expect(screen.getByText("room")).toBeTruthy();
        expect(screen.getByTestId("tg-resize-handle")).toBeTruthy();
    });

    it("restores a persisted width and the collapsed state", () => {
        setViewport(1440, 900);
        localStorage.setItem(STORAGE_KEY_LEFT, "420");
        const { container, unmount } = renderColumns();
        expect(
            container.querySelector<HTMLElement>(".mx_TgColumns")!.style.getPropertyValue("--TgColumns-left-width"),
        ).toBe("420px");
        unmount();

        localStorage.setItem(STORAGE_KEY_LEFT, "0");
        const { container: collapsed } = renderColumns();
        const root = collapsed.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.collapsed).toBe("true");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("80px");
    });

    it("drags the edge, snaps to the avatars column below the threshold and persists", () => {
        setViewport(1440, 900);
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        const handle = screen.getByTestId("tg-resize-handle");

        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 360 });
        expect(root.dataset.resizing).toBe("true");

        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("400px");
        expect(root.dataset.collapsed).toBeUndefined();

        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
        expect(root.dataset.collapsed).toBe("true");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("80px");

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });
        expect(root.dataset.resizing).toBeUndefined();
        expect(localStorage.getItem(STORAGE_KEY_LEFT)).toBe("0");
    });

    it("has no resize handle and ignores the collapsed preference in the floating range", () => {
        setViewport(800, 900);
        localStorage.setItem(STORAGE_KEY_LEFT, "0");
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.screen).toBe("medium");
        expect(root.dataset.collapsed).toBeUndefined();
        expect(screen.queryByTestId("tg-resize-handle")).toBeNull();
    });
});
