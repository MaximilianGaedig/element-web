/*
 * Copyright 2026 Maximilian Gaedig
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

/**
 * Remote inspection of this device, for looking into a problem on a phone that has no developer tools.
 *
 * Off until the person switches it on from the device itself (`/remotedebug on`), and visibly on for as
 * long as it is: a pill on screen says so and stops it when tapped. While it is on, the app holds a socket
 * to the relay next to the web app and does what the relay's operator asks: answer questions about what is
 * on screen (layout, computed styles, console, timings) and run code, as a developer console would.
 *
 * Running code means the operator can reach everything the page can, the session included. That is no more
 * than whoever serves this app can already do, which is who operates the relay: its control side is not
 * reachable from the network, only from the server it runs on. Code arrives as a script from this app's own
 * origin, so the content security policy stays as strict as it is; nothing is ever evaluated from a string.
 *
 * The module imports nothing from the app, so that loading it can never take part in an import cycle, and
 * it is only ever loaded with `import()` once the switch is on.
 */

const STORAGE_KEY = "mx_remote_debug";
const RELAY_PATH = "/_rdbg/device";
/** Where the relay serves code to run. Scripts from anywhere else are refused. */
const SCRIPT_PATH = /^\/_rdbg\/js\/[A-Za-z0-9_-]{16,}$/;
const RUN_TIMEOUT_MS = 30_000;
const MAX_TEXT = 4000;
const MAX_REPLY = 300_000;
const MAX_BUFFERED_EVENTS = 300;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface RemoteCommand {
    type: "cmd";
    id: number;
    name: string;
    args?: Record<string, Json>;
}

/** What a console line or an error becomes on its way out. */
export function scrub(text: string): string {
    return text
        .replace(/\b(syt|mat|mct|mcr)_[A-Za-z0-9_.\-=]{8,}/g, "$1_<redacted>")
        .replace(/(access_token|refresh_token|id_token|password|secret)("?\s*[:=]\s*"?)[^\s"&,}]+/gi, "$1$2<redacted>")
        .replace(/(Bearer\s+)[A-Za-z0-9_.\-=]{8,}/g, "$1<redacted>");
}

function clip(text: string, max = MAX_TEXT): string {
    return text.length > max ? text.slice(0, max) + `… (+${text.length - max})` : text;
}

function describe(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (value instanceof Element) return selectorOf(value);
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** A short name for an element: its tag, id and first classes. */
export function selectorOf(el: Element): string {
    const classes = Array.from(el.classList).slice(0, 4);
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + classes.map((c) => `.${c}`).join("");
}

function rectOf(el: Element): number[] {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10);
}

function num(args: Record<string, Json> | undefined, key: string, fallback: number, max: number): number {
    const value = args?.[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : fallback;
}

function str(args: Record<string, Json> | undefined, key: string): string | undefined {
    const value = args?.[key];
    return typeof value === "string" ? value : undefined;
}

function pick(args: Record<string, Json> | undefined): Element {
    const selector = str(args, "selector");
    if (!selector) throw new Error("selector is missing");
    const all = document.querySelectorAll(selector);
    const el = all[num(args, "index", 0, 10_000)];
    if (!el) throw new Error(`nothing matches ${selector} (${all.length} found)`);
    return el;
}

function safeArea(): Record<string, string> {
    const probe = document.createElement("div");
    probe.style.cssText =
        "position:fixed;visibility:hidden;pointer-events:none;" +
        "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const insets = {
        top: style.paddingTop,
        right: style.paddingRight,
        bottom: style.paddingBottom,
        left: style.paddingLeft,
    };
    probe.remove();
    return insets;
}

/** One line per element that takes up room on screen, indented by depth. */
function outline(root: Element, depth: number, limit: number): string {
    const lines: string[] = [];
    const walk = (el: Element, level: number): void => {
        if (lines.length >= limit || el.id === INDICATOR_ID) return;
        const [x, y, w, h] = rectOf(el);
        if (w === 0 && h === 0) return;
        let line = `${"  ".repeat(level)}${selectorOf(el)} [${x},${y} ${w}x${h}]`;
        const label = el.getAttribute("aria-label") || el.getAttribute("role");
        if (label) line += ` (${clip(label, 60)})`;
        const own = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
            .join(" ");
        if (own) line += ` "${clip(own, 60)}"`;
        lines.push(line);
        if (level < depth) for (const child of Array.from(el.children)) walk(child, level + 1);
    };
    walk(root, 0);
    if (lines.length >= limit) lines.push(`… cut at ${limit} elements`);
    return lines.join("\n");
}

/** Results that scripts served by the relay are still to report, by run. */
const running = new Map<string, (outcome: { ok: boolean; value: unknown }) => void>();

/** What a script run for the relay calls when it is done. */
function reportRun(run: string, ok: boolean, value: unknown): void {
    running.get(run)?.({ ok, value });
    running.delete(run);
}

/** A value as something that can be sent: itself when it is JSON, described otherwise. */
function sendable(value: unknown): Json {
    if (value === undefined) return null;
    try {
        const text = JSON.stringify(value);
        if (text !== undefined) return JSON.parse(text);
    } catch {
        // Cyclic, or otherwise not JSON.
    }
    return describe(value);
}

const handlers: Record<string, (args?: Record<string, Json>) => Json | Promise<Json>> = {
    /**
     * Run code the relay serves from this origin. The script reports back through
     * `window.mxRemoteDebugDone(run, ok, value)`, which the relay wraps around the code.
     */
    run: (args) => {
        const src = str(args, "src");
        const run = str(args, "run");
        if (!src || !run || !SCRIPT_PATH.test(src)) throw new Error("not a script of the relay");
        return new Promise<Json>((resolve, reject) => {
            const script = document.createElement("script");
            const timer = window.setTimeout(() => {
                running.delete(run);
                reject(new Error("the code did not finish in time"));
            }, RUN_TIMEOUT_MS);
            running.set(run, ({ ok, value }) => {
                window.clearTimeout(timer);
                script.remove();
                if (ok) resolve(sendable(value));
                else reject(new Error(describe(value)));
            });
            script.onerror = (): void => reportRun(run, false, "the script could not be loaded");
            script.src = src;
            document.head.appendChild(script);
        });
    },

    /** The device, the window and how the app is running in it. */
    info: () => {
        // This reports the window as it is, which is what UIStore exists to hide from the app's own code.
        // eslint-disable-next-line no-restricted-properties
        const viewport = window.visualViewport;
        return {
            userAgent: navigator.userAgent,
            language: navigator.language,
            online: navigator.onLine,
            location: scrub(location.pathname + location.hash),
            standalone:
                (navigator as { standalone?: boolean }).standalone === true ||
                matchMedia("(display-mode: standalone)").matches,
            window: [innerWidth, innerHeight],
            visualViewport: viewport
                ? {
                      size: [viewport.width, viewport.height],
                      offset: [viewport.offsetLeft, viewport.offsetTop],
                      scale: viewport.scale,
                  }
                : null,
            screen: [screen.width, screen.height],
            devicePixelRatio,
            safeArea: safeArea(),
            scroll: [scrollX, scrollY],
            hover: matchMedia("(hover: hover)").matches,
            darkScheme: matchMedia("(prefers-color-scheme: dark)").matches,
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
            bodyClasses: document.body.className,
            visibility: document.visibilityState,
            serviceWorker: Boolean(navigator.serviceWorker?.controller),
            title: document.title,
            focused: document.activeElement ? selectorOf(document.activeElement) : null,
        };
    },

    /** Elements matching a selector: where they are, what they say, chosen computed styles. */
    query: (args) => {
        const selector = str(args, "selector");
        if (!selector) throw new Error("selector is missing");
        const styles = Array.isArray(args?.styles) ? args.styles.filter((s): s is string => typeof s === "string") : [];
        const html = num(args, "html", 0, 20_000);
        const all = Array.from(document.querySelectorAll(selector));
        return {
            count: all.length,
            elements: all.slice(0, num(args, "limit", 10, 100)).map((el) => {
                const computed = getComputedStyle(el);
                const out: { [key: string]: Json } = {
                    element: selectorOf(el),
                    rect: rectOf(el),
                    text: clip((el.textContent ?? "").trim().replace(/\s+/g, " "), 200),
                };
                if (styles.length) {
                    out.styles = Object.fromEntries(styles.map((s) => [s, computed.getPropertyValue(s)]));
                }
                if (html) out.html = clip(el.outerHTML, html);
                return out;
            }),
        };
    },

    /** What is laid out under a selector, as an indented outline. */
    tree: (args) => {
        const root = str(args, "selector") ? pick(args) : document.body;
        return outline(root, num(args, "depth", 6, 40), num(args, "limit", 300, 2000));
    },

    /** The elements stacked under a point of the window, topmost first. */
    at: (args) =>
        document
            .elementsFromPoint(num(args, "x", 0, 100_000), num(args, "y", 0, 100_000))
            .map((el) => `${selectorOf(el)} [${rectOf(el).join(",")}]`),

    /** Tap an element. */
    click: (args) => {
        const el = pick(args);
        (el as HTMLElement).click();
        return selectorOf(el);
    },

    /** Scroll an element (or the page) to a position, or by an amount. */
    scroll: (args) => {
        const el = str(args, "selector") ? pick(args) : (document.scrollingElement ?? document.body);
        if (typeof args?.by === "number") el.scrollTop += args.by;
        if (typeof args?.top === "number") el.scrollTop = args.top;
        return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    },

    /** Try out CSS on the device: replaces what was tried before; empty takes it away. */
    css: (args) => {
        const id = "mx_RemoteDebug_css";
        document.getElementById(id)?.remove();
        const text = str(args, "text");
        if (text) {
            const style = document.createElement("style");
            style.id = id;
            style.textContent = text;
            document.head.appendChild(style);
        }
        return Boolean(text);
    },

    /** How much is stored and under which names. Never the values. */
    storage: async () => {
        const sizes: { [key: string]: Json } = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) sizes[key] = localStorage.getItem(key)?.length ?? 0;
        }
        const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
        const databases = await indexedDB.databases?.().catch(() => undefined);
        return {
            localStorageSizes: sizes,
            estimate: estimate ? { usage: estimate.usage ?? null, quota: estimate.quota ?? null } : null,
            indexedDB: databases?.map((db) => db.name ?? "") ?? null,
        };
    },

    /** Timings of this page load and anything the app has marked or measured. */
    perf: (args) => {
        const entry = (e: PerformanceEntry): Json => ({
            name: clip(scrub(e.name), 200),
            type: e.entryType,
            start: Math.round(e.startTime),
            duration: Math.round(e.duration),
        });
        const type = str(args, "type");
        const entries = type ? performance.getEntriesByType(type) : performance.getEntries();
        const memory = (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
        return {
            now: Math.round(performance.now()),
            memory: memory ? { used: memory.usedJSHeapSize, limit: memory.jsHeapSizeLimit } : null,
            entries: entries
                .filter((e) => type || e.entryType !== "resource")
                .slice(-num(args, "limit", 100, 1000))
                .map(entry),
        };
    },
};

/** Answers one command from the relay. Unknown commands are refused rather than guessed at. */
export async function answer(command: RemoteCommand): Promise<{ ok: boolean; result?: Json; error?: string }> {
    const handler = Object.hasOwn(handlers, command.name) ? handlers[command.name] : undefined;
    if (!handler) return { ok: false, error: `unknown command ${command.name}` };
    try {
        return { ok: true, result: await handler(command.args) };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

const INDICATOR_ID = "mx_RemoteDebug_indicator";

class Session {
    private socket?: WebSocket;
    private stopped = false;
    private retryDelay = 1000;
    private retryTimer?: number;
    private buffered: string[] = [];
    private readonly original: Partial<Record<keyof Console, (...args: unknown[]) => void>> = {};

    public constructor(private readonly code: string) {}

    public start(): void {
        (window as unknown as Record<string, unknown>).mxRemoteDebugDone = reportRun;
        this.hookConsole();
        window.addEventListener("error", this.onError);
        window.addEventListener("unhandledrejection", this.onRejection);
        this.showIndicator();
        this.connect();
    }

    public stop(): void {
        this.stopped = true;
        window.clearTimeout(this.retryTimer);
        for (const [level, fn] of Object.entries(this.original)) {
            (console as unknown as Record<string, unknown>)[level] = fn;
        }
        window.removeEventListener("error", this.onError);
        window.removeEventListener("unhandledrejection", this.onRejection);
        delete (window as unknown as Record<string, unknown>).mxRemoteDebugDone;
        running.clear();
        document.getElementById(INDICATOR_ID)?.remove();
        document.getElementById("mx_RemoteDebug_css")?.remove();
        this.socket?.close();
    }

    private connect(): void {
        if (this.stopped) return;
        const scheme = location.protocol === "http:" ? "ws" : "wss";
        const socket = new WebSocket(`${scheme}://${location.host}${RELAY_PATH}`);
        this.socket = socket;
        socket.onopen = (): void => {
            this.retryDelay = 1000;
            socket.send(JSON.stringify({ type: "hello", code: this.code, userAgent: navigator.userAgent }));
            for (const event of this.buffered.splice(0)) socket.send(event);
            this.showIndicator();
        };
        socket.onmessage = (message): void => {
            let command: RemoteCommand;
            try {
                command = JSON.parse(String(message.data));
            } catch {
                return;
            }
            if (command?.type !== "cmd" || typeof command.name !== "string") return;
            void answer(command).then((reply) => {
                let text = JSON.stringify({ type: "reply", id: command.id, ...reply });
                if (text.length > MAX_REPLY) {
                    text = JSON.stringify({
                        type: "reply",
                        id: command.id,
                        ok: false,
                        error: "the answer is too large",
                    });
                }
                if (socket.readyState === WebSocket.OPEN) socket.send(text);
            });
        };
        socket.onclose = (): void => {
            if (this.stopped) return;
            this.showIndicator();
            this.retryTimer = window.setTimeout(() => this.connect(), this.retryDelay);
            this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
        };
    }

    private emit(kind: string, level: string, text: string): void {
        const event = JSON.stringify({ type: "event", kind, level, ts: Date.now(), text: clip(scrub(text)) });
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(event);
        } else {
            this.buffered.push(event);
            if (this.buffered.length > MAX_BUFFERED_EVENTS) this.buffered.shift();
        }
    }

    private hookConsole(): void {
        for (const level of ["debug", "log", "info", "warn", "error"] as const) {
            const original = console[level].bind(console) as (...args: unknown[]) => void;
            this.original[level] = original;
            console[level] = (...args: unknown[]): void => {
                original(...args);
                try {
                    this.emit("console", level, args.map(describe).join(" "));
                } catch {
                    // Reporting must never break what was being logged.
                }
            };
        }
    }

    private readonly onError = (event: ErrorEvent): void => {
        this.emit("error", "error", `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
    };

    private readonly onRejection = (event: PromiseRejectionEvent): void => {
        this.emit("error", "error", `Unhandled rejection: ${describe(event.reason)}`);
    };

    /** The person must always be able to see that the device is being looked at, and stop it with a tap. */
    private showIndicator(): void {
        let pill = document.getElementById(INDICATOR_ID);
        if (!pill) {
            pill = document.createElement("button");
            pill.id = INDICATOR_ID;
            pill.style.cssText =
                "position:fixed;z-index:2147483647;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));" +
                "padding:4px 10px;border:0;border-radius:12px;font:600 11px/16px system-ui,sans-serif;" +
                "color:#fff;background:#d92d20;opacity:0.9";
            pill.addEventListener("click", () => disableRemoteDebug());
            document.body.appendChild(pill);
        }
        const connected = this.socket?.readyState === WebSocket.OPEN;
        pill.textContent = `Remote debug ${this.code} · ${connected ? "connected" : "connecting"} · tap to stop`;
    }
}

let session: Session | undefined;

function newCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** The pairing code while remote inspection is switched on for this device. */
export function remoteDebugCode(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Switches remote inspection on for this device and returns the code that names it to the relay. */
export function enableRemoteDebug(): string {
    const code = remoteDebugCode() ?? newCode();
    localStorage.setItem(STORAGE_KEY, code);
    startRemoteDebug();
    return code;
}

export function disableRemoteDebug(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to forget then.
    }
    session?.stop();
    session = undefined;
}

/** Picks up where the device left off: called at startup when the switch was left on. */
export function startRemoteDebug(): void {
    const code = remoteDebugCode();
    if (!code || session) return;
    session = new Session(code);
    session.start();
}
