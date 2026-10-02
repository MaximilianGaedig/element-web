/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type CSSProperties, type JSX } from "react";
import classNames from "classnames";

interface SkeletonBubble {
    /** Its place in the conversation. */
    id: number;
    own: boolean;
    /** Percent of the column. */
    width: number;
    /** Lines of text it stands for. */
    lines: number;
    /** Whether it follows a bubble from the same side, and so sits closer to it. */
    continuation: boolean;
}

/** A small seeded generator (mulberry32): the same conversation every time, so nothing jumps between draws. */
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The shape of a conversation: who spoke, in runs, with messages of different lengths. */
export function skeletonBubbles(count: number, seed = 20): SkeletonBubble[] {
    const random = seededRandom(seed);
    const bubbles: SkeletonBubble[] = [];
    for (let i = 0; i < count; i++) {
        const own = random() > 0.5;
        const size = random();
        bubbles.push({
            id: i,
            own,
            width: Math.round(25 + size * 40),
            lines: size > 0.8 ? 3 : size > 0.5 ? 2 : 1,
            continuation: i > 0 && bubbles[i - 1].own === own,
        });
    }
    return bubbles;
}

interface Props {
    /** How many bubbles: a screenful for a chat that is opening, a few for history being fetched. */
    count: number;
    className?: string;
    style?: CSSProperties;
}

/**
 * Bubbles with nothing in them, in the shape of a conversation, where messages are on their way: what
 * the chat will look like rather than a spinner in the middle of nothing.
 */
export function TgMessagesSkeleton({ count, className, style }: Props): JSX.Element {
    return (
        <div className={classNames("mx_TgMessagesSkeleton", className)} style={style} aria-hidden="true">
            {skeletonBubbles(count).map((bubble) => (
                <div
                    key={bubble.id}
                    className={classNames("mx_TgMessagesSkeleton_bubble", {
                        mx_TgMessagesSkeleton_own: bubble.own,
                        mx_TgMessagesSkeleton_continuation: bubble.continuation,
                    })}
                    style={{ "width": `${bubble.width}%`, "--lines": bubble.lines } as CSSProperties}
                />
            ))}
        </div>
    );
}
