/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, afterEach } from "vitest";
import fetchMock from "@fetch-mock/vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    canDoStep,
    cancelLogin,
    initialValues,
    invalidFields,
    loginFlows,
    type LoginField,
    type LoginStep,
    startLogin,
    submitLoginStep,
} from "./loginFlow";
import { BridgeRequestError } from "./provisioning";

const API = "https://bridge.example/_matrix/provision";
const client = {
    getAccessToken: () => "token",
    getSafeUserId: () => "@me:example.org",
} as unknown as MatrixClient;

const step = (over: Partial<LoginStep>): LoginStep => ({
    login_id: "proc 1",
    type: "user_input",
    step_id: "fi.mau.telegram.phone",
    ...over,
});

describe("signing in through a bridge", () => {
    afterEach(() => {
        fetchMock.mockReset();
    });

    it("asks the bridge for its ways to sign in, as the user", async () => {
        fetchMock.get(`${API}/v3/login/flows?user_id=%40me%3Aexample.org`, {
            flows: [{ id: "qr", name: "QR" }],
        });

        expect(await loginFlows(client, API)).toEqual([{ id: "qr", name: "QR" }]);
        expect(fetchMock.callHistory.lastCall()?.options.headers).toMatchObject({ authorization: "Bearer token" });
    });

    it("starts a way of signing in, naming the login when it is one being signed back in to", async () => {
        fetchMock.post(`begin:${API}/v3/login/start/phone`, step({}));

        await startLogin(client, API, "phone");
        expect(new URL(fetchMock.callHistory.lastCall()!.url).searchParams.has("login_id")).toBe(false);

        await startLogin(client, API, "phone", "12345");
        expect(new URL(fetchMock.callHistory.lastCall()!.url).searchParams.get("login_id")).toBe("12345");
    });

    it("answers a step where the bridge is waiting for it, with what was typed", async () => {
        fetchMock.post(`begin:${API}/v3/login/step/`, step({ type: "complete" }));

        const next = await submitLoginStep(client, API, step({}), { phone: "+48 600" });

        const call = fetchMock.callHistory.lastCall()!;
        expect(new URL(call.url).pathname).toBe(
            "/_matrix/provision/v3/login/step/proc%201/fi.mau.telegram.phone/user_input",
        );
        expect(JSON.parse(call.options.body as string)).toEqual({ phone: "+48 600" });
        expect(next.type).toBe("complete");
    });

    it("hands on what the bridge said when it refuses", async () => {
        fetchMock.post(`begin:${API}/v3/login/step/`, {
            status: 400,
            body: { error: "The code is wrong", errcode: "FI.MAU.TELEGRAM.CODE_INVALID" },
        });

        const refused = submitLoginStep(client, API, step({}), { code: "1" });

        await expect(refused).rejects.toBeInstanceOf(BridgeRequestError);
        await expect(refused).rejects.toMatchObject({ message: "The code is wrong", status: 400 });
    });

    it("tells the bridge a sign-in was abandoned, and makes nothing of that failing", async () => {
        fetchMock.post(`begin:${API}/v3/login/step/`, 500);

        await expect(cancelLogin(client, API, step({}))).resolves.toBeUndefined();

        expect(new URL(fetchMock.callHistory.lastCall()!.url).pathname).toBe(
            "/_matrix/provision/v3/login/step/proc%201/fi.mau.telegram.phone/cancel",
        );
    });

    it("knows which steps a page can do", () => {
        for (const type of ["user_input", "display_and_wait", "complete"]) {
            expect(canDoStep(step({ type }))).toBe(true);
        }
        // These need the network's own site in a browser the bridge can read the session out of
        for (const type of ["cookies", "webauthn", "client_http", "something_new"]) {
            expect(canDoStep(step({ type }))).toBe(false);
        }
    });

    describe("what was typed", () => {
        const fields: LoginField[] = [
            { type: "phone_number", id: "phone", name: "Phone", pattern: "^\\+[0-9 ]+$" },
            { type: "select", id: "region", name: "Region", options: ["eu", "us"], default_value: "eu" },
            { type: "token", id: "token", name: "Token" },
            { type: "username", id: "odd", name: "Odd", pattern: "(?P<go>only)" },
        ];

        it("starts from the bridge's defaults", () => {
            expect(initialValues(fields)).toEqual({ phone: "", region: "eu", token: "", odd: "" });
        });

        it("is held back when empty, off the bridge's pattern, or not one of its options", () => {
            expect(invalidFields(fields, { phone: "600", region: "asia", token: "", odd: "x" })).toEqual([
                "phone",
                "region",
                "token",
            ]);
            expect(invalidFields(fields, { phone: "+48 600", region: "us", token: "t", odd: "x" })).toEqual([]);
        });
    });
});
