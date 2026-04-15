/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { test as base, expect } from "../../element-web-test";

const test = base.extend<{
    room: { roomId: string };
}>({
    room: async ({ app, user }, use) => {
        const roomId = await app.client.createRoom({ name: "Test Room" });
        await use({ roomId });
    },
});

test.describe("Message Selection", () => {
    test.use({
        displayName: "Alice",
        botCreateOpts: { displayName: "Bob" },
    });

    test.beforeEach(async ({ page, app, room, bot }) => {
        await page.goto(`#/room/${room.roomId}`);

        // Wait for the room to be loaded
        await expect(page.locator(".mx_RoomHeader_heading")).toContainText("Test Room");

        // Alice sends 5 messages via API for speed
        for (let i = 1; i <= 5; i++) {
            await app.client.sendMessage(room.roomId, `Message ${i}`);
        }

        // Bob joins and sends 5 messages via API
        const botUserId = await bot.evaluate((cli) => cli.getUserId());
        await app.client.inviteUser(room.roomId, botUserId);
        await bot.joinRoom(room.roomId);
        for (let i = 6; i <= 10; i++) {
            await bot.sendMessage(room.roomId, `Message ${i}`);
        }

        // Wait for messages to appear
        await expect(page.locator(".mx_EventTile_body").filter({ hasText: /^Message 1$/ })).toBeVisible();
        await expect(page.locator(".mx_EventTile_body").filter({ hasText: /^Message 10$/ })).toBeVisible();
    });

    test("should bulk delete exactly the selected messages", async ({ page }) => {
        // Enter selection mode via Message 1
        await page
            .locator(".mx_EventTile_body")
            .filter({ hasText: /^Message 1$/ })
            .click({ button: "right", force: true });
        await page.locator(".mx_IconizedContextMenu_item", { hasText: "Select messages" }).click({ force: true });

        // Select Messages 3, 5, 7, 9
        for (const i of [3, 5, 7, 9]) {
            await page
                .locator(".mx_EventTile_body")
                .filter({ hasText: new RegExp(`^Message ${i}$`) })
                .click({ force: true });
        }

        await expect(page.locator(".mx_BulkActionsBar_count")).toHaveText("5 messages selected");

        // Click delete
        await page.locator(".mx_BulkActionsBar_action", { hasText: "Remove" }).click({ force: true });

        // Confirm in dialog
        const confirmButton = page.locator(".mx_Dialog_primary", { hasText: "Remove" });
        await expect(confirmButton).toBeVisible();
        await confirmButton.click({ force: true });

        // Wait for BulkActionsBar to disappear, indicating process finished
        await expect(page.locator(".mx_BulkActionsBar")).not.toBeVisible({ timeout: 20000 });

        // Selected messages (1, 3, 5, 7, 9) should be redacted/gone
        for (const i of [1, 3, 5, 7, 9]) {
            await expect(
                page.locator(".mx_EventTile_body").filter({ hasText: new RegExp(`^Message ${i}$`) }),
            ).not.toBeVisible();
        }

        // Other messages should still be visible
        for (const i of [2, 4, 6, 8, 10]) {
            await expect(
                page.locator(".mx_EventTile_body").filter({ hasText: new RegExp(`^Message ${i}$`) }),
            ).toBeVisible();
        }
    });

    test("should bulk forward exactly the selected messages and show correct senders in preview", async ({
        page,
        app,
        bot,
        room,
    }) => {
        const destRoomId = await app.client.createRoom({ name: "Destination Room" });

        // Select Alice's message 2 and Bob's message 7
        await page
            .locator(".mx_EventTile_body")
            .filter({ hasText: /^Message 2$/ })
            .click({ button: "right", force: true });
        await page.locator(".mx_IconizedContextMenu_item", { hasText: "Select messages" }).click({ force: true });
        await page
            .locator(".mx_EventTile_body")
            .filter({ hasText: /^Message 7$/ })
            .click({ force: true });

        // Click forward
        await page.locator(".mx_BulkActionsBar_action", { hasText: "Forward" }).click({ force: true });

        // Check dialog title
        await expect(page.locator(".mx_Dialog_title")).toHaveText("Forward 2 messages");

        // Verify senders in preview
        const preview = page.locator(".mx_ForwardDialog_preview");
        await expect(preview.locator(".mx_EventTile", { hasText: /Alice: Message 2/ })).toBeVisible();
        await expect(preview.locator(".mx_EventTile", { hasText: /Bob: Message 7/ })).toBeVisible();

        // Forward to Destination Room
        const entry = page.locator(".mx_ForwardList_entry", { hasText: "Destination Room" });
        await entry.locator(".mx_ForwardList_sendButton").click({ force: true });
        await expect(entry.locator(".mx_ForwardList_sendButton")).toHaveClass(/mx_ForwardList_sent/);

        // Close dialog
        await page.getByRole("button", { name: "Close dialog" }).click({ force: true });
        await expect(page.locator(".mx_ForwardDialog")).not.toBeVisible();

        // Check in Destination Room
        await page.goto(`#/room/${destRoomId}`);
        await expect(page.locator(".mx_RoomHeader_heading")).toContainText("Destination Room");

        // Verify messages are there and have mentions (links)
        const aliceMsg = page.locator(".mx_EventTile_body").filter({ hasText: "Alice: Message 2" });
        await expect(aliceMsg).toBeVisible();
        await expect(aliceMsg.locator("a")).toHaveAttribute("href", /matrix\.to\/#\/@user_/);

        const bobMsg = page.locator(".mx_EventTile_body").filter({ hasText: "Bob: Message 7" });
        await expect(bobMsg).toBeVisible();
        await expect(bobMsg.locator("a")).toHaveAttribute("href", /matrix\.to\/#\/@bot_/);
    });

    test("should maintain selection state per room and switch rooms cleanly", async ({ page, app, room }) => {
        const otherRoomId = await app.client.createRoom({ name: "Other Room" });

        // Enter selection mode in Test Room via Message 1
        const msg1Tile = page.locator(".mx_EventTile").filter({
            has: page.locator(".mx_EventTile_body", { hasText: /^Message 1$/ }),
        });

        await msg1Tile.locator(".mx_EventTile_body").click({ button: "right", force: true });
        await page.locator(".mx_IconizedContextMenu_item", { hasText: "Select messages" }).click({ force: true });

        // Verify highlight class is present on Message 1
        await expect(msg1Tile).toHaveClass(/mx_EventTile_selected/);
        // Verify selection checkbox is visible (replaces timestamp)
        await expect(msg1Tile.locator(".mx_EventTile_selectionCheckbox")).toBeVisible();

        // Switch to Other Room
        await page.goto(`#/room/${otherRoomId}`);
        await expect(page.locator(".mx_RoomHeader_heading")).toContainText("Other Room");

        // Verify BulkActionsBar is NOT visible in Other Room
        await expect(page.locator(".mx_BulkActionsBar")).not.toBeVisible();

        // Switch back to Test Room
        await page.goto(`#/room/${room.roomId}`);
        await expect(page.locator(".mx_RoomHeader_heading")).toContainText("Test Room");

        // Verify BulkActionsBar is visible again and selection is preserved
        await expect(page.locator(".mx_BulkActionsBar")).toBeVisible();
        await expect(page.locator(".mx_BulkActionsBar_count")).toHaveText("1 message selected");
        await expect(msg1Tile).toHaveClass(/mx_EventTile_selected/);
    });

    test("should support range selection with Shift+Click", async ({ page }) => {
        // Enter selection mode via Message 1
        const msg1Tile = page.locator(".mx_EventTile").filter({
            has: page.locator(".mx_EventTile_body", { hasText: /^Message 1$/ }),
        });
        await msg1Tile.locator(".mx_EventTile_body").click({ button: "right", force: true });
        await page.locator(".mx_IconizedContextMenu_item", { hasText: "Select messages" }).click({ force: true });

        // Shift+Click on Message 5
        await page
            .locator(".mx_EventTile_body")
            .filter({ hasText: /^Message 5$/ })
            .click({ modifiers: ["Shift"], force: true });

        // Messages 1 through 5 should be selected
        await expect(page.locator(".mx_BulkActionsBar_count")).toHaveText("5 messages selected");
        for (let i = 1; i <= 5; i++) {
            const tile = page.locator(".mx_EventTile").filter({
                has: page.locator(".mx_EventTile_body", { hasText: new RegExp(`^Message ${i}$`) }),
            });
            await expect(tile).toHaveClass(/mx_EventTile_selected/);
        }
    });

    test("should support range selection starting from a timestamp click and expanding", async ({ page }) => {
        // Click timestamp of Message 1 (normal interaction, not selecting yet)
        const msg1Tile = page.locator(".mx_EventTile").filter({
            has: page.locator(".mx_EventTile_body", { hasText: /^Message 1$/ }),
        });
        await msg1Tile.hover();
        await msg1Tile.locator(".mx_MessageTimestamp").click({ force: true });

        // Shift+Click on Message 3 body
        const msg3Tile = page.locator(".mx_EventTile").filter({
            has: page.locator(".mx_EventTile_body", { hasText: /^Message 3$/ }),
        });
        await msg3Tile.locator(".mx_EventTile_body").click({ modifiers: ["Shift"], force: true });

        // Selection mode should be active and Messages 1, 2, 3 selected
        await expect(page.locator(".mx_BulkActionsBar_count")).toHaveText("3 messages selected");

        // Shift+Click on Message 5 body (should expand range from 1 to 5)
        const msg5Tile = page.locator(".mx_EventTile").filter({
            has: page.locator(".mx_EventTile_body", { hasText: /^Message 5$/ }),
        });
        await msg5Tile.locator(".mx_EventTile_body").click({ modifiers: ["Shift"], force: true });

        await expect(page.locator(".mx_BulkActionsBar_count")).toHaveText("5 messages selected");
        for (let i = 1; i <= 5; i++) {
            const tile = page.locator(".mx_EventTile").filter({
                has: page.locator(".mx_EventTile_body", { hasText: new RegExp(`^Message ${i}$`) }),
            });
            await expect(tile).toHaveClass(/mx_EventTile_selected/);
        }
    });
});
