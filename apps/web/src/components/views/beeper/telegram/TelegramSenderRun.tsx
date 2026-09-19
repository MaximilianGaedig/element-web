/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type JSX,
    type ReactElement,
    type ReactNode,
    isValidElement,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { EventType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import EventTile from "../../rooms/EventTile";
import MemberAvatar from "../../avatars/MemberAvatar";

/** tweb bubbleGroups.ts avatarNew({size: 40}). */
const AVATAR_SIZE = "40px";
/** A run whose newest message is younger than this when it mounts is new and its avatar pops in. */
const NEW_RUN_MS = 10_000;

type TileElement = ReactElement<{ mxEvent: MatrixEvent; continuation?: boolean }>;

function isTileElement(node: ReactNode): node is TileElement {
    return isValidElement(node) && node.type === EventTile;
}

/** The events tweb draws as bubbles of a sender's group (not state or call events). */
function isBubbleEvent(ev: MatrixEvent): boolean {
    if (ev.isState()) return false;
    const type = ev.getType();
    return (
        type === EventType.RoomMessage ||
        type === EventType.Sticker ||
        type === EventType.RoomMessageEncrypted ||
        type.endsWith("poll.start")
    );
}

/**
 * Telegram Web K's bubble groups (src/components/chat/bubbleGroups.ts): consecutive incoming messages
 * of one sender become one group, with the sender's avatar next to its last bubble. Wraps each run of
 * EventTiles in `nodes` (as MessagePanel builds them) in a TelegramSenderRun; everything else - our own
 * messages, date separators, read markers, summaries - stays as it is and ends the run.
 */
export function groupSenderRuns(nodes: ReactNode[], myUserId: string, room: Room): ReactNode[] {
    const out: ReactNode[] = [];
    let run: TileElement[] = [];
    let sender: string | undefined;
    const flush = (): void => {
        if (run.length && sender) {
            out.push(
                <TelegramSenderRun key={`tgrun-${String(run[0].key)}`} room={room} senderId={sender} tiles={run} />,
            );
        }
        run = [];
        sender = undefined;
    };
    for (const node of nodes) {
        if (isTileElement(node)) {
            const ev = node.props.mxEvent;
            const from = ev.getSender();
            if (from && from !== myUserId && isBubbleEvent(ev)) {
                if (from === sender && node.props.continuation) {
                    run.push(node);
                } else {
                    flush();
                    sender = from;
                    run = [node];
                }
                continue;
            }
        }
        flush();
        out.push(node);
    }
    flush();
    return out;
}

interface Props {
    room: Room;
    senderId: string;
    tiles: TileElement[];
}

/**
 * One sender's group: its tiles, and tweb's .bubbles-group-avatar in a column spanning the group. The
 * avatar is sticky at the bottom (so it stays in view while the group scrolls and rests next to the last
 * bubble), zoom-fades in for a new group (tweb .can-zoom-fade, --bubble-transition-in) and slides down to
 * a message added to the group. The wrapper carries every tile's scroll token for ScrollPanel.
 */
export function TelegramSenderRun({ room, senderId, tiles }: Props): JSX.Element {
    const tokens = tiles.map((t) => t.props.mxEvent.getId()).join(",");
    const member = room.getMember(senderId);
    const listRef = useRef<HTMLLIElement>(null);
    const avatarRef = useRef<HTMLDivElement>(null);
    const height = useRef<number | undefined>(undefined);
    const newestTs = tiles[tiles.length - 1].props.mxEvent.getTs();
    // Decided once, on mount: a group that already existed doesn't pop in again.
    const [isNew] = useState(() => Date.now() - newestTs < NEW_RUN_MS);

    // FLIP: when a message joins the group at the bottom, the avatar moves down by the height it added.
    useLayoutEffect(() => {
        const list = listRef.current;
        const avatar = avatarRef.current;
        if (!list || !avatar) return;
        const now = list.offsetHeight;
        const before = height.current;
        height.current = now;
        if (before === undefined || now <= before || typeof avatar.animate !== "function") return;
        avatar.animate([{ transform: `translateY(${before - now}px)` }, { transform: "translateY(0)" }], {
            duration: 300,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        });
    }, [tiles.length]);

    return (
        <li ref={listRef} className="mx_TgSenderRun" data-scroll-tokens={tokens}>
            <ol className="mx_TgSenderRun_tiles">{tiles}</ol>
            <div className="mx_TgSenderRun_avatarColumn">
                <div
                    ref={avatarRef}
                    className={isNew ? "mx_TgSenderRun_avatar mx_TgSenderRun_avatar_new" : "mx_TgSenderRun_avatar"}
                >
                    <MemberAvatar member={member} fallbackUserId={senderId} size={AVATAR_SIZE} viewUserOnClick />
                </div>
            </div>
        </li>
    );
}
