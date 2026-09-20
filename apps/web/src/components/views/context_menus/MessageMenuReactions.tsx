/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useMemo } from "react";
import { type MatrixEvent, type Relations } from "matrix-js-sdk/src/matrix";
import ReactionAddIcon from "@vector-im/compound-design-tokens/assets/web/icons/reaction-add";

import RoomContext from "../../../contexts/RoomContext";
import { _t } from "../../../languageHandler";
import * as recent from "../../../emojipicker/recent";
import { isReactionAllowed } from "../../../utils/bridge/roomFeatures";
import { myReactionsTo, toggleReaction } from "../emojipicker/ReactionPicker";

/** What the row offers before the user has used enough emoji to have favourites. */
const DEFAULT_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const QUICK_COUNT = 6;

interface Props {
    mxEvent: MatrixEvent;
    reactions?: Relations | null;
    /** Called after a reaction was sent or taken back. */
    onFinished(): void;
    /** Opens the full emoji picker. */
    onMore(): void;
    moreRef?: React.Ref<HTMLButtonElement>;
}

/**
 * A row of emoji at the top of the message menu, one click to react: the user's most used emoji, then
 * the usual ones, then a button for the full picker. Element's own menu, with the reactions where the
 * hand already is.
 */
export function MessageMenuReactions({ mxEvent, reactions, onFinished, onMore, moreRef }: Props): JSX.Element {
    const roomContext = useContext(RoomContext);
    const mine = myReactionsTo(reactions);
    const emoji = useMemo(() => {
        const list: string[] = [];
        for (const candidate of [...recent.get(), ...DEFAULT_QUICK_REACTIONS]) {
            if (!list.includes(candidate)) list.push(candidate);
            if (list.length === QUICK_COUNT) break;
        }
        return list;
    }, []);

    return (
        <div className="mx_MessageMenuReactions" role="group" aria-label={_t("action|react")}>
            {emoji.map((unicode) => {
                const selected = mine.hasOwnProperty(unicode);
                const disabled = selected ? !roomContext.canSelfRedact : !isReactionAllowed(roomContext.room ?? null, unicode);
                return (
                    <button
                        key={unicode}
                        type="button"
                        className="mx_MessageMenuReactions_emoji"
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={(): void => {
                            onFinished();
                            toggleReaction(mxEvent, unicode, reactions, {
                                room: roomContext.room,
                                canSelfRedact: roomContext.canSelfRedact,
                                timelineRenderingType: roomContext.timelineRenderingType,
                            });
                        }}
                    >
                        {unicode}
                    </button>
                );
            })}
            <button
                type="button"
                className="mx_MessageMenuReactions_more"
                aria-label={_t("action|react")}
                title={_t("action|react")}
                onClick={onMore}
                ref={moreRef}
            >
                <ReactionAddIcon />
            </button>
        </div>
    );
}
