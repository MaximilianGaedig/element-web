/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2023 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import * as TestUtils from "test-utils";
import { type MatrixClient, RoomMember as SdkRoomMember, type Device, Room } from "matrix-js-sdk/src/matrix";
import { type UserVerificationStatus, type DeviceVerificationStatus } from "matrix-js-sdk/src/crypto-api";
import userEvent from "@testing-library/user-event";

import { type RoomMember } from "../../../../../models/rooms/RoomMember";
import {
    getPending3PidInvites,
    type MemberWithSeparator,
    sdkRoomMemberToRoomMember,
} from "../../../../viewmodels/memberlist/MemberListViewModel";
import { RoomMemberTileView } from "./RoomMemberTileView";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import { ThreePidInviteTileView } from "./ThreePidInviteTileView";
import { type ThreePIDInvite } from "../../../../../models/rooms/ThreePIDInvite";

describe("MemberTileView", () => {
    describe("RoomMemberTileView", () => {
        const item = {} as { member: RoomMember };
        let matrixClient: MatrixClient;
        let member: RoomMember;

        beforeEach(() => {
            matrixClient = TestUtils.stubClient();
            vi.mocked(matrixClient.isRoomEncrypted).mockReturnValue(true);
            const sdkMember = new SdkRoomMember("roomId", matrixClient.getUserId()!);
            member = sdkRoomMemberToRoomMember(sdkMember)!.member!;
            item.member = member;
        });

        it("should not display an E2EIcon when the e2E status = normal", () => {
            const { container } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            const e2eIcon = container.querySelector(".mx_E2EIconView");
            expect(e2eIcon).toBeNull();
            expect(container).toMatchSnapshot();
        });

        // The room list badges a chat's face with its network; the member list drew the same person with
        // no badge at all, so the two lists disagreed about who is on what.
        it("badges a member's face with their network, as the room list does", async () => {
            const ghost = sdkRoomMemberToRoomMember(new SdkRoomMember("roomId", "@telegram_7:example.org"))!.member!;
            (matrixClient as any).getExtendedProfile = vi.fn(async (userId: string) =>
                userId === ghost.userId ? { "com.beeper.bridge.network": "telegram" } : {},
            );
            const bridged = new Room("!tg:example.org", matrixClient, matrixClient.getSafeUserId());
            bridged.currentState.setStateEvents([
                TestUtils.mkEvent({
                    event: true,
                    type: "m.bridge",
                    skey: "telegram",
                    room: bridged.roomId,
                    user: "@telegrambot:example.org",
                    content: { protocol: { id: "telegram", displayname: "Telegram" } },
                }),
            ]);
            vi.mocked(matrixClient.getRooms).mockReturnValue([bridged]);

            const tile = (shown: RoomMember, index: number): React.JSX.Element => (
                <MatrixClientContext.Provider value={matrixClient}>
                    <RoomMemberTileView
                        item={{ member: shown }}
                        member={shown}
                        index={index}
                        memberCount={2}
                        onFocus={vi.fn()}
                    />
                </MatrixClientContext.Provider>
            );
            const { container } = render(tile(ghost, 0));
            // The room list's own size for it: a 14px logo on a 32px face.
            // (The people module is loaded on first use, which here is this test: give it the time.)
            await waitFor(
                () =>
                    expect(
                        container
                            .querySelector<HTMLElement>(".mx_Contacts_networkLogo")
                            ?.style.getPropertyValue("--cpd-avatar-size"),
                    ).toBe("14px"),
                { timeout: 10_000 },
            );

            // The reader's own account is on no network, and is not badged.
            const mine = render(tile(member, 1));
            await waitFor(() => expect((matrixClient as any).getExtendedProfile).toHaveBeenCalledWith(member.userId));
            await Promise.resolve();
            expect(mine.container.querySelector(".mx_Contacts_networkLogo")).toBeNull();
        });

        it("should display an warning E2EIcon when the e2E status = Warning", async () => {
            vi.mocked(matrixClient.getCrypto()!.getUserVerificationStatus).mockResolvedValue({
                isCrossSigningVerified: vi.fn().mockReturnValue(false),
                wasCrossSigningVerified: vi.fn().mockReturnValue(true),
            } as unknown as UserVerificationStatus);

            const { container } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            await waitFor(async () => {
                await userEvent.hover(container.querySelector(".mx_E2EIcon")!);
                expect(screen.getByText("This user has not verified all of their sessions.")).toBeInTheDocument();
            });
            expect(container).toMatchSnapshot();
        });

        it("should display an verified E2EIcon when the e2E status = Verified", async () => {
            // Mock all the required crypto methods
            const deviceMap = new Map<string, Map<string, Device>>();
            deviceMap.set(member.userId, new Map([["deviceId", {} as Device]]));
            // Return a DeviceMap = Map<string, Map<string, Device>>
            vi.mocked(matrixClient.getCrypto()!.getUserDeviceInfo).mockResolvedValue(deviceMap);
            vi.mocked(matrixClient.getCrypto()!.getUserVerificationStatus).mockResolvedValue({
                isCrossSigningVerified: vi.fn().mockReturnValue(true),
            } as unknown as UserVerificationStatus);
            vi.mocked(matrixClient.getCrypto()!.getDeviceVerificationStatus).mockResolvedValue({
                crossSigningVerified: true,
            } as DeviceVerificationStatus);

            const { container } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );

            await waitFor(async () => {
                await userEvent.hover(container.querySelector(".mx_E2EIcon")!);
                expect(
                    screen.getByText("You have verified this user. This user has verified all of their sessions."),
                ).toBeInTheDocument();
            });
            expect(container).toMatchSnapshot();
        });

        it("renders user labels correctly", async () => {
            member.powerLevel = 50;
            const { container: container1 } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            expect(container1).toHaveTextContent("Moderator");

            member.powerLevel = 100;
            const { container: container2 } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            expect(container2).toHaveTextContent("Admin");

            member.powerLevel = Infinity;
            const { container: container3 } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            expect(container3).toHaveTextContent("Owner");

            member.isInvite = true;
            const { container: container4 } = render(
                <RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={vi.fn()} />,
            );
            expect(container4).toHaveTextContent("Invited");
        });

        it("should call onFocus handler when focused", async () => {
            const user = userEvent.setup();
            const onFocus = vi.fn();
            render(<RoomMemberTileView item={item} member={member} index={0} memberCount={1} onFocus={onFocus} />);

            const button = screen.getByRole("option", { name: member.userId });
            await user.click(button);

            expect(onFocus).toHaveBeenCalledWith(item, expect.anything());
        });
    });

    describe("ThreePidInviteTileView", () => {
        const member = {} as MemberWithSeparator;
        let cli: MatrixClient;
        let room: Room;
        let threePidInvite: ThreePIDInvite;

        beforeEach(() => {
            cli = TestUtils.stubClient();
            room = new Room("!mytestroom:foo.org", cli, cli.getSafeUserId());
            room.getLiveTimeline().addEvent(
                TestUtils.mkThirdPartyInviteEvent(cli.getSafeUserId(), "Foobar", room.roomId),
                { toStartOfTimeline: false, addToState: true },
            );
            threePidInvite = getPending3PidInvites(room)[0].threePidInvite!;
        });

        it("renders ThreePidInvite correctly", async () => {
            const { container } = render(
                <ThreePidInviteTileView
                    item={member}
                    threePidInvite={threePidInvite}
                    memberIndex={0}
                    memberCount={1}
                    onFocus={vi.fn()}
                />,
            );
            expect(container).toMatchSnapshot();
        });

        it("should call onFocus handler when focused", async () => {
            const user = userEvent.setup();
            const onFocus = vi.fn();
            render(
                <ThreePidInviteTileView
                    item={member}
                    threePidInvite={threePidInvite}
                    memberIndex={0}
                    memberCount={1}
                    onFocus={onFocus}
                />,
            );

            const button = screen.getByRole("option", { name: threePidInvite.event.getContent().display_name });
            await user.click(button);

            expect(onFocus).toHaveBeenCalledWith(member, expect.anything());
        });
    });
});
