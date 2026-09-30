/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A ringtone and a text tone per person, which is what a phone's address book has and what most people
 * actually use a contact card to set.
 *
 * Both are per room underneath, because that is the unit Matrix notifies on and the unit this client
 * already plays sounds for - a person is several rooms, so setting a tone sets it on all of them and the
 * same human sounds the same whichever network they come in on.
 *
 * The text tone is Element's own `notificationSound` room setting, untouched: Notifier already reads it,
 * resolves the mxc, throttles and plays it, so a tone set here is played by the code that plays every
 * other one. The ringtone needs its own room account data because the call ringer had no per-room sound
 * at all - it played one bundled file for every caller.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import { type Person } from "./people";

/** Where a person's ringtone is kept, per room, beside the text tone Element already stores there. */
export const RINGTONE_EVENT_TYPE = "im.mxg.ringtone";

export interface Tone {
    /** An `mxc:` URI in the reader's own media. */
    url: string;
    name?: string;
}

/** The ringtone for a room, if one was chosen for it. */
export function ringtoneFor(client: MatrixClient, roomId: string): Tone | undefined {
    const content = client.getRoom(roomId)?.getAccountData(RINGTONE_EVENT_TYPE)?.getContent<Tone>();
    return typeof content?.url === "string" && content.url.startsWith("mxc://") ? content : undefined;
}

/** What this person rings with, taken from whichever of their rooms has one set. */
export function ringtoneOf(client: MatrixClient, person: Person): Tone | undefined {
    for (const roomId of person.rooms) {
        const found = ringtoneFor(client, roomId);
        if (found) return found;
    }
    return undefined;
}

/** What this person's messages sound like, read from Element's own per-room setting. */
export function textToneOf(client: MatrixClient, person: Person): Tone | undefined {
    for (const roomId of person.rooms) {
        const content = SettingsStore.getValue("notificationSound", roomId);
        if (content && typeof content.url === "string") return { url: content.url, name: content.name };
    }
    return undefined;
}

/**
 * Sets a person's ringtone on every chat with them, or clears it.
 *
 * Every chat, because a tone chosen for a person is about the person: hearing their ringtone when they
 * call on Signal and the default when they call on WhatsApp would be the merge failing out loud.
 */
export async function setRingtone(client: MatrixClient, person: Person, tone?: Tone): Promise<void> {
    await Promise.all(
        person.rooms.map((roomId) => client.setRoomAccountData(roomId, RINGTONE_EVENT_TYPE, tone ?? {})),
    );
}

/** The same for the text tone, through the setting Notifier already reads. */
export async function setTextTone(client: MatrixClient, person: Person, tone?: Tone): Promise<void> {
    await Promise.all(
        person.rooms.map((roomId) =>
            SettingsStore.setValue("notificationSound", roomId, SettingLevel.ROOM_ACCOUNT, tone ?? null),
        ),
    );
}

/**
 * Uploads a sound the reader picked and returns it as a tone.
 *
 * Kept as an mxc rather than inlined anywhere: the tone has to be playable on every device the reader
 * signs in on, which is exactly what their own media repository is for.
 */
export async function uploadTone(client: MatrixClient, file: File): Promise<Tone> {
    const { content_uri: url } = await client.uploadContent(file, { type: file.type });
    return { url, name: file.name };
}
