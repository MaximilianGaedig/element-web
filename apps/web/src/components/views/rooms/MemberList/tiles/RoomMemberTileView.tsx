/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { useCreateAutoDisposedViewModel, DisambiguatedProfileView } from "@element-hq/web-shared-components";

import { type RoomMember } from "../../../../../models/rooms/RoomMember";
import { useMemberTileViewModel } from "../../../../viewmodels/memberlist/tiles/MemberTileViewModel";
import { E2EIconView } from "./common/E2EIconView";
import { ContactFace } from "../../../contacts/ContactFace";
import { usePresenceInfo } from "../../../../../utils/presence/activity";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { MemberTileView } from "./common/MemberTileView";
import { InvitedIconView } from "./common/InvitedIconView";
import { type MemberWithSeparator } from "../../../../viewmodels/memberlist/MemberListViewModel";
import { DisambiguatedProfileViewModel } from "../../../../../viewmodels/room/timeline/event-tile/DisambiguatedProfileViewModel";
import { useUserStatus } from "../../../../../hooks/useUserStatus";

interface IProps {
    /**
     * Needed for `onFocus`
     */
    item: MemberWithSeparator;
    member: RoomMember;
    index: number;
    memberCount: number;
    showPresence?: boolean;
    focused?: boolean;
    tabIndex?: number;
    onFocus: (item: MemberWithSeparator, e: React.FocusEvent) => void;
}

export function RoomMemberTileView(props: IProps): JSX.Element {
    const vm = useMemberTileViewModel(props);
    const member = vm.member;
    /*
     * Presence drawn the way the room list and the contacts draw it - a dot, or the "5m" tag, cut into the
     * face - from the same reading, rather than Element's older icon beside the avatar.
     */
    const client = useMatrixClientContext();
    const presence = usePresenceInfo(client, vm.showPresence ? member.userId : undefined);
    /*
     * And their network, as the room list badges a chat's: each member's own, from their profile, since
     * a room holds the reader, the bridge's bot and sometimes ghosts of more than one network.
     */
    const [network, setNetwork] = useState<string>();
    useEffect(() => {
        let alive = true;
        setNetwork(undefined);
        // Loaded when a tile first asks, not with the room: the people module pulls in the bridges and
        // the address book, none of which the timeline's bundle should wait for.
        void import("../../../../../utils/contacts/people")
            .then(({ networkOfUser }) => networkOfUser(client, member.userId))
            .then((found) => alive && setNetwork(found))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [client, member.userId]);
    const av = (
        <ContactFace
            client={client}
            name={member.name}
            id={member.userId}
            thumbnailUrl={member.avatarThumbnailUrl}
            presence={presence}
            network={network}
            size={32}
            logoSize={14}
        />
    );
    const name = vm.name;
    const userStatus = useUserStatus(member.userId);
    const disambiguatedProfileVM = useCreateAutoDisposedViewModel(
        () =>
            new DisambiguatedProfileViewModel({
                fallbackName: name,
                member,
                withTooltip: true,
                userStatus,
            }),
    );
    useEffect(() => {
        disambiguatedProfileVM.setMember(name, member);
    }, [disambiguatedProfileVM, member, name]);
    useEffect(() => {
        disambiguatedProfileVM.setUserStatus(userStatus);
    }, [disambiguatedProfileVM, userStatus]);
    const nameJSX = <DisambiguatedProfileView vm={disambiguatedProfileVM} className="mx_DisambiguatedProfile" />;

    let iconJsx;
    if (vm.e2eStatus) {
        iconJsx = <E2EIconView status={vm.e2eStatus} />;
    }
    if (member.isInvite) {
        iconJsx = <InvitedIconView isThreePid={false} />;
    }

    return (
        <MemberTileView
            onClick={vm.onClick}
            onFocus={(e) => props.onFocus(props.item, e)}
            avatarJsx={av}
            nameJsx={nameJSX}
            userLabel={vm.userLabel}
            ariaLabel={name}
            iconJsx={iconJsx}
            focused={props.focused}
            tabIndex={props.tabIndex}
            memberIndex={props.index - (member.isInvite ? 1 : 0)} // Adjust as invites are below the seperator
            memberCount={props.memberCount}
        />
    );
}
