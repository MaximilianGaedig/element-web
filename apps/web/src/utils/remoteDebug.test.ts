/*
 * Copyright 2026 Maximilian Gaedig
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    answer,
    disableRemoteDebug,
    enableRemoteDebug,
    remoteDebugCode,
    scrub,
    selectorOf,
    startRemoteDebug,
} from "./remoteDebug";

class FakeSocket {
    public static instances: FakeSocket[] = [];
    public static readonly OPEN = 1;
    public readyState = 0;
    public sent: string[] = [];
    public onopen?: () => void;
    public onmessage?: (message: { data: string }) => void;
    public onclose?: () => void;

    public constructor(public readonly url: string) {
        FakeSocket.instances.push(this);
    }

    public send(data: string): void {
        this.sent.push(data);
    }

    public close(): void {
        this.readyState = 3;
    }

    public open(): void {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
    }
}

describe("remoteDebug", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        vi.stubGlobal("WebSocket", FakeSocket);
        document.body.innerHTML = `<main id="app"><p class="mx_A mx_B">hello <b>there</b></p><p class="mx_A">two</p></main>`;
    });

    afterEach(() => {
        disableRemoteDebug();
        vi.unstubAllGlobals();
    });

    it("scrubs what looks like a credential from text that leaves the device", () => {
        expect(scrub("GET /sync?access_token=syt_bWc_abcdefghijkl_123456 failed")).toBe(
            "GET /sync?access_token=<redacted> failed",
        );
        expect(scrub("token syt_bWc_abcdefghijkl_123456 here")).toBe("token syt_<redacted> here");
        expect(scrub('{"password":"hunter22","user":"mg"}')).toBe('{"password":"<redacted>","user":"mg"}');
        expect(scrub("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer <redacted>");
        expect(scrub("nothing secret")).toBe("nothing secret");
    });

    it("names an element by tag, id and classes", () => {
        expect(selectorOf(document.querySelector("main")!)).toBe("main#app");
        expect(selectorOf(document.querySelector("p")!)).toBe("p.mx_A.mx_B");
    });

    it("answers questions about what is on the page", async () => {
        const query = await answer({ type: "cmd", id: 1, name: "query", args: { selector: "p.mx_A", html: 100 } });
        expect(query.ok).toBe(true);
        const result = query.result as {
            count: number;
            elements: Array<{ element: string; text: string; html: string }>;
        };
        expect(result.count).toBe(2);
        expect(result.elements[0]).toMatchObject({ element: "p.mx_A.mx_B", text: "hello there" });
        expect(result.elements[0].html).toContain("<b>there</b>");

        const info = await answer({ type: "cmd", id: 2, name: "info" });
        expect(info.ok).toBe(true);
        expect(info.result).toMatchObject({ userAgent: navigator.userAgent, window: [innerWidth, innerHeight] });
    });

    it("refuses what it does not know and reports what fails", async () => {
        await expect(answer({ type: "cmd", id: 1, name: "constructor" })).resolves.toEqual({
            ok: false,
            error: "unknown command constructor",
        });
        await expect(answer({ type: "cmd", id: 2, name: "query" })).resolves.toEqual({
            ok: false,
            error: "selector is missing",
        });
        await expect(answer({ type: "cmd", id: 3, name: "click", args: { selector: ".absent" } })).resolves.toEqual({
            ok: false,
            error: "nothing matches .absent (0 found)",
        });
    });

    it("only runs scripts that the relay serves from this origin", async () => {
        for (const src of ["https://evil.example/_rdbg/js/0123456789abcdef", "/bundles/x.js", "/_rdbg/js/../x"]) {
            await expect(answer({ type: "cmd", id: 1, name: "run", args: { src, run: "r" } })).resolves.toEqual({
                ok: false,
                error: "not a script of the relay",
            });
        }
        expect(document.querySelector("script")).toBeNull();
    });

    it("is off until switched on, says so on screen, and is gone when switched off", () => {
        expect(remoteDebugCode()).toBeNull();
        startRemoteDebug();
        expect(FakeSocket.instances).toHaveLength(0);

        const code = enableRemoteDebug();
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        expect(remoteDebugCode()).toBe(code);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(FakeSocket.instances[0].url).toMatch(/\/_rdbg\/device$/);
        const pill = document.getElementById("mx_RemoteDebug_indicator")!;
        expect(pill.textContent).toContain(code);

        // A reload keeps the same code.
        expect(enableRemoteDebug()).toBe(code);
        expect(FakeSocket.instances).toHaveLength(1);

        pill.click();
        expect(remoteDebugCode()).toBeNull();
        expect(document.getElementById("mx_RemoteDebug_indicator")).toBeNull();
        expect(FakeSocket.instances[0].readyState).toBe(3);
    });

    it("introduces itself, passes the console on scrubbed, and answers commands", async () => {
        const code = enableRemoteDebug();
        const socket = FakeSocket.instances[0];
        console.warn("before the socket opened", { access_token: "syt_bWc_abcdefghijkl_123456" });
        socket.open();

        expect(JSON.parse(socket.sent[0])).toEqual({ type: "hello", code, userAgent: navigator.userAgent });
        const event = JSON.parse(socket.sent[1]);
        expect(event).toMatchObject({ type: "event", kind: "console", level: "warn" });
        expect(event.text).toContain("before the socket opened");
        expect(event.text).not.toContain("abcdefghijkl");

        socket.onmessage?.({ data: JSON.stringify({ type: "cmd", id: 7, name: "query", args: { selector: "main" } }) });
        socket.onmessage?.({ data: "not json" });
        await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
        expect(JSON.parse(socket.sent[2])).toMatchObject({ type: "reply", id: 7, ok: true });
    });
});
