/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Controls a bridge says it will let you change (`im.mxg.settings`), and how to ask for one.
 *
 * The point of the shape is that this file is the only place that needs to know anything: each
 * control carries its own label and type, so the renderer is a loop over a list rather than a
 * switch over networks, and a bridge adding a control costs no client code at all.
 *
 * Nothing here is stored. The bridge writes the state, the client renders the state, and a change is
 * a request whose acknowledgement is the state changing - so there is no local copy to go stale, and
 * no request/response plumbing to get wrong.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { joinedRooms } from "./joinedRooms";

export const BRIDGE_SETTINGS_EVENT_TYPE = "im.mxg.settings";
export const BRIDGE_SETTINGS_SET_MSGTYPE = "im.mxg.settings.set";

export type DeclaredControlType = "boolean" | "enum" | "number" | "text" | "action";

export interface DeclaredOption {
    value: string;
    label: string;
}

export interface DeclaredControl {
    key: string;
    label: string;
    type: DeclaredControlType;
    value: unknown;
    options?: DeclaredOption[];
    /** Set means the control is shown, inert, with this as the explanation. The bridge's own words. */
    disabled_reason?: string;
}

export interface DeclaredSettings {
    source: { id: string; name: string };
    settings: DeclaredControl[];
    /** Which login's controls these are, from the state key. */
    loginId: string;
    /** The room the declaration was read from, which is where a request has to be sent. */
    roomId: string;
}

/** Whether a control is one this client knows how to draw and can act on right now. */
export function isRenderable(control: DeclaredControl): boolean {
    if (!control.key || !control.label) return false;
    switch (control.type) {
        case "enum":
            // An enum with no options is a dropdown with nothing in it: worse than showing nothing.
            return !!control.options?.length;
        case "boolean":
        case "number":
        case "text":
        case "action":
            return true;
        default:
            // A type from a newer bridge than this client. Left out rather than guessed at, which is
            // the whole reason the type travels with the control.
            return false;
    }
}

/**
 * The controls every bridge in this account has declared, one entry per login.
 *
 * Read from room state, like the connection state beside it, so it needs no request and is already
 * synced. A declaration with nothing renderable in it is dropped, so a caller can assume a non-empty
 * list means something to show.
 */
export function declaredSettings(client: MatrixClient): DeclaredSettings[] {
    const found: DeclaredSettings[] = [];
    for (const room of joinedRooms(client)) {
        for (const event of room.currentState.getStateEvents(BRIDGE_SETTINGS_EVENT_TYPE) ?? []) {
            const content = event.getContent();
            const settings = Array.isArray(content.settings) ? (content.settings as DeclaredControl[]) : [];
            const renderable = settings.filter(isRenderable);
            if (!renderable.length) continue;
            found.push({
                source: {
                    id: typeof content.source?.id === "string" ? content.source.id : "",
                    name: typeof content.source?.name === "string" ? content.source.name : "",
                },
                settings: renderable,
                loginId: event.getStateKey() ?? "",
                roomId: room.roomId,
            });
        }
    }
    return found;
}

/**
 * Asks the declaring party to change one control.
 *
 * A message rather than state: the user may not have the power to send state in the room, and a
 * request is not a fact. The bridge decides whether it happened, and says so by updating its own
 * state event - which is why nothing is returned here but the send itself.
 */
/** A value for the body text, for a client that cannot read the msgtype. Never "[object Object]". */
function describeValue(value: unknown): string {
    if (value === null || value === undefined) return "go";
    if (typeof value === "string") return value;
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return JSON.stringify(value);
}

export async function requestSetting(
    client: MatrixClient,
    declaration: DeclaredSettings,
    control: DeclaredControl,
    value: unknown,
): Promise<void> {
    if (control.disabled_reason) {
        // The bridge withdrew this control. Sending anyway would be asking for something we have
        // been told is not on offer, and the answer would be a notice the user did not ask for.
        throw new Error(`"${control.label}" is unavailable: ${control.disabled_reason}`);
    }
    await client.sendMessage(declaration.roomId, {
        msgtype: BRIDGE_SETTINGS_SET_MSGTYPE,
        // A body so that a client which knows nothing about this msgtype still shows something
        // sensible rather than an empty message.
        body: `${control.label}: ${describeValue(value)}`,
        key: control.key,
        value: control.type === "action" ? null : value,
    } as never);
}
