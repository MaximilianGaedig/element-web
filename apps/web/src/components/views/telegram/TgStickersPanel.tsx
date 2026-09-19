/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { _t } from "../../../languageHandler";
import Spinner from "../elements/Spinner";
import { matchesSticker, PackTab, StickerThumb } from "../bridge/PackStickerPicker";
import { type PackImage, type StickerPack } from "../../../utils/bridge/imagePacks";

/** tweb mediaSizes esgSticker (72px) and .super-stickers gap (.25rem). */
const STICKER_SIZE = 72;
const GAP = 4;
/** tweb .category-title: .75rem + 1.1875rem line + .375rem. */
const TITLE_HEIGHT = 12 + 19 + 6;
const MAX_SEARCH_RESULTS = 200;

interface Props {
    packs: StickerPack[] | null;
    onSend: (image: PackImage) => void;
}

/**
 * Telegram Web K's stickers tab (src/components/emoticonsDropdown/tabs/stickers.ts,
 * scss/partials/_emojiDropdown.scss): a search field, the row of pack icons, and every pack in one
 * continuous list under its title. Scrolling the list moves the active pack in the icon row (which
 * scrolls to keep it in view); clicking an icon scrolls the list to that pack. A pack's grid is only
 * mounted near the viewport; until then it keeps its exact height, so the list scrolls smoothly.
 */
export function TgStickersPanel({ packs, onSend }: Props): JSX.Element {
    const [query, setQuery] = useState("");
    const [activeId, setActiveId] = useState<string | undefined>();
    const [width, setWidth] = useState(0);
    const list = useRef<HTMLDivElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const sections = useRef(new Map<string, HTMLElement>());
    const scrollingTo = useRef<string | undefined>(undefined);
    const q = query.trim().toLowerCase();

    useEffect(() => {
        const el = list.current;
        if (!el) return;
        setWidth(el.clientWidth);
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, [packs]);
    const columns = Math.max(1, Math.floor((width - 6 + GAP) / (STICKER_SIZE + GAP)));
    const sectionHeight = (pack: StickerPack): number =>
        TITLE_HEIGHT + Math.ceil(pack.images.length / columns) * (STICKER_SIZE + GAP);

    // Scroll spy: the active pack is the last one whose section starts above the list's top.
    const onScroll = useCallback(() => {
        const el = list.current;
        if (!el || !packs?.length) return;
        const top = el.scrollTop + 1;
        let current = packs[0].id;
        for (const pack of packs) {
            const section = sections.current.get(pack.id);
            if (section && section.offsetTop <= top) current = pack.id;
            else if (section) break;
        }
        if (scrollingTo.current && scrollingTo.current !== current) return;
        scrollingTo.current = undefined;
        setActiveId(current);
    }, [packs]);

    // Keep the active pack's icon in view in the icon row.
    useEffect(() => {
        if (!activeId) return;
        const strip = menu.current;
        const icon = strip?.querySelector<HTMLElement>(`[data-pack-id="${CSS.escape(activeId)}"]`);
        // Scroll only the strip: scrollIntoView would also scroll every ancestor, the whole page included.
        if (strip && icon) scrollStripTo(strip, icon, "nearest");
    }, [activeId]);

    const jumpTo = (packId: string): void => {
        const section = sections.current.get(packId);
        if (!section || !list.current) return;
        scrollingTo.current = packId;
        setActiveId(packId);
        list.current.scrollTo({ top: section.offsetTop });
    };

    const results = useMemo(() => {
        if (!q || !packs) return [];
        const out: PackImage[] = [];
        for (const pack of packs) {
            for (const image of pack.images) {
                if (matchesSticker(image, q)) out.push(image);
                if (out.length >= MAX_SEARCH_RESULTS) return out;
            }
        }
        return out;
    }, [packs, q]);

    let body: JSX.Element;
    if (!packs) {
        body = (
            <div className="mx_TgStickersPanel_status">
                <Spinner />
            </div>
        );
    } else if (q) {
        body = results.length ? (
            <div className="mx_TgStickersPanel_grid">
                {results.map((image) => (
                    <StickerThumb key={`${image.url}|${image.shortcode}`} image={image} onSend={onSend} />
                ))}
            </div>
        ) : (
            <div className="mx_TgStickersPanel_status">{_t("bridge|sticker_picker_empty")}</div>
        );
    } else if (!packs.length) {
        body = <div className="mx_TgStickersPanel_status">{_t("bridge|sticker_picker_empty")}</div>;
    } else {
        body = (
            <>
                {packs.map((pack) => (
                    <PackSection
                        key={pack.id}
                        pack={pack}
                        height={sectionHeight(pack)}
                        root={list}
                        onSend={onSend}
                        sectionRef={(el) => {
                            if (el) sections.current.set(pack.id, el);
                            else sections.current.delete(pack.id);
                        }}
                    />
                ))}
            </>
        );
    }

    return (
        <div className="mx_TgStickersPanel">
            <div className="mx_TgStickersPanel_search">
                <input
                    type="search"
                    placeholder={_t("bridge|sticker_picker_search")}
                    aria-label={_t("bridge|sticker_picker_search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            {!q && packs && packs.length > 1 && (
                <div ref={menu} className="mx_TgStickersPanel_menu" role="tablist">
                    {packs.map((pack) => (
                        <div key={pack.id} data-pack-id={pack.id}>
                            <PackTab
                                pack={pack}
                                selected={pack.id === (activeId ?? packs[0].id)}
                                onSelect={() => jumpTo(pack.id)}
                            />
                        </div>
                    ))}
                </div>
            )}
            <div ref={list} className="mx_TgStickersPanel_list" onScroll={onScroll}>
                {body}
            </div>
        </div>
    );
}

/** Scrolls a horizontal strip (only) so `item` is in view: at the nearest edge, or centred. */
export function scrollStripTo(strip: HTMLElement, item: HTMLElement, mode: "nearest" | "center"): void {
    const left = item.offsetLeft - strip.offsetLeft;
    const right = left + item.offsetWidth;
    let target = strip.scrollLeft;
    if (mode === "center") target = left - (strip.clientWidth - item.offsetWidth) / 2;
    else if (left < strip.scrollLeft) target = left;
    else if (right > strip.scrollLeft + strip.clientWidth) target = right - strip.clientWidth;
    strip.scrollTo({ left: target, behavior: "smooth" });
}

/** One pack: its title and grid; the grid mounts when the section nears the viewport. */
function PackSection({
    pack,
    height,
    root,
    onSend,
    sectionRef,
}: {
    pack: StickerPack;
    height: number;
    root: React.RefObject<HTMLDivElement | null>;
    onSend: (image: PackImage) => void;
    sectionRef: (el: HTMLElement | null) => void;
}): JSX.Element {
    const ref = useRef<HTMLElement | null>(null);
    const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
    useEffect(() => {
        if (typeof IntersectionObserver === "undefined" || !ref.current) return;
        const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
            root: root.current,
            rootMargin: "300px 0px",
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [root]);
    return (
        <section
            ref={(el) => {
                ref.current = el;
                sectionRef(el);
            }}
            className="mx_TgStickersPanel_section"
            style={{ minHeight: height }}
        >
            <div className="mx_TgStickersPanel_title">{pack.name}</div>
            {near && (
                <div className="mx_TgStickersPanel_grid">
                    {pack.images.map((image) => (
                        <StickerThumb key={`${image.url}|${image.shortcode}`} image={image} onSend={onSend} />
                    ))}
                </div>
            )}
        </section>
    );
}
