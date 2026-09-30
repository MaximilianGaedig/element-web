/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * tweb's link preview box (GPL-3.0, https://github.com/morethanwords/tweb):
 * src/components/wrappers/webPage.tsx builds `a.webpage.quote-like.quote-like-hoverable >
 * .webpage-quote.quote-like-border > .webpage-content`, holding the site name (.webpage-name), the
 * title (.webpage-title), the description (.webpage-text) and the photo (.webpage-preview-resizer >
 * .webpage-preview) - above the text when it is the small square thumbnail, below it otherwise. The
 * whole box is the link, which is why there is no separate "open link" button: src/components/chat/
 * bubbles.ts sets `box.href` and appends the box inside the bubble, before the time.
 *
 * tweb's instant-view / "OPEN CHANNEL" footer, its sponsored-message variant and its document,
 * sticker-set and story previews are Telegram features with no Matrix equivalent and are left out.
 */

import React, { type JSX, useState } from "react";
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import PlayIcon from "@vector-im/compound-design-tokens/assets/web/icons/play-solid";
import { type MediaPreviewGroupCollapse } from "@element-hq/web-shared-components";
import { type UrlPreview } from "shared-types";

import { _t } from "../../../languageHandler";
import { getUserNameColorClass } from "../../../utils/FormattingUtils";
import { isWebPageSquarePhoto, webPageDescription, webPageTitle } from "../../../utils/telegram/tgLayout/webPage";
import { videoEmbedUrl } from "../../../utils/telegram/tgLayout/webPageEmbed";

interface Props {
    /** The previews the URL preview group view model resolved for the event. */
    previews: UrlPreview[];
    /** The message's sender, whose accent colour the box is drawn in. */
    sender: string;
    /** The "show N more" toggle, when the event has more links than are previewed. */
    collapse?: MediaPreviewGroupCollapse;
}

function TgWebPageBox({ preview, sender }: { preview: UrlPreview; sender: string }): JSX.Element {
    const title = preview.title ? webPageTitle(preview.title) : "";
    const description = preview.description ? webPageDescription(preview.description) : "";
    // A video's preview is its frame with tweb's play button, and plays where it is (tweb: embed_url).
    const player = preview.image ? videoEmbedUrl(preview.link) : undefined;
    const square = !player && isWebPageSquarePhoto(preview.image, !!(preview.siteName || title || description));
    const [playing, setPlaying] = useState(false);

    const play = (e: React.MouseEvent | React.KeyboardEvent): void => {
        // The box is the link to the page; the button plays the video instead of opening it.
        e.preventDefault();
        e.stopPropagation();
        setPlaying(true);
    };

    const media = preview.image && (
        <span className="mx_TgWebPage_mediaResizer">
            <span className={classNames("mx_TgWebPage_media", { mx_TgWebPage_media_playing: playing })}>
                <img src={preview.image.imageThumb} alt={preview.image.alt ?? ""} draggable={false} />
                {player && !playing && (
                    <span
                        className="mx_TgWebPage_play"
                        role="button"
                        tabIndex={0}
                        aria-label={_t("timeline|url_preview|play_video")}
                        onClick={play}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && play(e)}
                    >
                        <PlayIcon aria-hidden={true} />
                    </span>
                )}
                {player && playing && (
                    <iframe
                        className="mx_TgWebPage_player"
                        src={player}
                        title={title || preview.link}
                        // The player is always another origin (videoEmbedUrl), so allow-same-origin gives it its
                        // own storage, which YouTube's player won't start without, and never ours.
                        // oxlint-disable-next-line react/iframe-missing-sandbox
                        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
                        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                    />
                )}
            </span>
        </span>
    );

    // tweb's box is itself the anchor; here the anchor is the .webpage-quote row inside it, because the
    // accent comes from the sender's mx_Username_colorN class and Element's global `a:link` colour rule
    // would outrank it on an anchor.
    return (
        <span
            className={classNames("mx_TgWebPage", getUserNameColorClass(sender), {
                mx_TgWebPage_squarePhoto: square,
            })}
        >
            {/* The box reads out as one link, so it is named after the page rather than by its whole
                content the way the site name, title and description would otherwise name it. */}
            <a
                className="mx_TgWebPage_quote"
                href={preview.link}
                target="_blank"
                rel="noreferrer"
                aria-label={title || preview.siteName || preview.link}
            >
                <span className="mx_TgWebPage_content">
                    {square && media}
                    {preview.siteName && <span className="mx_TgWebPage_name">{preview.siteName}</span>}
                    {title && <span className="mx_TgWebPage_title">{title}</span>}
                    {description && <span className="mx_TgWebPage_text">{description}</span>}
                    {!square && media}
                </span>
            </a>
        </span>
    );
}

/** The URL previews of one message, drawn as tweb draws them: inside the bubble, under the text. */
export function TgWebPage({ previews, sender, collapse }: Props): JSX.Element | null {
    if (previews.length === 0) return null;

    return (
        <>
            {previews.map((preview) => (
                <TgWebPageBox key={preview.link} preview={preview} sender={sender} />
            ))}
            {collapse && (
                <Button kind="tertiary" size="md" onClick={collapse.onToggle}>
                    {collapse.collapsed
                        ? _t("timeline|url_preview|show_n_more", { count: collapse.hiddenCount })
                        : _t("action|collapse")}
                </Button>
            )}
        </>
    );
}
