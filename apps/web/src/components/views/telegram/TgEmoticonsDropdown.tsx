/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { ReactionIcon, StickerIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import AccessibleButton from "../elements/AccessibleButton";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";
import { sendPackSticker, useStickerPacks } from "../bridge/PackStickerPicker";
import { TgStickersPanel } from "./TgStickersPanel";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { type PackImage } from "../../../utils/bridge/imagePacks";
import UIStore from "../../../stores/UIStore";

type Tab = "emoji" | "stickers";

/** tweb DropdownHover: open after hovering the button this long, close this long after leaving. */
const HOVER_OPEN_MS = 200;
const HOVER_CLOSE_MS = 200;

interface Props {
    room: Room;
    threadId: string | null;
    addEmoji: (unicode: string) => boolean;
}

/**
 * Telegram Web K's emoticons dropdown (src/components/emoticonsDropdown, scss/partials/_emojiDropdown.scss):
 * one panel for emoji and stickers (GIFs when there's a source for them), opened from the smiley button at
 * the end of the input - on click, or by hovering it. It sits above the input's inline end, 23.875rem x
 * 26.25rem with a 1.25rem radius, scales in from .85, and has its tabs along the bottom.
 */
export function TgEmoticonsDropdown({ room, threadId, addEmoji }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>("emoji");
    const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
    const button = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const hoverTimer = useRef<number | undefined>(undefined);
    // Like tweb's DropdownHover, leaving with the mouse only closes a dropdown that hovering opened.
    const openedByHover = useRef(false);
    const packs = useStickerPacks(room, open);

    const place = useCallback(() => {
        const composer = button.current?.closest(".mx_MessageComposer_wrapper") ?? button.current;
        const rect = composer?.getBoundingClientRect();
        if (!rect) return;
        setAnchor({
            right: document.documentElement.clientWidth - rect.right,
            bottom: UIStore.instance.windowHeight - rect.top + 8,
        });
    }, []);
    useLayoutEffect(() => {
        if (open) place();
    }, [open, place]);

    const close = useCallback(() => setOpen(false), []);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node;
            if (panel.current?.contains(t) || button.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("mousedown", onDown, true);
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", place);
        return () => {
            window.removeEventListener("mousedown", onDown, true);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", place);
        };
    }, [open, place]);

    const hover = (entering: boolean): void => {
        window.clearTimeout(hoverTimer.current);
        if (entering) {
            if (open) return;
            hoverTimer.current = window.setTimeout(() => {
                openedByHover.current = true;
                setOpen(true);
            }, HOVER_OPEN_MS);
        } else if (openedByHover.current) {
            hoverTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
        }
    };
    useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

    const onSticker = (image: PackImage): void => {
        setOpen(false);
        sendPackSticker(client, room.roomId, threadId, image).catch((e) => logger.error("Failed to send sticker", e));
    };

    return (
        <>
            <AccessibleButton
                ref={button}
                className={classNames("mx_MessageComposer_button mx_TgEmoticonsButton", {
                    mx_TgEmoticonsButton_active: open,
                })}
                title={_t("common|emoji")}
                onClick={() => {
                    window.clearTimeout(hoverTimer.current);
                    // A click on a hover-opened dropdown pins it open, like tweb.
                    if (open && openedByHover.current) {
                        openedByHover.current = false;
                        return;
                    }
                    openedByHover.current = false;
                    setOpen(!open);
                }}
                onMouseEnter={() => hover(true)}
                onMouseLeave={() => hover(false)}
            >
                <ReactionIcon />
            </AccessibleButton>
            {open &&
                anchor &&
                createPortal(
                    <div
                        ref={panel}
                        className="mx_TgEmoticonsDropdown"
                        style={{ right: anchor.right, bottom: anchor.bottom }}
                        onMouseEnter={() => window.clearTimeout(hoverTimer.current)}
                        onMouseLeave={() => hover(false)}
                    >
                        <div className="mx_TgEmoticonsDropdown_body">
                            {tab === "emoji" ? (
                                <EmojiPickerWithRecents onChoose={addEmoji} onFinished={close} />
                            ) : (
                                <TgStickersPanel packs={packs} onSend={onSticker} />
                            )}
                        </div>
                        <div className="mx_TgEmoticonsDropdown_tabs" role="tablist">
                            {(["emoji", "stickers"] as Tab[]).map((t) => (
                                <AccessibleButton
                                    key={t}
                                    role="tab"
                                    aria-selected={tab === t}
                                    className={classNames("mx_TgEmoticonsDropdown_tab", {
                                        mx_TgEmoticonsDropdown_tab_active: tab === t,
                                    })}
                                    onClick={() => setTab(t)}
                                    aria-label={
                                        t === "emoji" ? _t("common|emoji") : _t("bridge|telegram_emoticons_stickers")
                                    }
                                    title={
                                        t === "emoji" ? _t("common|emoji") : _t("bridge|telegram_emoticons_stickers")
                                    }
                                >
                                    {t === "emoji" ? <ReactionIcon /> : <StickerIcon />}
                                </AccessibleButton>
                            ))}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
