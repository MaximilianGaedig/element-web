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

import React, { type JSX } from "react";
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import { type MediaPreviewGroupCollapse } from "@element-hq/web-shared-components";
import { type UrlPreview } from "shared-types";

import { _t } from "../../../languageHandler";
import { getUserNameColorClass } from "../../../utils/FormattingUtils";
import { isWebPageSquarePhoto, webPageDescription, webPageTitle } from "../../../utils/telegram/tgLayout/webPage";

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
    const square = isWebPageSquarePhoto(preview.image, !!(preview.siteName || title || description));

    const media = preview.image && (
        <span className="mx_TgWebPage_mediaResizer">
            <span className="mx_TgWebPage_media">
                <img src={preview.image.imageThumb} alt={preview.image.alt ?? ""} draggable={false} />
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
