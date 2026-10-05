/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Page } from "@playwright/test";

import { test, expect } from "../../element-web-test";

/** The message texts the Stream shows, top to bottom. */
function streamBodies(page: Page): Promise<string[]> {
    return page.locator(".mx_StreamPage .mx_EventTile_body").allInnerTexts();
}

/** The chat names on the Stream's run bars, top to bottom. */
function streamBars(page: Page): Promise<string[]> {
    return page.locator(".mx_StreamPage_recipientName").allInnerTexts();
}

/** Clears the toasts this fork shows over the chat list's header (device verification, notifications). */
async function dismissToasts(page: Page): Promise<void> {
    const toast = page.locator(".mx_ToastContainer .mx_Toast_toast");
    await expect(toast.first()).toBeVisible();
    while ((await toast.count()) > 0) {
        await toast
            .first()
            .getByRole("button", { name: /^(Later|Dismiss)$/ })
            .click();
    }
}

/** Opens the Stream from its button above the chats. */
async function openStream(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Stream: every chat in one list" }).click();
    await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
}

test.describe("Stream", () => {
    test.use({
        displayName: "Alice",
        labsFlags: ["feature_stream"],
    });

    test("merges the chats by time, each run under its chat, and new messages arrive", async ({ page, app, user }) => {
        const garden = await app.client.createRoom({ name: "Garden" });
        const kitchen = await app.client.createRoom({ name: "Kitchen" });
        await app.client.sendMessage(garden, "first in the garden");
        await app.client.sendMessage(kitchen, "then the kitchen");
        await app.client.sendMessage(garden, "back in the garden");

        await dismissToasts(page);
        await openStream(page);

        await expect
            .poll(() => streamBodies(page))
            .toEqual(["first in the garden", "then the kitchen", "back in the garden"]);
        expect(await streamBars(page)).toEqual(["Garden", "Kitchen", "Garden"]);

        // A message arriving while the Stream is open joins the end of it.
        await app.client.sendMessage(kitchen, "a new one from the kitchen");
        await expect.poll(async () => (await streamBodies(page)).at(-1)).toBe("a new one from the kitchen");
    });

    test("opens a chat from its bar, and a reply opens the message's chat with the reply set", async ({
        page,
        app,
        user,
    }) => {
        const garden = await app.client.createRoom({ name: "Garden" });
        const kitchen = await app.client.createRoom({ name: "Kitchen" });
        await app.client.sendMessage(garden, "tomatoes are ripe");
        await app.client.sendMessage(kitchen, "the oven is on");

        await dismissToasts(page);
        await openStream(page);

        await page.locator(".mx_StreamPage").getByRole("button", { name: "Kitchen" }).click();
        await expect(page.locator(".mx_RoomHeader").getByText("Kitchen")).toBeVisible();

        await openStream(page);
        const tile = page.locator(".mx_StreamPage .mx_EventTile", { hasText: "tomatoes are ripe" });
        await tile.hover();
        await tile.getByRole("button", { name: "Reply", exact: true }).click();

        // The reply goes to the chat the message is in: it opens, with the message quoted in its composer.
        await expect(page.locator(".mx_RoomHeader").getByText("Garden")).toBeVisible();
        await expect(page.locator(".mx_ReplyPreview")).toContainText("tomatoes are ripe");
    });

    test("pages back a busy chat to place a quiet chat's older message", async ({ page, app, user }) => {
        // Seeding this many messages takes a while.
        test.slow();
        const quiet = await app.client.createRoom({ name: "Quiet" });
        const busy = await app.client.createRoom({ name: "Busy" });
        await app.client.sendMessage(quiet, "the quiet chat's only message");
        for (let i = 1; i <= 70; i++) await app.client.sendMessage(busy, `busy ${i}`);

        await page.goto("/#/stream");
        await expect.poll(async () => (await streamBodies(page)).at(-1)).toBe("busy 70");

        // Older than everything the busy chat had loaded: it can only be placed once that chat is paged back.
        const scroller = page.locator(".mx_StreamPage_timeline");
        await scroller.hover();
        await expect
            .poll(
                async () => {
                    await page.mouse.wheel(0, -5000);
                    return (await streamBodies(page)).includes("the quiet chat's only message");
                },
                { timeout: 30000 },
            )
            .toBe(true);

        const bodies = await streamBodies(page);
        expect(bodies.indexOf("the quiet chat's only message")).toBeLessThan(
            bodies.findIndex((body) => body.startsWith("busy")),
        );
    });

    test.describe("read receipts", () => {
        test.use({ botCreateOpts: { displayName: "BotBob", autoAcceptInvites: true } });

        test("marks a chat read once its message has been on screen with the list at rest", async ({
            page,
            app,
            user,
            bot,
        }) => {
            const garden = await app.client.createRoom({ name: "Garden" });
            await app.client.inviteUser(garden, bot.credentials!.userId);
            await bot.joinRoom(garden);
            const { event_id: said } = await bot.sendMessage(garden, "the tomatoes are ripe");

            await dismissToasts(page);
            await openStream(page);
            await expect(
                page.locator(".mx_StreamPage .mx_EventTile", { hasText: "the tomatoes are ripe" }),
            ).toBeVisible();

            // The reader's receipt in the room moves to the message read in the Stream.
            await expect
                .poll(() =>
                    page.evaluate(
                        ({ roomId, userId }) =>
                            window.mxMatrixClientPeg.get()!.getRoom(roomId)!.getEventReadUpTo(userId, true),
                        { roomId: garden, userId: user.userId },
                    ),
                )
                .toBe(said);
        });
    });
});
