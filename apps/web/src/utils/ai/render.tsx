/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The model's words, rendered the way a message is rendered.
 *
 * It writes markdown - lists, emphasis, links - and there is already exactly one right way to turn that
 * into something to look at in this app: the markdown parser a composer uses and the sanitiser every
 * message body goes through. Anything else means asterisks on the screen, or a second sanitiser to keep
 * correct. Plain text stays plain, so a one-line answer does not go through a formatter to come out the
 * same.
 */

import React, { type JSX, useMemo } from "react";

import Markdown from "../../Markdown";
import { bodyToHtml } from "../../HtmlUtils";

interface Props {
    text: string;
    className?: string;
}

export function AiText({ text, className }: Props): JSX.Element {
    const html = useMemo(() => {
        if (!text.trim()) return undefined;
        const markdown = new Markdown(text);
        if (markdown.isPlainText()) return undefined;
        return bodyToHtml(
            {
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: markdown.toHTML({ externalLinks: true }),
            },
            undefined,
            { disableBigEmoji: true },
        );
    }, [text]);

    // Sanitised by the same rules a message body is: see HtmlUtils.
    if (html !== undefined) return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
    return <p className={className}>{text}</p>;
}
