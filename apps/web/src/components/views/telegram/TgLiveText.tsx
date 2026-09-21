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

import TextIcon from "@vector-im/compound-design-tokens/assets/web/icons/text-formatting";

import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { type Detected } from "../../../utils/detect/entities";
import { type OcrResult, type OcrWord } from "../../../utils/detect/ocr";
import { actionOf, type FoundBarcode } from "../../../utils/detect/barcodes";
import { copyPlaintext } from "../../../utils/strings";

interface Props {
    /** The event the picture belongs to: what is read is kept against it. */
    eventId: string;
    /** The room it was sent in, so what was read can be shared with the server and searched for. */
    roomId: string;
    /** The picture itself, fetched only if it is going to be read. */
    source: () => Promise<Blob | string>;
    /** The picture's own pixel size, without which the words cannot be placed. */
    size?: { width: number; height: number };
}

interface VideoProps {
    /** The event the video belongs to. */
    eventId: string;
    /** The video on screen, whose paused frame is what gets read. */
    video: React.RefObject<HTMLVideoElement | null>;
}

/** Nothing found, as one array rather than a new one on every render. */
const NONE: FoundBarcode[] = [];

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
    if (entity.kind === "url" || entity.kind === "address") return entity.url;
    if (entity.kind === "phone") return `tel:${entity.number}`;
    return undefined;
}

export function TgLiveText({ eventId, roomId, source, size }: Props): JSX.Element | null {
    const [words, setWords] = useState<Placed[]>([]);
    const [codes, setCodes] = useState<FoundBarcode[]>([]);
    // iOS keeps read text invisible until you ask for it, and marks the picture with a glyph to say
    // there is some. Without that nothing on screen says a picture was read at all.
    const [revealed, setRevealed] = useState(false);
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
                    // Fetched once and read twice: the words in it, and the codes in it.
                    const picture = await source();
                    const [{ words, text }, found] = await Promise.all([
                        readAndPlace(eventId, async () => picture, size),
                        readCodes(eventId, picture, size),
                    ]);
                    if (cancelled) return;
                    setWords(words);
                    setCodes(found);
                    // Read here, findable everywhere: the server indexes what was read as if it were the
                    // message's own words, so this picture can be searched for from a device that never
                    // opened it. Only a reading with something in it is sent - "this said nothing" from a
                    // thumbnail is not worth keeping, and is what the careful pass over the history is for.
                    if (text) {
                        const { saveMediaText } = await import("../../../utils/detect/mediaText");
                        void saveMediaText(MatrixClientPeg.safeGet(), roomId, eventId, "ocr", text);
                    }
                })();
            },
            { rootMargin: "100px" },
        );
        observer.observe(element);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [eventId, roomId, source, size]);

    return (
        <Words
            words={words}
            codes={codes}
            elementRef={root}
            revealed={revealed}
            onReveal={words.length ? () => setRevealed((on) => !on) : undefined}
        />
    );
}

/**
 * The text in a video, on the frame it is paused at.
 *
 * A video is read when it is stopped, because that is when there is something to read and when the
 * device has a moment: a frame is taken as it stands on screen and read like a picture. What the frame
 * said is not sent to the server - a paused frame is a fragment of a video, and reading a video properly
 * (frames through it, and what was said in it) is the careful pass's job, not a pause's.
 */
export function TgLiveTextVideo({ eventId, video }: VideoProps): JSX.Element | null {
    const [words, setWords] = useState<Placed[]>([]);

    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let cancelled = false;

        const onPause = (): void => {
            const frame = frameOf(element);
            if (!frame) return;
            void (async () => {
                // Keyed by the second it was paused at: a different frame is a different picture, and
                // pausing at the same place twice should not read it twice.
                const at = `${eventId}@${Math.round(element.currentTime)}`;
                const { words } = await readAndPlace(at, async () => frame, {
                    width: element.videoWidth,
                    height: element.videoHeight,
                });
                if (!cancelled) setWords(words);
            })();
        };
        // Nothing to select while it is moving, and the frame it was read from is gone.
        const onPlay = (): void => setWords([]);

        element.addEventListener("pause", onPause);
        element.addEventListener("seeked", onPause);
        element.addEventListener("play", onPlay);
        return () => {
            cancelled = true;
            element.removeEventListener("pause", onPause);
            element.removeEventListener("seeked", onPause);
            element.removeEventListener("play", onPlay);
        };
    }, [eventId, video]);

    return <Words words={words} />;
}

/** The frame on screen, as a picture, or nothing where the video has not drawn one yet. */
function frameOf(video: HTMLVideoElement): Promise<Blob> | undefined {
    if (!video.videoWidth || !video.videoHeight) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    try {
        context.drawImage(video, 0, 0);
    } catch {
        // A video served from somewhere that will not allow it to be read back.
        return undefined;
    }
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no frame"))), "image/png");
    });
}

/** The codes in a picture, read where the device can read them at all. */
async function readCodes(
    key: string,
    picture: Blob | string,
    size: { width: number; height: number },
): Promise<FoundBarcode[]> {
    const { readBarcodesForEvent } = await import("../../../utils/detect/barcodes");
    return readBarcodesForEvent(key, picture, size);
}

/** Reads a picture and marks the words that turned out to be part of something worth acting on. */
async function readAndPlace(
    key: string,
    source: () => Promise<Blob | string>,
    size: { width: number; height: number },
): Promise<{ words: Placed[]; text: string }> {
    const [{ readImageForEvent }, { detectEntities }] = await Promise.all([
        import("../../../utils/detect/ocr"),
        import("../../../utils/detect/entities"),
    ]);
    const result = await readImageForEvent(key, source, size);
    if (!result) return { words: [], text: "" };
    return { words: place(result, await detectEntities(result.text)), text: result.text };
}

/** The words themselves: where they were read from, invisible, and selectable. */
function Words({
    words,
    codes = NONE,
    elementRef,
    revealed = false,
    onReveal,
}: {
    words: Placed[];
    /** The codes in the same picture, drawn over where they sit. */
    codes?: FoundBarcode[];
    /** The image overlay is what is watched for coming into view, so its caller holds a ref to it. */
    elementRef?: React.RefObject<HTMLDivElement | null>;
    /** Whether the words are shown as well as selectable. */
    revealed?: boolean;
    /** Offered where there is text to show; absent where the picture said nothing. */
    onReveal?: () => void;
}): JSX.Element {
    return (
        <div
            className="mx_TgLiveText"
            ref={elementRef}
            data-revealed={revealed ? "" : undefined}
            aria-hidden={words.length === 0}
        >
            {onReveal && (
                <button
                    type="button"
                    className="mx_TgLiveText_reveal"
                    aria-pressed={revealed}
                    title={_t("timeline|read_text|action")}
                    aria-label={_t("timeline|read_text|action")}
                    onClick={(event) => {
                        // The picture's own click opens the viewer; this one is about the text on it.
                        event.stopPropagation();
                        event.preventDefault();
                        onReveal();
                    }}
                >
                    <TextIcon />
                </button>
            )}
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
            {codes.map((code) => (
                <Code key={`${code.left},${code.top},${code.text}`} code={code} />
            ))}
        </div>
    );
}

/**
 * A code in the picture, marked where it sits and offering what it says: the link it points at, the
 * network it names, or the number to copy.
 */
function Code({ code }: { code: FoundBarcode }): JSX.Element {
    const action = actionOf(code);
    const style = {
        left: `${code.left * 100}%`,
        top: `${code.top * 100}%`,
        width: `${code.width * 100}%`,
        height: `${code.height * 100}%`,
    };
    const common = {
        "className": "mx_TgLiveText_code",
        style,
        "title": action.label,
        "aria-label": action.label,
        "onClick": (event: React.MouseEvent) => event.stopPropagation(),
    };
    return action.href ? (
        <a {...common} href={action.href} target="_blank" rel="noreferrer noopener">
            <span className="mx_TgLiveText_code_label">{action.label}</span>
        </a>
    ) : (
        <button
            {...common}
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                void copyPlaintext(action.copy ?? code.text);
            }}
        >
            <span className="mx_TgLiveText_code_label">{action.label}</span>
        </button>
    );
}
