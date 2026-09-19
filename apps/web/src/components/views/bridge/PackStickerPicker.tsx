/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ComponentProps, type JSX, useEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import { EventType, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import Stickerpicker from "../rooms/Stickerpicker";
import ContextMenu, { ChevronFace } from "../../structures/ContextMenu";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { mediaFromMxc } from "../../../customisations/Media";
import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import Spinner from "../elements/Spinner";
import { loadStickerPacks, type PackImage, type StickerPack, stickerContent } from "../../../utils/bridge/imagePacks";

const STICKERPICKER_Z_INDEX = 3500;
const PICKER_WIDTH = 360;
const PICKER_HEIGHT = 400;
const THUMB_SIZE = 72; // Telegram Web's esgSticker size
const MAX_SEARCH_RESULTS = 200;

type Props = ComponentProps<typeof Stickerpicker>;

/** Sends a pack image as m.sticker, keeping its info and fi.mau.* bridge metadata. */
export async function sendPackSticker(
    client: MatrixClient,
    roomId: string,
    threadId: string | null | undefined,
    image: PackImage,
): Promise<void> {
    await client.sendEvent(roomId, threadId ?? null, EventType.Sticker, stickerContent(image));
}

/** Whether `ref` is (nearly) visible; always true where IntersectionObserver is unavailable. */
function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
    const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
    useEffect(() => {
        if (typeof IntersectionObserver === "undefined" || !ref.current) return;
        const observer = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), {
            rootMargin: "100px",
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [ref]);
    return inView;
}

function isAnimatedMime(mimetype: unknown): boolean {
    return mimetype === "image/gif" || mimetype === "image/webp" || mimetype === "image/apng";
}

/** One sticker; video (webm) stickers play while visible, animated images animate. */
export function StickerThumb({ image, onSend }: { image: PackImage; onSend: (image: PackImage) => void }): JSX.Element {
    const client = useMatrixClientContext();
    const ref = useRef<HTMLButtonElement>(null);
    const inView = useInView(ref);
    const media = mediaFromMxc(image.url, client);
    const mimetype = image.info.mimetype;
    const isVideo = typeof mimetype === "string" && mimetype.startsWith("video/");

    let preview: JSX.Element | null = null;
    if (inView) {
        if (isVideo) {
            const poster =
                typeof image.info.thumbnail_url === "string"
                    ? (mediaFromMxc(image.info.thumbnail_url, client).srcHttp ?? undefined)
                    : undefined;
            preview = (
                <video
                    className="mx_PackStickerPicker_media"
                    src={media.srcHttp ?? undefined}
                    poster={poster}
                    autoPlay
                    loop
                    muted
                    playsInline
                    disablePictureInPicture
                />
            );
        } else {
            // Server thumbnails are static, so animated formats load the original (stickers are small).
            const src = isAnimatedMime(mimetype)
                ? media.srcHttp
                : (media.getThumbnailOfSourceHttp(THUMB_SIZE * 2, THUMB_SIZE * 2) ?? media.srcHttp);
            preview = <img className="mx_PackStickerPicker_media" src={src ?? undefined} alt="" loading="lazy" />;
        }
    }

    return (
        <AccessibleButton
            ref={ref}
            element="button"
            className="mx_PackStickerPicker_sticker"
            title={image.body}
            aria-label={image.body}
            onClick={() => onSend(image)}
        >
            {preview}
        </AccessibleButton>
    );
}

export function PackTab({
    pack,
    selected,
    onSelect,
}: {
    pack: StickerPack;
    selected: boolean;
    onSelect: () => void;
}): JSX.Element {
    const client = useMatrixClientContext();
    const icon = pack.avatarUrl ?? pack.images[0]?.url;
    const iconMime = pack.avatarUrl ? undefined : pack.images[0]?.info.mimetype;
    const isVideo = typeof iconMime === "string" && iconMime.startsWith("video/");
    const media = icon ? mediaFromMxc(icon, client) : undefined;
    const thumbUrl = pack.avatarUrl ? undefined : pack.images[0]?.info.thumbnail_url;
    const src =
        isVideo && typeof thumbUrl === "string"
            ? mediaFromMxc(thumbUrl, client).srcHttp
            : (media?.getThumbnailOfSourceHttp(64, 64) ?? media?.srcHttp);
    return (
        <AccessibleButton
            element="button"
            role="tab"
            aria-selected={selected}
            className={classNames("mx_PackStickerPicker_tab", { mx_PackStickerPicker_tab_selected: selected })}
            title={pack.name}
            aria-label={pack.name}
            onClick={onSelect}
        >
            {isVideo && typeof thumbUrl !== "string" ? (
                <video src={media?.srcHttp ?? undefined} muted playsInline preload="metadata" />
            ) : src ? (
                <img src={src} alt="" loading="lazy" />
            ) : (
                <span>{pack.name.slice(0, 1)}</span>
            )}
        </AccessibleButton>
    );
}

export function matchesSticker(image: PackImage, query: string): boolean {
    return image.shortcode.toLowerCase().includes(query) || image.body.toLowerCase().includes(query);
}

/** Pack tabs, search and the sticker grid. `fill` sizes it to its container (Telegram emoticons dropdown). */
export function PackStickerPickerPanel({
    packs,
    onSend,
    fill,
}: {
    packs: StickerPack[] | null;
    onSend: (image: PackImage) => void;
    fill?: boolean;
}): JSX.Element {
    const [selectedId, setSelectedId] = useState<string | undefined>();
    const [query, setQuery] = useState("");
    const selected = packs?.find((p) => p.id === selectedId) ?? packs?.[0];
    const q = query.trim().toLowerCase();

    const images = useMemo(() => {
        if (!packs) return [];
        if (!q) return selected?.images ?? [];
        const out: PackImage[] = [];
        for (const pack of packs) {
            for (const image of pack.images) {
                if (matchesSticker(image, q)) out.push(image);
                if (out.length >= MAX_SEARCH_RESULTS) return out;
            }
        }
        return out;
    }, [packs, selected, q]);

    let body: JSX.Element;
    if (!packs) {
        body = (
            <div className="mx_PackStickerPicker_status">
                <Spinner />
                {_t("bridge|sticker_picker_loading")}
            </div>
        );
    } else if (!images.length) {
        body = <div className="mx_PackStickerPicker_status">{_t("bridge|sticker_picker_empty")}</div>;
    } else {
        body = (
            <div className="mx_PackStickerPicker_grid" role="tabpanel" aria-label={q ? undefined : selected?.name}>
                {images.map((image) => (
                    <StickerThumb key={`${image.url}|${image.shortcode}`} image={image} onSend={onSend} />
                ))}
            </div>
        );
    }

    return (
        <div
            className="mx_PackStickerPicker"
            style={fill ? { width: "100%", height: "100%" } : { width: PICKER_WIDTH, height: PICKER_HEIGHT }}
        >
            <input
                className="mx_PackStickerPicker_search"
                type="search"
                placeholder={_t("bridge|sticker_picker_search")}
                aria-label={_t("bridge|sticker_picker_search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
            />
            {!q && selected && <div className="mx_PackStickerPicker_packName">{selected.name}</div>}
            <div className="mx_PackStickerPicker_body">{body}</div>
            {packs && packs.length > 1 && (
                <div
                    className="mx_PackStickerPicker_tabs"
                    role="tablist"
                    aria-label={_t("bridge|sticker_picker_title")}
                >
                    {packs.map((pack) => (
                        <PackTab
                            key={pack.id}
                            pack={pack}
                            selected={!q && pack.id === selected?.id}
                            onSelect={() => {
                                setQuery("");
                                setSelectedId(pack.id);
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/** The room's MSC2545 sticker packs, loaded while `active`; null until loaded. */
export function useStickerPacks(room: Room, active: boolean): StickerPack[] | null {
    const client = useMatrixClientContext();
    const [packs, setPacks] = useState<StickerPack[] | null>(null);
    const [loadedFor, setLoadedFor] = useState<string | undefined>();
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        loadStickerPacks(client, room).then(
            (loaded) => {
                if (cancelled) return;
                setPacks(loaded);
                setLoadedFor(room.roomId);
            },
            (e) => {
                logger.warn("Failed to load sticker packs", e);
                if (cancelled) return;
                setPacks([]);
                setLoadedFor(room.roomId);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [client, room, active]);
    return loadedFor === room.roomId ? packs : null;
}

/**
 * The composer's sticker picker: MSC2545 image packs (e.g. the Telegram bridge's sticker packs)
 * when there are any, otherwise Element's integration-manager sticker picker.
 */
export default function PackStickerPicker(props: Props): JSX.Element {
    const client = useMatrixClientContext();
    const { room, threadId, isStickerPickerOpen, setStickerPickerOpen } = props;
    const current = useStickerPacks(room, isStickerPickerOpen);
    const useElementPicker = current !== null && current.length === 0;

    const onSend = (image: PackImage): void => {
        setStickerPickerOpen(false);
        sendPackSticker(client, room.roomId, threadId, image).catch((e) => logger.error("Failed to send sticker", e));
    };

    return (
        <>
            <Stickerpicker {...props} isStickerPickerOpen={isStickerPickerOpen && useElementPicker} />
            {isStickerPickerOpen && !useElementPicker && (
                <ContextMenu
                    chevronFace={ChevronFace.Bottom}
                    menuWidth={PICKER_WIDTH}
                    menuHeight={PICKER_HEIGHT}
                    onFinished={() => setStickerPickerOpen(false)}
                    menuPaddingTop={0}
                    menuPaddingLeft={0}
                    menuPaddingRight={0}
                    zIndex={STICKERPICKER_Z_INDEX}
                    mountAsChild={true}
                    {...props.menuPosition}
                >
                    <PackStickerPickerPanel packs={current} onSend={onSend} />
                </ContextMenu>
            )}
        </>
    );
}
