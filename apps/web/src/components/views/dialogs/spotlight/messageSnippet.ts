/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The line a message hit is shown as: the words that matched, with enough of what surrounds them to tell
 * which message it is. A long message is cut to a window that starts a little before the first match, as
 * Telegram's results cut theirs, rather than showing its opening - which for a long message is usually
 * the part that did not match.
 */

export interface SnippetPart {
    /** Its place in the line: what tells two parts apart. */
    at: number;
    text: string;
    match: boolean;
}

/** How much text before the first match is kept when the message has to be cut. */
const LEAD = 24;
/** How long the line may be before it is cut. */
const MAX = 140;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function snippetParts(body: string, highlights: string[]): SnippetPart[] {
    // One line: a snippet is a preview, not the message.
    const text = body.replace(/\s+/g, " ").trim();
    const terms = highlights
        .map((term) => term.trim())
        .filter(Boolean)
        // The longer, more specific term first, so "abc" is not split by "a".
        .sort((a, b) => b.length - a.length);
    if (!terms.length) return text ? [{ at: 0, text: text.slice(0, MAX), match: false }] : [];

    const pattern = new RegExp(terms.map(escapeRegExp).join("|"), "gi");
    const first = text.search(pattern);
    let from = 0;
    let shown = text;
    if (text.length > MAX && first > LEAD) {
        from = first - LEAD;
        shown = text.slice(from);
    }
    const clipped = shown.length > MAX;
    if (clipped) shown = shown.slice(0, MAX);

    const parts: SnippetPart[] = [];
    if (from > 0) parts.push({ at: parts.length, text: "…", match: false });
    let last = 0;
    for (const found of shown.matchAll(pattern)) {
        if (!found[0]) continue;
        if (found.index > last) parts.push({ at: parts.length, text: shown.slice(last, found.index), match: false });
        parts.push({ at: parts.length, text: found[0], match: true });
        last = found.index + found[0].length;
    }
    if (last < shown.length) parts.push({ at: parts.length, text: shown.slice(last), match: false });
    if (clipped) parts.push({ at: parts.length, text: "…", match: false });
    return parts;
}
