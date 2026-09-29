/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Which of the two lists contacts opens on.
 *
 * Kept beside the panel's view rather than passed down: whoever opens contacts (a pill over the list, a
 * button in the rail) is not the thing that renders them, and a prop would have to thread through the
 * whole panel to say one word.
 */

export type ContactsTab = "people" | "calls";

let tab: ContactsTab = "people";

export const contactsTab = (): ContactsTab => tab;
export const setContactsTab = (next: ContactsTab): void => {
    tab = next;
};
