/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Somebody's bio, from their profile (MSC4440).
 *
 * The bridges put a network's bio - Telegram's bio, WhatsApp's and Signal's About - into the ghost's
 * extended profile under MSC4440's field, which Sable, gomuks and Commet already read. It is extensible
 * events' `m.text` form: a list of representations, of which the plain one is what is shown here.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { useEffect, useState } from "react";

/** MSC4440's field, under its unstable name until the MSC is merged. */
export const BIOGRAPHY_KEY = "gay.fomx.biography";

/** How long a bio is kept before the profile is asked again: bridges update them, but rarely. */
const FRESH_MS = 10 * 60 * 1000;

/** The plain text of a biography field, or nothing when it holds none. */
export function readBiography(raw: unknown): string | undefined {
    if (typeof raw === "string") return raw.trim() || undefined;
    const reps = (raw as { "m.text"?: unknown } | undefined)?.["m.text"];
    if (!Array.isArray(reps)) return undefined;
    const texts = reps.filter(
        (rep): rep is { body: string; mimetype?: string } => typeof rep?.body === "string" && !!rep.body.trim(),
    );
    const plain = texts.find((rep) => !rep.mimetype || rep.mimetype === "text/plain") ?? texts[0];
    return plain?.body.trim();
}

const cache = new Map<string, { at: number; bio: Promise<string | undefined> }>();

/** How many people's bios are held, for the memory report. */
export const biographiesKept = (): number => cache.size;

/** Somebody's bio, asked of their profile at most every few minutes. */
export function fetchBiography(client: MatrixClient, userId: string): Promise<string | undefined> {
    const held = cache.get(userId);
    if (held && Date.now() - held.at < FRESH_MS) return held.bio;
    // Through a promise even for the call itself: a client that cannot ask at all simply has no bios.
    const bio = Promise.resolve()
        .then(() => client.getExtendedProfile(userId))
        .then((profile) => readBiography(profile[BIOGRAPHY_KEY]))
        // No profile, or one the server will not show: no bio, which is what most people have anyway. Not
        // kept, though: a request that failed says nothing about the next one.
        .catch(() => {
            cache.delete(userId);
            return undefined;
        });
    cache.set(userId, { at: Date.now(), bio });
    return bio;
}

/** The first bio any of these accounts has, for a person who is several accounts. */
export function useBiography(
    client: MatrixClient | undefined,
    userIds: readonly (string | undefined)[],
): string | undefined {
    const [bio, setBio] = useState<string>();
    const key = userIds.filter(Boolean).join("\n");
    useEffect(() => {
        setBio(undefined);
        if (!client || !key) return;
        let alive = true;
        void Promise.all(key.split("\n").map((userId) => fetchBiography(client, userId))).then((bios) => {
            if (alive) setBio(bios.find(Boolean));
        });
        return () => {
            alive = false;
        };
    }, [client, key]);
    return bio;
}
