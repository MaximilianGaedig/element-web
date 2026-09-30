/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether somebody is about, across every network they are on.
 *
 * One person here is several accounts, and each network reports its own: somebody can be at their desk on
 * one and untouched for a day on another. The answer that is useful is the most awake of them - "on
 * Telegram, now" is the same fact as "about", and the other accounts being quiet says nothing against it.
 *
 * Each account is read exactly as the room list reads it ({@link presenceInfo}), so a face that has a
 * green dot or a "12m" tag in the chat list has the same one here. Contacts only decide which account wins.
 */

import { type MatrixClient, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import { useCallback, useEffect, useState } from "react";

import { type Person } from "./people";
import { type PresenceInfo, presenceInfo } from "../presence/activity";
import { presenceNow, usePresenceNow } from "../presence/clock";
import { useEventEmitter } from "../../hooks/useEventEmitter";

export interface PersonPresence {
    info: PresenceInfo;
    /** The network that said it, for "active now on WhatsApp". */
    network: string;
}

/** Online beats everything; otherwise the most recent activity; an account that says nothing loses. */
function awaker(a: PresenceInfo, b: PresenceInfo): boolean {
    if (a.online !== b.online) return a.online;
    return (a.lastActive ?? -Infinity) > (b.lastActive ?? -Infinity);
}

/**
 * The most awake thing any of their networks says about them, or nothing if none of them says anything.
 *
 * Nothing is not the same as offline: a network that has never reported is silent, and drawing somebody as
 * away because a bridge does not do presence at all would be this screen inventing a fact.
 */
export function personPresence(client: MatrixClient, person: Person, now = presenceNow()): PersonPresence | undefined {
    let best: PersonPresence | undefined;
    for (const account of person.accounts) {
        if (!account.mxid) continue;
        const info = presenceInfo(client.getUser(account.mxid), now);
        if (!info || (!info.online && info.lastActive === undefined)) continue;
        if (!best || awaker(info, best.info)) best = { info, network: account.network };
    }
    return best;
}

function samePresence(a: PersonPresence | undefined, b: PersonPresence | undefined): boolean {
    return (
        a?.network === b?.network &&
        a?.info.online === b?.info.online &&
        a?.info.lastActive === b?.info.lastActive &&
        a?.info.minutes === b?.info.minutes
    );
}

/** {@link personPresence}, live on the same presence events and shared clock as the room list. */
export function usePersonPresence(client: MatrixClient, person: Person | undefined): PersonPresence | undefined {
    const now = usePresenceNow();
    const read = useCallback(
        (at: number) => (person ? personPresence(client, person, at) : undefined),
        [client, person],
    );
    const [presence, setPresence] = useState(() => read(now));
    const update = (): void => {
        const next = read(presenceNow());
        setPresence((prev) => (samePresence(prev, next) ? prev : next));
    };
    useEffect(update, [read, now]);
    const onUser = (_ev: unknown, user?: User): void => {
        if (user && person?.accounts.some((account) => account.mxid === user.userId)) update();
    };
    useEventEmitter(client, UserEvent.LastPresenceTs, onUser);
    useEventEmitter(client, UserEvent.Presence, onUser);
    useEventEmitter(client, UserEvent.CurrentlyActive, onUser);
    return presence;
}
