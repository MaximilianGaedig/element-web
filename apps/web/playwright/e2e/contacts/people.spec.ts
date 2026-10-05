/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type AccountDataEvents } from "matrix-js-sdk/src/matrix";

import { test, expect } from "../../element-web-test";

test.describe("People", () => {
    test.use({
        displayName: "Alice",
        botCreateOpts: { displayName: "BotBob", autoAcceptInvites: true },
    });

    // The list draws only the rows on screen; a zero-height row above them once stopped it drawing any at all.
    test("lists the people you have direct chats with, under your own card and the bar", async ({ page, app, bot }) => {
        const botUserId = bot.credentials!.userId;
        await app.client.evaluate(async (cli, botUserId) => {
            const { room_id: dmRoomId } = await cli.createRoom({ is_direct: true, invite: [botUserId] });
            await cli.setAccountData("m.direct" as keyof AccountDataEvents, { [botUserId]: [dmRoomId] });
        }, botUserId);
        await expect(page.getByRole("button", { name: /Open room BotBob/ }).first()).toBeVisible();

        await page.locator(".mx_RoomListPill_entry", { hasText: "People" }).click();

        const people = page.locator(".mx_ContactsView");
        await expect(people.locator(".mx_Contacts_me")).toBeVisible();
        await expect(people.locator(".mx_Contacts_row", { hasText: "BotBob" })).toBeVisible();

        // The bar floats over the column's foot: the list goes on under it, not stopping above it in a blank band.
        const list = await people.locator("[data-testid=virtuoso-scroller]").boundingBox();
        const bar = await page.locator(".mx_RoomListPill").boundingBox();
        expect(list!.y + list!.height).toBeGreaterThanOrEqual(bar!.y + bar!.height);
    });
});
