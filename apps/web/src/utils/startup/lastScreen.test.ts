/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ENCRYPTED_ROW_ATTRIBUTE,
    LAST_SCREEN_ID,
    type LastScreen,
    buildOf,
    captureLastScreen,
    clearLastScreen,
    hideLastScreen,
    hideLastScreenAfterFirstEvent,
    isLastScreenShown,
    isLikeness,
    loadLastScreen,
    sanitizeScreen,
    saveLastScreen,
    showLastScreen,
    showLastScreenAtBoot,
} from "./lastScreen";
import { keepLastScreen } from "./keepLastScreen";

const APP = `
<div class="mx_MatrixChat">
  <div class="list">
    <div class="mx_RoomListItemView" id="plain">
      <span style="display:none"></span>
      <div><div data-testid="room-name">Ada</div><div title="see you at eight">see you at eight</div></div>
    </div>
    <div class="mx_RoomListItemView" id="secret">
      <span style="display:none" ${ENCRYPTED_ROW_ATTRIBUTE}=""></span>
      <div><div data-testid="room-name">Grace</div><div title="the code is 4471">the code is 4471</div></div>
    </div>
  </div>
  <div class="mx_RoomView_kept" data-active="true">
    <div class="mx_RoomView">
      <div class="timeline" id="timeline">
        <div data-event-id="$1">hello</div>
        <div data-event-id="$2"><img id="held" src="blob:https://x/1"><img id="served" src="https://x/media/a"></div>
      </div>
      <iframe src="https://widget.example"></iframe>
    </div>
  </div>
  <div class="mx_RoomView_kept" data-active="false"><div class="mx_RoomView"><div data-event-id="$9">behind</div></div></div>
</div>`;

function page(build = "abc123"): void {
    document.head.innerHTML = `
        <link rel="stylesheet" href="bundles/${build}/bundle.css">
        <link rel="stylesheet" disabled data-mx-theme="Light" href="bundles/${build}/theme-light.css">
        <link rel="stylesheet" data-mx-theme="Dark" href="bundles/${build}/theme-dark.css">`;
    document.body.innerHTML = `<div id="matrixchat"></div>`;
}

/** The window, by the name the module knows it by: the size is read off the document's own view. */
const view = document.defaultView!;

const screenOf = (over: Partial<LastScreen> = {}): LastScreen => ({
    v: 1,
    userId: "@me:x",
    build: "abc123",
    at: 1_000_000,
    width: view.innerWidth,
    height: view.innerHeight,
    html: `<div class="mx_MatrixChat"><div id="scroller" data-mx-scroll="340,0">kept</div></div>`,
    rootAttributes: [
        ["data-chat-columns", "true"],
        ["class", "taken"],
    ],
    bodyClass: "cpd-theme-dark",
    bodyStyle: "--accent: red",
    theme: "Light",
    ...over,
});

describe("the last screen, shown again at the next start", () => {
    beforeEach(() => {
        // The stylesheets and the widget named here are addresses to tell apart, not things to fetch.
        const settings = (window as unknown as { happyDOM?: { settings: Record<string, unknown> } }).happyDOM?.settings;
        if (settings) {
            settings.disableCSSFileLoading = true;
            settings.disableIframePageLoading = true;
            settings.disableJavaScriptFileLoading = true;
        }
        page();
        document.body.className = "";
        document.body.removeAttribute("style");
        document.documentElement.removeAttribute("data-chat-columns");
        document.documentElement.removeAttribute("class");
        localStorage.clear();
    });
    afterEach(async () => {
        // First: the store's own work is done on timers.
        vi.useRealTimers();
        hideLastScreen();
        await clearLastScreen();
    });

    describe("what is kept", () => {
        const kept = (encrypted: boolean): HTMLElement => {
            document.getElementById("matrixchat")!.innerHTML = APP;
            const copy = document.getElementById("matrixchat")!.cloneNode(true) as HTMLElement;
            sanitizeScreen(copy, new Map(), encrypted);
            return copy;
        };

        it("keeps the open chat and the chat list as they stood", () => {
            const copy = kept(false);
            expect(copy.querySelector('[data-event-id="$1"]')?.textContent).toBe("hello");
            expect(copy.querySelector("#plain")?.textContent).toContain("see you at eight");
        });

        it("keeps nothing of an encrypted room: not its messages, and not its line in the list", () => {
            const copy = kept(true);
            // The open chat is encrypted: its messages exist decrypted only in memory.
            expect(copy.querySelectorAll(".mx_RoomView [data-event-id]")).toHaveLength(0);
            // Another room's last message, under its name in the list.
            expect(copy.querySelector("#secret")?.textContent).not.toContain("4471");
            // The name is not the secret, and the other rooms are untouched.
            expect(copy.querySelector("#secret")?.textContent).toContain("Grace");
            expect(copy.querySelector("#plain")?.textContent).toContain("see you at eight");
        });

        it("leaves an encrypted room's line out even when the open chat is not encrypted", () => {
            expect(kept(false).querySelector("#secret")?.textContent).not.toContain("4471");
        });

        it("leaves out what nobody would see and what would not survive: rooms behind, held media, widgets", () => {
            const copy = kept(false);
            expect(copy.querySelector('[data-event-id="$9"]')).toBeNull();
            expect(copy.querySelector("#held")?.hasAttribute("src")).toBe(false);
            expect(copy.querySelector("#served")?.getAttribute("src")).toBe("https://x/media/a");
            expect(copy.querySelector("iframe")).toBeNull();
        });

        it("notes where each scrolled element stood", () => {
            document.getElementById("matrixchat")!.innerHTML = APP;
            const root = document.getElementById("matrixchat")!;
            const index = Array.from(root.querySelectorAll("*")).indexOf(root.querySelector("#timeline")!);
            const copy = root.cloneNode(true) as HTMLElement;
            sanitizeScreen(copy, new Map([[index, [812.4, 0]]]), false);
            expect(copy.querySelector("#timeline")?.getAttribute("data-mx-scroll")).toBe("812,0");
        });

        it("takes the screen with what the stylesheets go by, and none where the app is not up", () => {
            expect(
                captureLastScreen(document, { userId: "@me:x", build: "abc123", openRoomEncrypted: false }),
            ).toBeUndefined();

            document.getElementById("matrixchat")!.innerHTML = APP;
            document.documentElement.setAttribute("data-chat-columns", "true");
            document.documentElement.setAttribute("lang", "en");
            document.body.className = "cpd-theme-dark";
            const screen = captureLastScreen(document, {
                userId: "@me:x",
                build: buildOf(document),
                openRoomEncrypted: false,
                now: 5,
            })!;

            expect(screen.build).toBe("abc123");
            expect(screen.theme).toBe("Dark");
            expect(screen.rootAttributes).toContainEqual(["data-chat-columns", "true"]);
            // The language is the page's own to say.
            expect(screen.rootAttributes.map(([name]) => name)).not.toContain("lang");
            expect(screen.bodyClass).toBe("cpd-theme-dark");
            expect(screen.html).toContain("hello");
            expect(screen.at).toBe(5);
        });
    });

    describe("whether it is shown", () => {
        const context = {
            userId: "@me:x",
            build: "abc123",
            width: view.innerWidth,
            height: view.innerHeight,
            now: 1_000_500,
        };

        it("is shown to the same person, by the same build, in a window the same size", () => {
            expect(isLikeness(screenOf(), context)).toBe(true);
        });

        it("is never shown to anybody else, or to nobody", () => {
            expect(isLikeness(screenOf(), { ...context, userId: "@other:x" })).toBe(false);
            expect(isLikeness(screenOf(), { ...context, userId: null })).toBe(false);
        });

        it("is not shown under another build's stylesheets, or when it is old", () => {
            expect(isLikeness(screenOf(), { ...context, build: "def456" })).toBe(false);
            expect(isLikeness(screenOf(), { ...context, now: 1_000_000 + 8 * 24 * 3600 * 1000 })).toBe(false);
        });

        it("is not shown in a window that would lay it out differently", () => {
            expect(isLikeness(screenOf({ width: context.width + 300 }), context)).toBe(false);
            // A phone's address bar coming and going is not a different window.
            expect(isLikeness(screenOf({ height: context.height + 80 }), context)).toBe(true);
        });

        it("is not shown when there is none", () => {
            expect(isLikeness(undefined, context)).toBe(false);
            expect(isLikeness(screenOf({ html: "" }), context)).toBe(false);
        });
    });

    describe("showing it", () => {
        it("puts it over the page, where nothing in it can be clicked or read out", () => {
            showLastScreen(document, screenOf());
            const host = document.getElementById(LAST_SCREEN_ID)!;

            expect(document.body.firstElementChild).toBe(host);
            expect(host.hasAttribute("inert")).toBe(true);
            expect(host.getAttribute("aria-hidden")).toBe("true");
            expect(host.textContent).toContain("kept");
            // The app's own root is untouched: it is still the app's to fill.
            expect(document.getElementById("matrixchat")!.innerHTML).toBe("");
        });

        it("says of the page what the stylesheets need said, without overruling the page", () => {
            document.documentElement.setAttribute("class", "the-pages-own");
            showLastScreen(document, screenOf());

            expect(document.documentElement.getAttribute("data-chat-columns")).toBe("true");
            expect(document.documentElement.getAttribute("class")).toBe("the-pages-own");
            expect(document.body.className).toBe("cpd-theme-dark");
            expect(document.body.getAttribute("style")).toContain("--accent: red");
            expect(document.querySelector<HTMLLinkElement>('link[data-mx-theme="Light"]')!.disabled).toBe(false);
        });

        it("puts each scrolled element back where it stood", () => {
            showLastScreen(document, screenOf());
            expect(document.getElementById("scroller")!.scrollTop).toBe(340);
        });

        it("is shown once, and goes when told to or when the start has taken too long", () => {
            vi.useFakeTimers();
            showLastScreen(document, screenOf());
            showLastScreen(document, screenOf());
            expect(document.querySelectorAll(`#${LAST_SCREEN_ID}`)).toHaveLength(1);

            hideLastScreen();
            expect(isLastScreenShown()).toBe(false);

            showLastScreen(document, screenOf());
            vi.advanceTimersByTime(11_000);
            expect(isLastScreenShown()).toBe(true);
            vi.advanceTimersByTime(2_000);
            expect(isLastScreenShown()).toBe(false);
        });

        it("stays until the real room has a message to show in its place", async () => {
            showLastScreen(document, screenOf());
            const app = document.getElementById("matrixchat")!;
            hideLastScreenAfterFirstEvent();

            // The room is up with nothing in it yet: the spinner the picture is there to hide.
            app.innerHTML = `<div class="mx_RoomView"><div class="spinner"></div></div>`;
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(isLastScreenShown()).toBe(true);

            app.querySelector(".mx_RoomView")!.innerHTML = `<div data-event-id="$1">hello</div>`;
            await vi.waitFor(() => expect(isLastScreenShown()).toBe(false));
        });
    });

    describe("from one start to the next", () => {
        it("is kept, read back and forgotten", async () => {
            expect(await loadLastScreen()).toBeUndefined();
            await saveLastScreen(screenOf());
            expect((await loadLastScreen())?.html).toContain("kept");
            await clearLastScreen();
            expect(await loadLastScreen()).toBeUndefined();
        });

        it("is shown at the start to the person it belongs to, and not otherwise", async () => {
            await saveLastScreen(screenOf({ at: Date.now() }));

            // Nobody logged in.
            expect(await showLastScreenAtBoot()).toBe(false);

            localStorage.setItem("mx_user_id", "@other:x");
            expect(await showLastScreenAtBoot()).toBe(false);

            localStorage.setItem("mx_user_id", "@me:x");
            expect(await showLastScreenAtBoot()).toBe(true);
            expect(isLastScreenShown()).toBe(true);
        });

        it("is not shown over an app that is already up", async () => {
            await saveLastScreen(screenOf({ at: Date.now() }));
            localStorage.setItem("mx_user_id", "@me:x");
            document.getElementById("matrixchat")!.innerHTML = `<div class="mx_MatrixChat"></div>`;
            expect(await showLastScreenAtBoot()).toBe(false);
        });

        it("is kept when the page is hidden, and every so often while it is in front", async () => {
            document.getElementById("matrixchat")!.innerHTML = APP;
            const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
            vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
            const stop = keepLastScreen({ userId: "@me:x", openRoomEncrypted: () => false });

            // Still in front: becoming "visible" is not leaving.
            document.dispatchEvent(new Event("visibilitychange"));
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(await loadLastScreen()).toBeUndefined();

            // In front for a minute and a half.
            vi.advanceTimersByTime(90_000);
            await vi.waitFor(async () => expect((await loadLastScreen())?.html).toContain("hello"));

            // Changed, then hidden: what is kept is what was there when it was left.
            await clearLastScreen();
            document.querySelector('[data-event-id="$1"]')!.textContent = "edited";
            visibility.mockReturnValue("hidden");
            document.dispatchEvent(new Event("visibilitychange"));
            await vi.waitFor(async () => expect((await loadLastScreen())?.html).toContain("edited"));

            // Hidden pages are not kept on the timer: there is nothing new to see.
            await clearLastScreen();
            vi.advanceTimersByTime(90_000);
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(await loadLastScreen()).toBeUndefined();

            stop();
            visibility.mockRestore();
        });

        it("keeps the last one when there is nothing to keep", async () => {
            await saveLastScreen(screenOf());
            // The app is not up (a login page, say): nothing to take a picture of.
            const stop = keepLastScreen({ userId: "@me:x", openRoomEncrypted: () => false });
            window.dispatchEvent(new Event("pagehide"));
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect((await loadLastScreen())?.html).toContain("kept");
            stop();
        });

        it("is kept when the page is left, as it stood then", async () => {
            document.getElementById("matrixchat")!.innerHTML = APP;
            const stop = keepLastScreen({ userId: "@me:x", openRoomEncrypted: () => true });

            window.dispatchEvent(new Event("pagehide"));
            await vi.waitFor(async () => expect(await loadLastScreen()).toBeDefined());
            const screen = (await loadLastScreen())!;
            expect(screen.userId).toBe("@me:x");
            expect(screen.build).toBe("abc123");
            // The open room was encrypted when it was left.
            expect(screen.html).not.toContain("hello");

            stop();
            await clearLastScreen();
            window.dispatchEvent(new Event("pagehide"));
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(await loadLastScreen()).toBeUndefined();
        });
    });
});
