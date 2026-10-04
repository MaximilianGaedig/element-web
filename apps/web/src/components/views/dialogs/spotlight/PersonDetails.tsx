/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { publishedIdentity } from "../../../../utils/contacts/people";
import { bridgedPersonLine } from "../../../../utils/contacts/networkHandle";

interface Props {
    client: MatrixClient;
    userId: string;
    /** For the result's `aria-describedby`. */
    id: string;
    className?: string;
    /** The line the network gave when it found them ("12 mutual friends"), shown first. */
    context?: string;
    /** The network, where it is known before the profile answers: a bridged chat says which it is. */
    network?: string;
}

/**
 * The line under a person in the search results: for somebody on a bridged network, the username or number
 * that network knows them by (utils/contacts/networkHandle.ts), not their ghost's Matrix ID; for a Matrix
 * account, the Matrix ID.
 *
 * Their profile has to be asked for that, once per person (people.ts keeps the answers). Until it answers
 * the line holds what is already known - the network of the chat, the network's own line - rather than
 * the Matrix ID, which would only be replaced a moment later.
 */
export function PersonDetails({ client, userId, id, className, context, network }: Props): JSX.Element {
    // undefined while the profile is being read; null for an account no bridge stands behind.
    const [bridged, setBridged] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        let live = true;
        setBridged(undefined);
        // A profile that cannot be read leaves them a Matrix account here, as the contacts list does.
        void Promise.resolve()
            .then(() => publishedIdentity(client, userId))
            .catch(() => ({ identifiers: [] }))
            .then((identity) => {
                if (live) setBridged(bridgedPersonLine(client, identity) ?? null);
            });
        return () => {
            live = false;
        };
    }, [client, userId]);

    let line: string | undefined;
    if (bridged) line = bridged;
    else if (bridged === null) line = network ?? (context ? undefined : userId);
    else line = network;
    return (
        <div id={id} className={className}>
            {[context, line].filter(Boolean).join(" · ")}
        </div>
    );
}
