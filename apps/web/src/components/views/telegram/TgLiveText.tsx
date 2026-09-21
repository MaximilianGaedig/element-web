/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The text in a picture, over the picture, the way iOS puts it there: each word sits where it was read
 * from, invisible but selectable, so a receipt can be copied and a link on a poster can be opened
 * without retyping it.
 *
 * A picture is read once and only when it is on screen, one at a time, while the browser is idle - the
 * engine is a worker with one thread, and a screenful of holiday photos is not worth warming the device
 * for. What a read found is kept for the session, so scrolling back does not read anything twice.
 */

import React, { type JSX, useEffect, useRef, useState } from "react";

import { type Detected } from "../../../utils/detect/entities";
import { type OcrResult, type OcrWord } from "../../../utils/detect/ocr";

interface Props {
    /** The event the picture belongs to: what is read is kept against it. */
    eventId: string;
    /** The picture itself, fetched only if it is going to be read. */
    source: () => Promise<Blob | string>;
    /** The picture's own pixel size, without which the words cannot be placed. */
    size?: { width: number; height: number };
}

/** A word, and the thing it turned out to be part of. */
interface Placed extends OcrWord {
    entity?: Detected;
}

/** Marks each word with the link, number or time it falls inside, so those can be acted on. */
function place(result: OcrResult, entities: Detected[]): Placed[] {
    let at = 0;
    return result.words.map((word) => {
        // The words come back in reading order, which is the order they appear in the text, so each
        // one's place in the text can be found by walking forward rather than by searching.
        const start = result.text.indexOf(word.text, at);
        if (start >= 0) at = start + word.text.length;
        const entity = entities.find((candidate) => start >= candidate.start && start < candidate.end);
        return { ...word, entity };
    });
}

function href(entity: Detected): string | undefined {
    if (entity.kind === "url") return entity.url;
    if (entity.kind === "phone") return `tel:${entity.number}`;
    return undefined;
}

export function TgLiveText({ eventId, source, size }: Props): JSX.Element | null {
    const [words, setWords] = useState<Placed[]>([]);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = root.current;
        if (!element || !size?.width || !size.height) return;
        let cancelled = false;

        // Read it when it comes into view, and not before: most pictures in a chat are scrolled past.
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                observer.disconnect();
                void (async () => {
                    const [{ readImageForEvent }, { detectEntities }] = await Promise.all([
                        import("../../../utils/detect/ocr"),
                        import("../../../utils/detect/entities"),
                    ]);
                    const result = await readImageForEvent(eventId, source, size);
                    if (cancelled || !result) return;
                    setWords(place(result, await detectEntities(result.text)));
                })();
            },
            { rootMargin: "100px" },
        );
        observer.observe(element);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [eventId, source, size]);

    return (
        <div className="mx_TgLiveText" ref={root} aria-hidden={words.length === 0}>
            {words.map((word) => {
                // Two identical words can sit in one picture, so the key is where it sits, not what it says.
                const key = `${word.left},${word.top},${word.text}`;
                const style = {
                    left: `${word.left * 100}%`,
                    top: `${word.top * 100}%`,
                    width: `${word.width * 100}%`,
                    height: `${word.height * 100}%`,
                };
                const link = word.entity && href(word.entity);
                return link ? (
                    <a
                        key={key}
                        className="mx_TgLiveText_word mx_TgLiveText_word--link"
                        style={style}
                        href={link}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {word.text}
                    </a>
                ) : (
                    <span
                        key={key}
                        className={`mx_TgLiveText_word${word.entity ? " mx_TgLiveText_word--marked" : ""}`}
                        style={style}
                    >
                        {word.text}
                    </span>
                );
            })}
        </div>
    );
}
