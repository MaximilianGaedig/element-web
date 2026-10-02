/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Signing in to a network through its bridge, from here rather than by typing `login` to the bridge's bot.
 *
 * Every mautrix bridge has this in its provisioning API (mautrix-go `bridgev2/matrix/provisioning.go`):
 * the ways to sign in (`v3/login/flows`), starting one (`v3/login/start/{flow}`), and then a step at a
 * time (`v3/login/step/{process}/{step}/{type}`) until the bridge says it is done. Each answer is the next
 * step, and says what it needs: something typed in, or something shown while the bridge waits for the
 * phone to scan it.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { requestBridge } from "./provisioning";

/** One way to sign in to a network. */
export interface LoginFlow {
    id: string;
    name: string;
    description?: string;
}

/** Something the bridge needs typed in. `type` is a hint for what kind of thing it is. */
export interface LoginField {
    type: string;
    id: string;
    name: string;
    description?: string;
    default_value?: string;
    pattern?: string;
    options?: string[];
}

/** One step of signing in: what the bridge says, and what it needs next. */
export interface LoginStep {
    /** The sign-in this step belongs to. */
    login_id: string;
    type: "user_input" | "display_and_wait" | "complete" | "cookies" | "webauthn" | "client_http" | string;
    step_id: string;
    instructions?: string;
    user_input?: { fields: LoginField[] };
    display_and_wait?: { type: "qr" | "emoji" | "code" | "nothing" | string; data?: string; image_url?: string };
    complete?: { user_login_id: string };
}

/**
 * Whether a step can be done from this page.
 *
 * The others need the network's own website in a browser the bridge can read the session out of (cookies,
 * a passkey prompt, a request made from the user's address), which a page on another site cannot give it.
 */
export function canDoStep(step: LoginStep): boolean {
    return step.type === "user_input" || step.type === "display_and_wait" || step.type === "complete";
}

/** The ways this bridge lets you sign in. */
export async function loginFlows(
    client: MatrixClient,
    provisioningUrl: string,
    signal?: AbortSignal,
): Promise<LoginFlow[]> {
    const { flows } = await requestBridge<{ flows?: LoginFlow[] }>(client, provisioningUrl, "v3/login/flows", {
        signal,
    });
    return flows ?? [];
}

/**
 * Starts signing in. `again` is the login being signed back in to: the bridge then replaces that one
 * rather than adding an account next to it.
 */
export function startLogin(
    client: MatrixClient,
    provisioningUrl: string,
    flowId: string,
    again?: string,
    signal?: AbortSignal,
): Promise<LoginStep> {
    return requestBridge<LoginStep>(client, provisioningUrl, `v3/login/start/${encodeURIComponent(flowId)}`, {
        body: {},
        query: again ? { login_id: again } : undefined,
        signal,
    });
}

/**
 * Answers a step, and returns the next one.
 *
 * For a step that shows something and waits, there is nothing to send: the request itself is the waiting,
 * and is answered when the phone has done its part - which can be minutes.
 */
export function submitLoginStep(
    client: MatrixClient,
    provisioningUrl: string,
    step: LoginStep,
    values: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<LoginStep> {
    const path = ["v3", "login", "step", step.login_id, step.step_id, step.type].map(encodeURIComponent).join("/");
    return requestBridge<LoginStep>(client, provisioningUrl, path, {
        body: values,
        signal,
    });
}

/** Tells the bridge a sign-in is abandoned, so it stops waiting. Nothing to do about it failing. */
export async function cancelLogin(client: MatrixClient, provisioningUrl: string, step: LoginStep): Promise<void> {
    const path = `v3/login/step/${encodeURIComponent(step.login_id)}/${encodeURIComponent(step.step_id)}/cancel`;
    await requestBridge(client, provisioningUrl, path, { body: {} }).catch(() => {});
}

/** The values a step's fields start out with. */
export function initialValues(fields: LoginField[]): Record<string, string> {
    return Object.fromEntries(fields.map((field) => [field.id, field.default_value ?? ""]));
}

/** The fields whose value the bridge's own pattern says cannot be right. An empty one is one of them. */
export function invalidFields(fields: LoginField[], values: Record<string, string>): string[] {
    return fields
        .filter((field) => {
            const value = values[field.id] ?? "";
            if (!value) return true;
            if (field.type === "select" && field.options?.length) return !field.options.includes(value);
            if (!field.pattern) return false;
            try {
                return !new RegExp(field.pattern).test(value);
            } catch {
                // A pattern this browser cannot read (Go's syntax is not JavaScript's) checks nothing here;
                // the bridge checks again.
                return false;
            }
        })
        .map((field) => field.id);
}
