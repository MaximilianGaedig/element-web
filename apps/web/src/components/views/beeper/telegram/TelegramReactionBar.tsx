/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The reactions bar on top of Telegram Web K's message menu (GPL-3.0,
 * https://github.com/morethanwords/tweb): components/chat/reactionsMenu.ts ChatReactionsMenu, its
 * `.btn-menu-reactions-container` with REACTIONS_MAX_LENGTH reactions and a "more" (down) button
 * that expands to the full emoji picker.
 */

import React, { type JSX } from "react";
import classNames from "classnames";

import { _t } from "../../../../languageHandler";
import { TgIcon } from "./TelegramIcons";
import { splitMenuReactions } from "../../../../utils/beeper/telegramMenu";

interface Props {
    /** Every reaction on offer, in order (getMenuReactions). */
    reactions: string[];
    /** Reactions we have already sent on the message. */
    chosen: Set<string>;
    onChoose: (emoji: string) => void;
    onMore: () => void;
}

export default function TelegramReactionBar({ reactions, chosen, onChoose, onMore }: Props): JSX.Element {
    const { shown, hasMore } = splitMenuReactions(reactions);
    return (
        <div className="mx_TgMenu_reactionsContainer">
            <div className="mx_TgMenu_reactions" role="group" aria-label={_t("action|react")}>
                {shown.map((emoji) => (
                    <button
                        key={emoji}
                        type="button"
                        className={classNames("mx_TgMenu_reaction", { mx_TgMenu_reaction_chosen: chosen.has(emoji) })}
                        aria-label={emoji}
                        aria-pressed={chosen.has(emoji)}
                        onClick={() => onChoose(emoji)}
                    >
                        <span className="mx_TgMenu_reactionEmoji">{emoji}</span>
                    </button>
                ))}
                {hasMore && (
                    <button
                        type="button"
                        className="mx_TgMenu_reactionsMore"
                        aria-label={_t("beeper|telegram_menu_more_reactions")}
                        onClick={onMore}
                    >
                        <TgIcon name="down" />
                    </button>
                )}
            </div>
            <span className="mx_TgMenu_reactionsBubble" aria-hidden="true" />
        </div>
    );
}
