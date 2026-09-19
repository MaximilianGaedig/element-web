/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * tweb's reply block (components/chat/replyContainer.ts + scss/partials/_quote.scss .quote-like and
 * _chatPinned.scss .reply): a rounded box tinted with the replied-to sender's colour, a 3px bar in
 * that colour, the sender's name in it over one line of the message, and a 32px thumbnail for media.
 * Used in bubbles and, as "Reply to <name>", in the composer's reply row.
 */

import React, { type JSX, type ReactNode, useEffect, useState } from "react";
import classNames from "classnames";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import { getUserNameColorClass } from "../../../utils/FormattingUtils";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { MessagePreviewStore } from "../../../stores/message-preview/MessagePreviewStore";
import { MatrixClientPeg } from "../../../MatrixClientPeg";

/** The one line tweb shows for a message: its media kind for media, else the text. */
export function replyPreviewText(ev: MatrixEvent): string {
    const content = ev.getContent();
    if (ev.getType() === "m.sticker") return _t("tg_layout|reply_sticker");
    switch (content.msgtype) {
        case MsgType.Image:
            return content.info?.mimetype === "image/gif" ? _t("tg_layout|reply_gif") : _t("tg_layout|reply_photo");
        case MsgType.Video:
            return _t("tg_layout|reply_video");
        case MsgType.Audio:
            return content["org.matrix.msc3245.voice"] ? _t("tg_layout|reply_voice") : (content.body ?? "");
        case MsgType.File:
            return content.body ?? "";
    }
    return MessagePreviewStore.instance.generatePreviewForEvent(ev) || content.body || "";
}

function hasThumbnail(ev: MatrixEvent): boolean {
    const type = ev.getContent().msgtype;
    return ev.getType() === "m.sticker" || type === MsgType.Image || type === MsgType.Video;
}

/** tweb wrapReplyMedia: a small cover thumbnail of the replied-to media. */
function useReplyThumbnail(ev: MatrixEvent): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!hasThumbnail(ev)) return;
        let cancelled = false;
        const helper = new MediaEventHelper(ev);
        const load = async (): Promise<string | null> => {
            try {
                return (await helper.thumbnailUrl.value) ?? (await helper.sourceUrl.value);
            } catch {
                return null;
            }
        };
        void load().then((u) => {
            if (!cancelled) setUrl(u);
        });
        return () => {
            cancelled = true;
            helper.destroy();
        };
    }, [ev]);
    return url;
}

interface Props {
    /** The message replied to. */
    event: MatrixEvent;
    /** The title line; defaults to the sender's name (the composer shows "Reply to <name>"). */
    title?: ReactNode;
    /** "bubble" (tweb .reply in .bubble) or "composer" (.reply-wrapper .reply: larger radius, grey text). */
    variant: "bubble" | "composer";
    onClick?: () => void;
    className?: string;
}

export function senderName(ev: MatrixEvent): string {
    const sender = ev.getSender() ?? "";
    const room = MatrixClientPeg.get()?.getRoom(ev.getRoomId());
    return room?.getMember(sender)?.name ?? ev.sender?.name ?? sender;
}

export function TgReplyQuote({ event, title, variant, onClick, className }: Props): JSX.Element {
    const thumb = useReplyThumbnail(event);
    const sender = event.getSender() ?? "";
    const text = replyPreviewText(event);
    const inner = (
        <>
            {thumb && (
                <span className="mx_TgReplyQuote_media">
                    <img src={thumb} alt="" draggable={false} />
                </span>
            )}
            <span className="mx_TgReplyQuote_content">
                <span className="mx_TgReplyQuote_title">{title ?? senderName(event)}</span>
                <span className="mx_TgReplyQuote_subtitle">{text}</span>
            </span>
        </>
    );
    const classes = classNames(
        "mx_TgReplyQuote",
        `mx_TgReplyQuote_${variant}`,
        getUserNameColorClass(sender),
        { mx_TgReplyQuote_withMedia: !!thumb },
        className,
    );
    if (!onClick) {
        return <div className={classes}>{inner}</div>;
    }
    return (
        <button type="button" className={classes} onClick={onClick}>
            {inner}
        </button>
    );
}
