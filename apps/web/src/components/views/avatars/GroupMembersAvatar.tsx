/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type Ref, useEffect, useState } from "react";
import classNames from "classnames";
import { type Room, type RoomMember, RoomEvent, RoomStateEvent, RoomType } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import MemberAvatar from "./MemberAvatar";
import DMRoomMap from "../../../utils/DMRoomMap";
import { getBridgeBots, getBridgedDmUserId } from "../../../utils/bridge/bridgeInfo";

/** How many recent events to look through for the people who spoke last. */
const RECENT_EVENTS = 50;
/** Gap between overlapping petals, as a fraction of the avatar (Messenger's ring: ~2px on 40px). */
const GAP = 0.05;

interface Petal {
    /** Top-left corner and diameter, as fractions of the avatar size. */
    x: number;
    y: number;
    d: number;
    /** The petal that overlaps this one (cut out of it), if any. */
    under?: number;
}

/**
 * Messenger's group avatar: two people overlapping diagonally, the most recent speaker in front. With
 * three or more, a three-petal pinwheel where each petal tucks under the next.
 */
function layout(count: number): Petal[] {
    if (count === 2) {
        const d = 0.68;
        return [
            { x: 0, y: 1 - d, d },
            { x: 1 - d, y: 0, d, under: 0 },
        ];
    }
    const d = 0.56;
    const r = 0.5 - d / 2;
    return [-90, 30, 150].map((deg, i) => {
        const a = (deg * Math.PI) / 180;
        return { x: 0.5 + r * Math.cos(a) - d / 2, y: 0.5 + r * Math.sin(a) - d / 2, d, under: (i + 1) % 3 };
    });
}

/** A petal's mask: its whole box minus the overlapping petal's circle grown by the gap (one crisp path). */
function petalMask(petal: Petal, over: Petal): string {
    const scale = 100 / petal.d;
    const cx = (over.x + over.d / 2 - petal.x) * scale;
    const cy = (over.y + over.d / 2 - petal.y) * scale;
    const r = (over.d / 2 + GAP) * scale;
    const n = (v: number): string => String(Math.round(v * 1000) / 1000);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
        `<path fill-rule="evenodd" d="M-1 -1H101V101H-1Z` +
        `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}Z"/>` +
        `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Whether a room's avatar should be made of its members: a joined group without its own avatar (not a
 * DM, bridged DM or space).
 */
function wantsMemberAvatar(room: Room | undefined): room is Room {
    if (!room || room.getMxcAvatarUrl()) return false;
    if (room.getType() === RoomType.Space) return false;
    if (room.getMyMembership() !== KnownMembership.Join) return false;
    if (DMRoomMap.shared()?.getUserIdForRoomId(room.roomId)) return false;
    return !getBridgedDmUserId(room);
}

/** Up to three other members: the latest speakers first, then members with a picture, then anyone. */
function pickMembers(room: Room): RoomMember[] {
    const me = room.client.getUserId();
    const bots = getBridgeBots(room);
    const eligible = (m: RoomMember | null): m is RoomMember =>
        !!m && m.userId !== me && !bots.has(m.userId) && m.membership === KnownMembership.Join;
    const picked = new Map<string, RoomMember>();
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= Math.max(0, events.length - RECENT_EVENTS) && picked.size < 3; i--) {
        const member = room.getMember(events[i].getSender() ?? "");
        if (eligible(member)) picked.set(member.userId, member);
    }
    const others = room.getJoinedMembers().filter(eligible);
    for (const m of [...others.filter((m) => m.getMxcAvatarUrl()), ...others]) {
        if (picked.size >= 3) break;
        picked.set(m.userId, m);
    }
    return [...picked.values()];
}

/** The members a group avatar shows, kept up to date; fewer than two means "use the normal avatar". */
export function useGroupAvatarMembers(room: Room | undefined): RoomMember[] {
    const [members, setMembers] = useState<RoomMember[]>(() => (wantsMemberAvatar(room) ? pickMembers(room) : []));
    useEffect(() => {
        if (!room) {
            setMembers([]);
            return;
        }
        const update = (): void => {
            const next = wantsMemberAvatar(room) ? pickMembers(room) : [];
            setMembers((prev) => (prev.length === next.length && prev.every((m, i) => m === next[i]) ? prev : next));
        };
        update();
        room.on(RoomEvent.Timeline, update);
        room.on(RoomEvent.MyMembership, update);
        room.currentState.on(RoomStateEvent.Update, update);
        return () => {
            room.off(RoomEvent.Timeline, update);
            room.off(RoomEvent.MyMembership, update);
            room.currentState.off(RoomStateEvent.Update, update);
        };
    }, [room]);
    return members;
}

interface Props {
    members: RoomMember[];
    size: string;
    className?: string;
    title?: string;
    /** Accessible name (the room's). */
    label?: string;
    onClick?: () => void;
    ref?: Ref<HTMLButtonElement | HTMLSpanElement>;
}

/** A group's avatar made of its members' pictures (see layout()). Scales with its box, not just `size`. */
export function GroupMembersAvatar({ members, size, className, title, label, onClick, ref }: Props): JSX.Element {
    const petals = layout(members.length >= 3 ? 3 : 2);
    const px = parseFloat(size) || 36;
    const content = petals.map((petal, i) => {
        const over = petal.under === undefined ? undefined : petals[petal.under];
        const mask = over ? petalMask(petal, over) : undefined;
        return (
            <span
                key={members[i].userId}
                className="mx_GroupMembersAvatar_petal"
                style={{
                    left: `${petal.x * 100}%`,
                    top: `${petal.y * 100}%`,
                    width: `${petal.d * 100}%`,
                    height: `${petal.d * 100}%`,
                    maskImage: mask,
                }}
            >
                <MemberAvatar member={members[i]} size={`${Math.round(px * petal.d)}px`} hideTitle aria-hidden />
            </span>
        );
    });
    const props = {
        className: classNames("mx_BaseAvatar mx_GroupMembersAvatar", className),
        style: { width: size, height: size },
        title,
    };
    if (onClick) {
        return (
            <button type="button" {...props} aria-label={label} onClick={onClick} ref={ref as Ref<HTMLButtonElement>}>
                {content}
            </button>
        );
    }
    return (
        <span {...props} role="img" aria-label={label} ref={ref}>
            {content}
        </span>
    );
}
