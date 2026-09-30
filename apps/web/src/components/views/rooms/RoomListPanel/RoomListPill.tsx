/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What this column can be showing, as one pill floating over it.
 *
 * A row of controls above the list costs that row in every chat, permanently, on the screen with the least
 * of it to spare; a pill floats and the list scrolls under it. It is also where the switch between the
 * chats, the people and the calls belongs: those are three views of one column, so one control moves
 * between them and each view does not need a tab strip of its own underneath.
 *
 * Icon over label, and the one you are in is marked - a bar of bare icons is a guess per icon, and without
 * a mark on the current one it says what you can do but never where you are.
 */

import React, { type JSX, type ComponentType, type SVGAttributes } from "react";

import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import FoundIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";

import { _t } from "../../../../languageHandler";
import {
    type RoomListPanelView,
    setRoomListPanelView,
    useRoomListPanelView,
} from "../../../../utils/roomListPanelView";

/** The room list is part of the startup graph, so the dialog and Modal stay out of it until asked for. */
function openFound(): void {
    void Promise.all([import("../../dialogs/FoundDialog"), import("../../../../Modal")]).then(
        ([{ default: FoundDialog }, { default: Modal }]) => Modal.createDialog(FoundDialog),
    );
}

function Entry({
    Icon,
    label,
    current,
    onClick,
}: {
    Icon: ComponentType<SVGAttributes<SVGElement>>;
    label: string;
    /** Undefined for an entry that opens something else rather than being somewhere to be. */
    current?: boolean;
    onClick: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            className="mx_RoomListPill_entry"
            // Where you are, rather than only which button is tinted: a mark a screen reader can hear too.
            aria-current={current ? "page" : undefined}
            onClick={onClick}
        >
            <Icon width="22" height="22" aria-hidden />
            <span>{label}</span>
        </button>
    );
}

export function RoomListPill(): JSX.Element {
    const view = useRoomListPanelView();
    const go = (next: RoomListPanelView) => (): void => setRoomListPanelView(next);

    return (
        <nav className="mx_RoomListPill" aria-label={_t("room_list|pill_label")}>
            <Entry
                Icon={ChatIcon}
                label={_t("room_list|messages")}
                current={view === "rooms"}
                onClick={go("rooms")}
            />
            <Entry
                Icon={UserProfileIcon}
                label={_t("contacts|people")}
                current={view === "contacts"}
                onClick={go("contacts")}
            />
            <Entry
                Icon={VoiceCallIcon}
                label={_t("contacts|calls")}
                current={view === "calls"}
                onClick={go("calls")}
            />
            {/* Search opens over whatever is showing, so it is never where you are. */}
            <Entry Icon={FoundIcon} label={_t("found|short")} onClick={openFound} />
        </nav>
    );
}
