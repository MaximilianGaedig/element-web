/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useState } from "react";

import { MatrixClientPeg } from "../MatrixClientPeg";
import { type DirectoryMember } from "../utils/direct-messages";
import { searchNetworkPeople } from "../utils/bridge/networkPeople";
import { useLatestResult } from "./useLatestResult";

/**
 * People on the bridged networks who match, whether or not they have ever been bridged.
 *
 * Shaped like useUserDirectory on purpose: it is the same question asked of somewhere else (utils/bridge/
 * networkPeople.ts), so the search dialog treats both the same way and merges the answers.
 */
export const useNetworkPeople = (): {
    loading: boolean;
    users: DirectoryMember[];
    search(this: void, opts: { limit?: number; query: string }): Promise<boolean>;
} => {
    const [users, setUsers] = useState<DirectoryMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [updateQuery, updateResult] = useLatestResult<{ term: string }, DirectoryMember[]>(setUsers);

    const search = useCallback(
        async ({ limit, query: term }: { limit?: number; query: string }): Promise<boolean> => {
            const opts = { term };
            updateQuery(opts);
            if (!term?.length) {
                setUsers([]);
                return true;
            }
            try {
                setLoading(true);
                const found = await searchNetworkPeople(MatrixClientPeg.safeGet(), term);
                updateResult(opts, limit ? found.slice(0, limit) : found);
                return true;
            } catch {
                // A network that cannot be searched is not an error worth showing: the rest of the results stand.
                updateResult(opts, []);
                return false;
            } finally {
                setLoading(false);
            }
        },
        [updateQuery, updateResult],
    );

    return { loading, users, search };
};
