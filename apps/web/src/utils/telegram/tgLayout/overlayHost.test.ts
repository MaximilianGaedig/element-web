/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { getOverlayHost } from "./overlayHost";

const ids = (): string[] => [...document.body.children].map((child) => child.id);

const addContainers = (...containerIds: string[]): void => {
    for (const id of containerIds) {
        const container = document.createElement("div");
        container.id = id;
        document.body.appendChild(container);
    }
};

describe("getOverlayHost", () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it("sits above the app and the persisted widgets, below the dialogs and the menus", () => {
        // The order index.html declares.
        addContainers(
            "matrixchat",
            "mx_PersistedElement_container",
            "mx_Dialog_StaticContainer",
            "mx_Dialog_Container",
            "mx_ContextualMenu_Container",
        );

        getOverlayHost();

        expect(ids()).toEqual([
            "matrixchat",
            "mx_PersistedElement_container",
            "mx_TgOverlay_Container",
            "mx_Dialog_StaticContainer",
            "mx_Dialog_Container",
            "mx_ContextualMenu_Container",
        ]);
    });

    it("goes under whichever of those containers comes first when some are missing", () => {
        addContainers("matrixchat", "mx_Dialog_Container", "mx_ContextualMenu_Container");

        getOverlayHost();

        expect(ids()).toEqual([
            "matrixchat",
            "mx_TgOverlay_Container",
            "mx_Dialog_Container",
            "mx_ContextualMenu_Container",
        ]);
    });

    it("goes to the end when no dialog or menu has been opened yet", () => {
        addContainers("matrixchat");

        getOverlayHost();

        expect(ids()).toEqual(["matrixchat", "mx_TgOverlay_Container"]);
    });

    it("is made once", () => {
        addContainers("matrixchat", "mx_Dialog_Container");

        const host = getOverlayHost();

        expect(getOverlayHost()).toBe(host);
        expect(document.querySelectorAll("#mx_TgOverlay_Container")).toHaveLength(1);
    });
});
