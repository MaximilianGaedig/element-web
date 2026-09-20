/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import {
    type MatrixEvent,
    EventType,
    RelationType,
    type Relations,
    RelationsEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import RoomContext from "../../../contexts/RoomContext";
import { type FocusComposerPayload } from "../../../dispatcher/payloads/FocusComposerPayload";
import { isReactionAllowed } from "../../../utils/bridge/roomFeatures";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";
import { haptic } from "../../../utils/haptics";
import { type TimelineRenderingType } from "../../../contexts/RoomContext";

/** The user's own reactions to an event, by emoji: the reaction event's ID. */
export function myReactionsTo(reactions: Relations | null | undefined): Record<string, string> {
    if (!reactions) return {};
    const userId = MatrixClientPeg.safeGet().getSafeUserId();
    const myAnnotations = reactions.getAnnotationsBySender()?.[userId] ?? new Set<MatrixEvent>();
    return Object.fromEntries(
        [...myAnnotations]
            .filter((event) => !event.isRedacted())
            .map((event) => [event.getRelation()?.key, event.getId()]),
    );
}

/**
 * Reacts to an event with `reaction`, or takes the user's own reaction back if it is already there.
 * Returns whether a reaction was added (so the emoji picker knows whether to count it as recent).
 */
export function toggleReaction(
    mxEvent: MatrixEvent,
    reaction: string,
    reactions: Relations | null | undefined,
    context: { room?: Room | null; canSelfRedact: boolean; timelineRenderingType: TimelineRenderingType },
): boolean {
    const myReactions = myReactionsTo(reactions);
    // Quick reactions don't honour isEmojiDisabled, so check again before sending.
    if (!myReactions.hasOwnProperty(reaction) && !isReactionAllowed(context.room ?? null, reaction)) {
        return false;
    }
    haptic("light");
    if (myReactions.hasOwnProperty(reaction)) {
        if (mxEvent.isRedacted() || !context.canSelfRedact) return false;

        void MatrixClientPeg.safeGet().redactEvent(mxEvent.getRoomId()!, myReactions[reaction]);
        dis.dispatch<FocusComposerPayload>({
            action: Action.FocusAComposer,
            context: context.timelineRenderingType,
        });
        // Tell the emoji picker not to bump this in the more frequently used list.
        return false;
    }
    void MatrixClientPeg.safeGet().sendEvent(mxEvent.getRoomId()!, EventType.Reaction, {
        "m.relates_to": {
            rel_type: RelationType.Annotation,
            event_id: mxEvent.getId()!,
            key: reaction,
        },
    });
    dis.dispatch({ action: "message_sent" });
    dis.dispatch<FocusComposerPayload>({
        action: Action.FocusAComposer,
        context: context.timelineRenderingType,
    });
    return true;
}

interface IProps {
    mxEvent: MatrixEvent;
    reactions?: Relations | null | undefined;
    onFinished(): void;
}

interface IState {
    selectedEmojis: Set<string>;
}

class ReactionPicker extends React.Component<IProps, IState> {
    public static contextType = RoomContext;
    declare public context: React.ContextType<typeof RoomContext>;

    public constructor(props: IProps) {
        super(props);

        this.state = {
            selectedEmojis: new Set(Object.keys(this.getReactions())),
        };
    }

    public componentDidMount(): void {
        this.addListeners();
    }

    public componentDidUpdate(prevProps: IProps): void {
        if (prevProps.reactions !== this.props.reactions) {
            this.addListeners();
            this.onReactionsChange();
        }
    }

    private addListeners(): void {
        if (this.props.reactions) {
            this.props.reactions.on(RelationsEvent.Add, this.onReactionsChange);
            this.props.reactions.on(RelationsEvent.Remove, this.onReactionsChange);
            this.props.reactions.on(RelationsEvent.Redaction, this.onReactionsChange);
        }
    }

    public componentWillUnmount(): void {
        if (this.props.reactions) {
            this.props.reactions.removeListener(RelationsEvent.Add, this.onReactionsChange);
            this.props.reactions.removeListener(RelationsEvent.Remove, this.onReactionsChange);
            this.props.reactions.removeListener(RelationsEvent.Redaction, this.onReactionsChange);
        }
    }

    private getReactions(): Record<string, string> {
        if (!this.props.reactions) {
            return {};
        }
        const userId = MatrixClientPeg.safeGet().getSafeUserId();
        const myAnnotations = this.props.reactions.getAnnotationsBySender()?.[userId] ?? new Set<MatrixEvent>();
        return Object.fromEntries(
            [...myAnnotations]
                .filter((event) => !event.isRedacted())
                .map((event) => [event.getRelation()?.key, event.getId()]),
        );
    }

    private onReactionsChange = (): void => {
        this.setState({
            selectedEmojis: new Set(Object.keys(this.getReactions())),
        });
    };

    private onChoose = (reaction: string): boolean => {
        // Closing the picker first, as before: the reaction is sent from the toggle below.
        const allowed =
            this.getReactions().hasOwnProperty(reaction) || isReactionAllowed(this.context.room ?? null, reaction);
        if (!allowed) return false;
        this.componentWillUnmount();
        this.props.onFinished();
        return toggleReaction(this.props.mxEvent, reaction, this.props.reactions, {
            room: this.context.room,
            canSelfRedact: this.context.canSelfRedact,
            timelineRenderingType: this.context.timelineRenderingType,
        });
    };

    private isEmojiDisabled = (unicode: string): boolean => {
        // The bridge's remote network may only accept some reactions.
        if (!this.getReactions()[unicode]) return !isReactionAllowed(this.context.room ?? null, unicode);
        if (this.context.canSelfRedact) return false;

        return true;
    };

    public render(): React.ReactNode {
        const picker = (
            <EmojiPickerWithRecents
                onChoose={this.onChoose}
                isEmojiDisabled={this.isEmojiDisabled}
                onFinished={this.props.onFinished}
                selectedEmojis={this.state.selectedEmojis}
            />
        );
        // Like Telegram, a network's reaction limit just shows as the allowed set, without a note.
        return picker;
    }
}

export default ReactionPicker;
