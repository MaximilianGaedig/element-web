/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The last screen, shown again the moment the page loads.
 *
 * Starting the app takes a couple of seconds whatever is done to it: the code has to be evaluated, the
 * session read, the stores opened and the saved sync replayed before there is a room list to draw. For
 * all of that time the reader looked at a spinner. Telegram shows the chats it had last time at once and
 * catches up underneath.
 *
 * So what was on screen is kept - the app's own markup, as it stood - and put back over the page as soon
 * as the entry script runs, long before the app can draw anything. It is a picture, not the app: it
 * cannot be clicked, and it goes the moment the real thing has its first message in the page. The
 * stylesheets are the page's own, so it looks as it did.
 *
 * What is not kept:
 *  - anything from an encrypted room - the open chat's messages, and that room's line in the chat list.
 *    Those exist in the clear only in memory, and a picture of them on disk would be the one place they
 *    are stored decrypted;
 *  - the rooms kept mounted behind the open one, which nobody would see;
 *  - media held in memory (`blob:` addresses), which do not outlive the page.
 *
 * Import-free on purpose: the half that shows it runs from the entry script, before anything else is loaded.
 */

export interface LastScreen {
    v: 1;
    /** Whose screen it was: never shown to anybody else. */
    userId: string;
    /** The build it was drawn by: markup from one build under another's stylesheets is not a likeness. */
    build: string;
    at: number;
    width: number;
    height: number;
    /** The inside of the app's root element. */
    html: string;
    /** The attributes on `<html>` the stylesheets go by: which layout, which tail, low power. */
    rootAttributes: [string, string][];
    bodyClass: string;
    bodyStyle: string;
    /** The theme stylesheet that was in use, by its `data-mx-theme`. */
    theme?: string;
}

export interface CaptureOptions {
    userId: string;
    build: string;
    /** Whether the room on screen is encrypted, in which case none of its messages are kept. */
    openRoomEncrypted: boolean;
    now?: number;
}

const APP_ROOT_ID = "matrixchat";
export const LAST_SCREEN_ID = "mx_lastScreen";
/** Put on a chat-list row's marker (WarmupOnRest) when its room is encrypted. */
export const ENCRYPTED_ROW_ATTRIBUTE = "data-mx-encrypted-room";
/** A row of the chat list, as the shared room list view draws it. */
const ROW_SELECTOR = ".mx_RoomListItemView";
const SCROLL_ATTRIBUTE = "data-mx-scroll";
/** A screen larger than this is not kept: something is on it that should not be (4 MB of markup). */
const MAX_HTML = 4_000_000;
/** A screen older than this says too little about now to be worth showing. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A window this much wider or narrower than the one the screen was drawn in lays out differently. */
const WIDTH_SLACK = 16;
/** Taller or shorter matters less: a phone's address bar comes and goes. */
const HEIGHT_SLACK = 160;
/** However the start goes, the picture does not outstay this. */
const GIVE_UP_MS = 12_000;

/** The build the page was drawn by, from the address of its stylesheet (`bundles/<hash>/bundle.css`). */
export function buildOf(doc: Document): string {
    const href = doc.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="bundle.css"]')?.getAttribute("href");
    return href?.match(/bundles\/([^/]+)\//)?.[1] ?? "";
}

/**
 * Makes a copy of the app's markup fit to keep (see the top of the file for what is left out).
 * `scrolled` is where each scrolled element stood, in the order `querySelectorAll("*")` gives them.
 */
export function sanitizeScreen(
    copy: Element,
    scrolled: ReadonlyMap<number, [number, number]>,
    openRoomEncrypted: boolean,
): void {
    // First, while the copy still has every element the original has, in the same order.
    const all = copy.querySelectorAll("*");
    for (const [index, [top, left]] of scrolled) {
        all[index]?.setAttribute(SCROLL_ATTRIBUTE, `${Math.round(top)},${Math.round(left)}`);
    }

    for (const behind of Array.from(copy.querySelectorAll('.mx_RoomView_kept[data-active="false"]'))) behind.remove();

    if (openRoomEncrypted) {
        for (const event of Array.from(copy.querySelectorAll(".mx_RoomView [data-event-id]"))) event.remove();
    }
    for (const marker of Array.from(copy.querySelectorAll(`[${ENCRYPTED_ROW_ATTRIBUTE}]`))) {
        const row = marker.closest(ROW_SELECTOR);
        const name = row?.querySelector('[data-testid="room-name"]');
        // The line under the name is the last message; the name itself is not secret.
        for (const sibling of Array.from(name?.parentElement?.children ?? [])) {
            if (sibling !== name) sibling.remove();
        }
    }

    for (const media of Array.from(copy.querySelectorAll("img, video, audio, source"))) {
        if (media.getAttribute("src")?.startsWith("blob:")) media.removeAttribute("src");
        if (media.getAttribute("srcset")?.includes("blob:")) media.removeAttribute("srcset");
        if (media.getAttribute("poster")?.startsWith("blob:")) media.removeAttribute("poster");
    }
    // Widgets and embedded pages would load, and run, as soon as the picture was shown.
    for (const frame of Array.from(copy.querySelectorAll("iframe, object, embed, script"))) frame.remove();
}

/** What is on screen, fit to keep - or undefined where there is no logged-in app to take it of. */
export function captureLastScreen(doc: Document, options: CaptureOptions): LastScreen | undefined {
    const root = doc.getElementById(APP_ROOT_ID);
    if (!root?.querySelector(".mx_MatrixChat")) return undefined;
    const view = doc.defaultView;
    if (!view) return undefined;

    const scrolled = new Map<number, [number, number]>();
    root.querySelectorAll("*").forEach((element, index) => {
        if (element.scrollTop || element.scrollLeft) scrolled.set(index, [element.scrollTop, element.scrollLeft]);
    });
    const copy = root.cloneNode(true) as Element;
    sanitizeScreen(copy, scrolled, options.openRoomEncrypted);

    const html = copy.innerHTML;
    if (html.length > MAX_HTML) return undefined;

    const page = doc.documentElement;
    return {
        v: 1,
        userId: options.userId,
        build: options.build,
        at: options.now ?? Date.now(),
        width: view.innerWidth,
        height: view.innerHeight,
        html,
        rootAttributes: Array.from(page.attributes)
            .filter((attribute) => attribute.name.startsWith("data-") || attribute.name === "class")
            .map((attribute) => [attribute.name, attribute.value]),
        bodyClass: doc.body.className,
        bodyStyle: doc.body.getAttribute("style") ?? "",
        theme: doc.querySelector<HTMLLinkElement>("link[data-mx-theme]:not([disabled])")?.dataset.mxTheme,
    };
}

export interface ShowContext {
    userId: string | null;
    build: string;
    width: number;
    height: number;
    now: number;
}

/** Whether a kept screen is a likeness of what this start will end in. */
export function isLikeness(screen: LastScreen | undefined, context: ShowContext): screen is LastScreen {
    if (!screen || screen.v !== 1 || !screen.html) return false;
    if (!context.userId || screen.userId !== context.userId) return false;
    if (!context.build || screen.build !== context.build) return false;
    if (context.now - screen.at > MAX_AGE_MS || screen.at > context.now + 60_000) return false;
    return (
        Math.abs(screen.width - context.width) <= WIDTH_SLACK &&
        Math.abs(screen.height - context.height) <= HEIGHT_SLACK
    );
}

let giveUp: ReturnType<typeof setTimeout> | undefined;

/** Puts the kept screen over the page. Nothing in it can be clicked, focused or read out. */
export function showLastScreen(doc: Document, screen: LastScreen): void {
    if (doc.getElementById(LAST_SCREEN_ID)) return;

    const root = doc.documentElement;
    for (const [name, value] of screen.rootAttributes) {
        // What the page says of itself already (the browser's checks, the language) stands.
        if (!root.hasAttribute(name)) root.setAttribute(name, value);
    }
    if (!doc.body.className) doc.body.className = screen.bodyClass;
    if (!doc.body.getAttribute("style")?.includes("--") && screen.bodyStyle) {
        doc.body.setAttribute("style", `${doc.body.getAttribute("style") ?? ""};${screen.bodyStyle}`);
    }

    const host = doc.createElement("div");
    host.id = LAST_SCREEN_ID;
    host.className = "notranslate";
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
    // Over the app's own root, which is still empty, and under the dialogs, which come after it in the page.
    host.style.cssText = "position:fixed;inset:0;z-index:1;height:100%;pointer-events:none;cursor:progress;";
    host.innerHTML = screen.html;
    doc.body.insertBefore(host, doc.body.firstChild);

    const restoreScroll = (): void => {
        for (const element of Array.from(host.querySelectorAll(`[${SCROLL_ATTRIBUTE}]`))) {
            const [top, left] = (element.getAttribute(SCROLL_ATTRIBUTE) ?? "").split(",").map(Number);
            element.scrollTop = top || 0;
            element.scrollLeft = left || 0;
        }
    };
    // The theme's stylesheet decides how tall things are, so where they were scrolled to waits for it.
    const theme = screen.theme
        ? doc.querySelector<HTMLLinkElement>(`link[data-mx-theme="${CSS.escape(screen.theme)}"]`)
        : null;
    if (theme) {
        theme.addEventListener("load", restoreScroll, { once: true });
        theme.disabled = false;
    }
    restoreScroll();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restoreScroll);

    clearTimeout(giveUp);
    giveUp = setTimeout(() => hideLastScreen(doc), GIVE_UP_MS);
}

/** Takes the picture away: the app is on screen, or it turned out not to be starting into this at all. */
export function hideLastScreen(doc: Document = document): void {
    clearTimeout(giveUp);
    doc.getElementById(LAST_SCREEN_ID)?.remove();
}

export function isLastScreenShown(doc: Document = document): boolean {
    return !!doc.getElementById(LAST_SCREEN_ID);
}

/**
 * Takes the picture away once the real room has a message in the page and that has been painted - not
 * before, or the spinner the picture is there to hide would show in between.
 */
export function hideLastScreenAfterFirstEvent(
    doc: Document = document,
    selector = ".mx_RoomView [data-event-id]",
): void {
    if (!isLastScreenShown(doc)) return;
    const app = doc.getElementById(APP_ROOT_ID);
    if (!app) return hideLastScreen(doc);

    const painted = (): void => {
        if (typeof requestAnimationFrame !== "function") return hideLastScreen(doc);
        requestAnimationFrame(() => requestAnimationFrame(() => hideLastScreen(doc)));
    };
    if (app.querySelector(selector)) return painted();
    const observer = new MutationObserver(() => {
        if (!app.querySelector(selector)) return;
        observer.disconnect();
        painted();
    });
    observer.observe(app, { childList: true, subtree: true });
    // The give-up timer set when it was shown still stands, for a room with nothing in it.
}

const DB_NAME = "mx_last_screen";
const STORE = "screen";
const KEY = "last";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        // A browser with no storage of this kind (a private window, some tests) has nothing kept and keeps nothing.
        if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB not available"));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (): void => {
            request.result.createObjectStore(STORE);
        };
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
    });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const request = run(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = (): void => resolve(request.result);
            request.onerror = (): void => reject(request.error);
        });
    } finally {
        db.close();
    }
}

export async function saveLastScreen(screen: LastScreen): Promise<void> {
    await withStore("readwrite", (store) => store.put(screen, KEY));
}

export async function loadLastScreen(): Promise<LastScreen | undefined> {
    return (await withStore<LastScreen | undefined>("readonly", (store) => store.get(KEY))) ?? undefined;
}

/** Forgets the kept screen: on logging out, with everything else that was this account's. */
export async function clearLastScreen(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    await withStore("readwrite", (store) => store.delete(KEY));
}

/**
 * Shows the kept screen if there is one and it is a likeness. Called from the entry script; never throws,
 * and never holds the start up - a browser with no storage to read simply starts as it always did.
 */
export async function showLastScreenAtBoot(doc: Document = document): Promise<boolean> {
    try {
        const view = doc.defaultView;
        const userId = view?.localStorage.getItem("mx_user_id") ?? null;
        if (!view || !userId || typeof indexedDB === "undefined") return false;
        const screen = await loadLastScreen();
        const context = {
            userId,
            build: buildOf(doc),
            width: view.innerWidth,
            height: view.innerHeight,
            now: Date.now(),
        };
        if (!isLikeness(screen, context)) return false;
        // The app got there first (a very fast start, or a very slow disk): nothing to cover.
        if (doc.getElementById(APP_ROOT_ID)?.querySelector(".mx_MatrixChat")) return false;
        showLastScreen(doc, screen);
        return true;
    } catch {
        return false;
    }
}
