/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The things you can do to the whole list, as one pill floating over it.
 *
 * A row of buttons above the list costs that row in every chat, permanently, on the screen with the
 * least of it to spare; a pill floats over the list and the list scrolls under it, which is where iOS
 * keeps the same kind of controls. Three, because a pill is reached with one thumb and stops being
 * that if it grows a fourth.
 */

import React, { type JSX } from "react";
import { IconButton } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import FoundIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";

import { _t } from "../../../../languageHandler";
import { setRoomListPanelView } from "../../../../utils/roomListPanelView";
import { setContactsTab } from "../../../../utils/contacts/contactsTab";

/** The room list is part of the startup graph, so the dialog and Modal stay out of it until asked for. */
function openFound(): void {
    void Promise.all([import("../../dialogs/FoundDialog"), import("../../../../Modal")]).then(
        ([{ default: FoundDialog }, { default: Modal }]) => Modal.createDialog(FoundDialog),
    );
}

export function RoomListPill(): JSX.Element {
    const openContacts = (tab: "people" | "calls") => (): void => {
        setContactsTab(tab);
        setRoomListPanelView("contacts");
    };

    return (
        <div className="mx_RoomListPill" role="toolbar" aria-label={_t("room_list|pill_label")}>
            <IconButton aria-label={_t("contacts|people")} onClick={openContacts("people")} size="32px">
                <UserProfileIcon />
            </IconButton>
            <IconButton aria-label={_t("contacts|calls")} onClick={openContacts("calls")} size="32px">
                <VoiceCallIcon />
            </IconButton>
            <IconButton aria-label={_t("found|open_it")} onClick={openFound} size="32px">
                <FoundIcon />
            </IconButton>
        </div>
    );
}
