/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What an answer rests on: the messages it read and the pages it fetched.
 *
 * Both of the places an answer appears show these, so they are drawn once here rather than twice - and
 * they are drawn as chips rather than as links. A row of blue underlined words under a paragraph reads as
 * a footnote nobody presses; a chip reads as somewhere to go, which is what these are: a message opens the
 * chat at that message, a page opens the page.
 */

import React, { type JSX } from "react";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";

import { _t } from "../../../languageHandler";

interface Props {
    cites: string[];
    /** Where a cited message is: not every surface can go to one, so this decides whether any are shown. */
    onJump?: (eventId: string) => void;
    /** Past this many, the rest are summed up: a digest of eight chats can cite thirty messages. */
    most?: number;
}

const MOST = 8;

/** A page's host, which is what anybody recognises a source by. Anything unparseable is shown whole. */
function hostOf(href: string): string {
    try {
        return new URL(href).host.replace(/^www\./, "");
    } catch {
        return href;
    }
}

export function AiSources({ cites, onJump, most = MOST }: Props): JSX.Element | null {
    const links = cites.filter((cite) => /^https?:\/\//.test(cite));
    const events = onJump ? cites.filter((cite) => cite.startsWith("$")) : [];
    if (!links.length && !events.length) return null;

    const shown = [...events, ...links].slice(0, most);
    const rest = events.length + links.length - shown.length;

    return (
        <ul className="mx_AiSources" aria-label={_t("ai|sources")}>
            {shown.map((cite, index) =>
                cite.startsWith("$") ? (
                    <li key={cite}>
                        <button type="button" className="mx_AiSources_one" onClick={() => onJump?.(cite)}>
                            {_t("ai|cite", { number: index + 1 })}
                        </button>
                    </li>
                ) : (
                    <li key={cite}>
                        <a className="mx_AiSources_one" href={cite} target="_blank" rel="noreferrer noopener">
                            <LinkIcon />
                            {hostOf(cite)}
                        </a>
                    </li>
                ),
            )}
            {rest > 0 && (
                <li className="mx_AiSources_rest">{_t("ai|sources_more", { count: rest })}</li>
            )}
        </ul>
    );
}
