/*
Copyright 2017-2024 New Vector Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room, RoomEvent, type RoomMember, RoomMemberEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import * as WhoIsTyping from "../../../WhoIsTyping";
import Timer from "../../../utils/Timer";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MemberAvatar from "../avatars/MemberAvatar";
import { onTypingKindsChanged, type TypingKind, typingKindOf, watchTypingKinds } from "../../../TypingKinds";

interface IProps {
    // the room this statusbar is representing.
    room: Room;
    onShown?: () => void;
    onHidden?: () => void;
    // Number of names to display in typing indication. E.g. set to 3, will
    // result in "X, Y, Z and 100 others are typing."
    whoIsTypingLimit: number;
}

interface IState {
    usersTyping: RoomMember[];
    // a map with userid => Timer to delay
    // hiding the "x is typing" message for a
    // user so hiding it can coincide
    // with the sent message by the other side
    // resulting in less timeline jumpiness
    delayedStopTypingTimers: Record<string, Timer>;
    // What each user shown is doing, by user ID. Kept apart from the live kinds because a user who
    // stopped stays on the tile for a moment, and should not turn into "typing" for it.
    typingKinds: Record<string, TypingKind>;
}

export default class WhoIsTypingTile extends React.Component<IProps, IState> {
    public static defaultProps = {
        whoIsTypingLimit: 3,
    };

    private stopWatchingKinds?: () => void;

    public state: IState = {
        usersTyping: WhoIsTyping.usersTypingApartFromMe(this.props.room),
        delayedStopTypingTimers: {},
        typingKinds: this.typingKinds(WhoIsTyping.usersTypingApartFromMe(this.props.room), {}, {}),
    };

    public componentDidMount(): void {
        const client = MatrixClientPeg.safeGet();
        watchTypingKinds(client);
        client.on(RoomMemberEvent.Typing, this.onRoomMemberTyping);
        client.on(RoomEvent.Timeline, this.onRoomTimeline);
        // Somebody can go from typing to recording without ever having stopped typing, which the
        // listener above does not hear of.
        this.stopWatchingKinds = onTypingKindsChanged((roomId) => {
            if (roomId !== this.props.room.roomId) return;
            this.setState((state) => ({
                typingKinds: this.typingKinds(state.usersTyping, state.delayedStopTypingTimers, state.typingKinds),
            }));
        });
    }

    public componentDidUpdate(prevProps: IProps, prevState: IState): void {
        const wasVisible = WhoIsTypingTile.isVisible(prevState);
        const isVisible = WhoIsTypingTile.isVisible(this.state);
        if (this.props.onShown && !wasVisible && isVisible) {
            this.props.onShown();
        } else if (this.props.onHidden && wasVisible && !isVisible) {
            this.props.onHidden();
        }
    }

    public componentWillUnmount(): void {
        // we may have entirely lost our client as we're logging out before clicking login on the guest bar...
        const client = MatrixClientPeg.get();
        if (client) {
            client.removeListener(RoomMemberEvent.Typing, this.onRoomMemberTyping);
            client.removeListener(RoomEvent.Timeline, this.onRoomTimeline);
        }
        this.stopWatchingKinds?.();
        Object.values(this.state.delayedStopTypingTimers).forEach((t) => t.abort());
    }

    /**
     * What each user on the tile is doing: the live kind for those typing, and the last one known for
     * those who stopped but are still shown.
     */
    private typingKinds(
        usersTyping: RoomMember[],
        delayedStopTypingTimers: Record<string, Timer>,
        previous: Record<string, TypingKind>,
    ): Record<string, TypingKind> {
        const kinds: Record<string, TypingKind> = {};
        for (const userId of Object.keys(delayedStopTypingTimers)) {
            if (previous[userId]) kinds[userId] = previous[userId];
        }
        for (const member of usersTyping) {
            // The kind of somebody who just stopped is gone already, while the list may still have them.
            kinds[member.userId] = member.typing
                ? typingKindOf(this.props.room, member.userId)
                : (previous[member.userId] ?? "text");
        }
        return kinds;
    }

    private static isVisible(state: IState): boolean {
        return state.usersTyping.length !== 0 || Object.keys(state.delayedStopTypingTimers).length !== 0;
    }

    public isVisible = (): boolean => {
        return WhoIsTypingTile.isVisible(this.state);
    };

    private onRoomTimeline = (event: MatrixEvent, room?: Room): void => {
        if (room?.roomId === this.props.room.roomId) {
            const userId = event.getSender()!;
            // remove user from usersTyping
            const usersTyping = this.state.usersTyping.filter((m) => m.userId !== userId);
            if (usersTyping.length !== this.state.usersTyping.length) {
                this.setState({ usersTyping });
            }
            // abort timer if any
            this.abortUserTimer(userId);
        }
    };

    private onRoomMemberTyping = (): void => {
        const usersTyping = WhoIsTyping.usersTypingApartFromMeAndIgnored(this.props.room);
        const delayedStopTypingTimers = this.updateDelayedStopTypingTimers(usersTyping);
        this.setState({
            delayedStopTypingTimers,
            usersTyping,
            typingKinds: this.typingKinds(usersTyping, delayedStopTypingTimers, this.state.typingKinds),
        });
    };

    private updateDelayedStopTypingTimers(usersTyping: RoomMember[]): Record<string, Timer> {
        const usersThatStoppedTyping = this.state.usersTyping.filter((a) => {
            return !usersTyping.some((b) => a.userId === b.userId);
        });
        const usersThatStartedTyping = usersTyping.filter((a) => {
            return !this.state.usersTyping.some((b) => a.userId === b.userId);
        });
        // abort all the timers for the users that started typing again
        usersThatStartedTyping.forEach((m) => {
            const timer = this.state.delayedStopTypingTimers[m.userId];
            if (timer) {
                timer.abort();
            }
        });
        // prepare new delayedStopTypingTimers object to update state with
        let delayedStopTypingTimers = Object.assign({}, this.state.delayedStopTypingTimers);
        // remove members that started typing again
        delayedStopTypingTimers = usersThatStartedTyping.reduce((delayedStopTypingTimers, m) => {
            delete delayedStopTypingTimers[m.userId];
            return delayedStopTypingTimers;
        }, delayedStopTypingTimers);
        // start timer for members that stopped typing
        delayedStopTypingTimers = usersThatStoppedTyping.reduce((delayedStopTypingTimers, m) => {
            if (!delayedStopTypingTimers[m.userId]) {
                const timer = new Timer(5000);
                delayedStopTypingTimers[m.userId] = timer;
                timer.start();
                timer.finished().then(
                    () => this.removeUserTimer(m.userId), // on elapsed
                    () => {
                        /* aborted */
                    },
                );
            }
            return delayedStopTypingTimers;
        }, delayedStopTypingTimers);

        return delayedStopTypingTimers;
    }

    private abortUserTimer(userId: string): void {
        const timer = this.state.delayedStopTypingTimers[userId];
        if (timer) {
            timer.abort();
            this.removeUserTimer(userId);
        }
    }

    private removeUserTimer(userId: string): void {
        const timer = this.state.delayedStopTypingTimers[userId];
        if (timer) {
            const delayedStopTypingTimers = Object.assign({}, this.state.delayedStopTypingTimers);
            delete delayedStopTypingTimers[userId];
            this.setState({ delayedStopTypingTimers });
        }
    }

    private renderTypingIndicatorAvatars(users: RoomMember[], limit: number): JSX.Element[] {
        let othersCount = 0;
        if (users.length > limit) {
            othersCount = users.length - limit + 1;
            users = users.slice(0, limit - 1);
        }

        const avatars = users.map((u) => {
            return (
                <MemberAvatar
                    key={u.userId}
                    member={u}
                    size="24px"
                    resizeMethod="crop"
                    viewUserOnClick={true}
                    aria-live="off"
                />
            );
        });

        if (othersCount > 0) {
            avatars.push(
                <span className="mx_WhoIsTypingTile_remainingAvatarPlaceholder" key="others">
                    +{othersCount}
                </span>,
            );
        }

        return avatars;
    }

    public render(): React.ReactNode {
        const usersTyping = [...this.state.usersTyping];
        // append the users that have been reported not typing anymore
        // but have a timeout timer running so they can disappear
        // when a message comes in
        for (const userId in this.state.delayedStopTypingTimers) {
            const member = this.props.room.getMember(userId);
            if (member) usersTyping.push(member);
        }

        // sort them so the typing members don't change order when
        // moved to delayedStopTypingTimers
        const collator = new Intl.Collator();
        usersTyping.sort((a, b) => collator.compare(a.name, b.name));

        const typingString = WhoIsTyping.whoIsTypingString(
            usersTyping,
            this.props.whoIsTypingLimit,
            (member) => this.state.typingKinds[member.userId] ?? "text",
        );
        if (!typingString) {
            return null;
        }

        return (
            <li className="mx_WhoIsTypingTile" aria-atomic="true">
                <div className="mx_WhoIsTypingTile_avatars">
                    {this.renderTypingIndicatorAvatars(usersTyping, this.props.whoIsTypingLimit)}
                </div>
                <div className="mx_WhoIsTypingTile_label">{typingString}</div>
            </li>
        );
    }
}
