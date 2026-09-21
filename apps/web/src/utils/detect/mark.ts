/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Underlining, inside the message itself, the things that turned out to be worth acting on.
 *
 * A chip under a message says "there is a time in here somewhere". A mark on the words says which ones,
 * and lets them be pressed where they are - which is how iOS has done it for years and why nobody has to
 * be taught it. Links are left alone: the message already made those clickable, and marking them twice
 * would only make the message noisier.
 *
 * The marks are put on after the body is rendered, by finding each detected phrase in the text that is
 * actually on screen rather than by counting characters: the rendered message is not the message's
 * source (pills, formatting, emoji), so an offset into one is not an offset into the other.
 */

import { type Detected } from "./entities";

/** What a mark is: the words, what they turned out to be, and where pressing them goes. */
const CLASS = "mx_DetectedMark";

/** Elements whose text must not be touched: already clickable, or not prose at all. */
const LEAVE_ALONE = "a, code, pre, .mx_Pill, .mx_EventTile_pendingModeration, ." + CLASS;

/** A short word for what it is, which the mark carries for anything that wants to act on it. */
function kindOf(entity: Detected): string {
    return entity.kind;
}

/**
 * Marks each detected phrase in `element`, once.
 *
 * `onPress` is called for a mark that is not simply somewhere to go - a time, which becomes a calendar
 * entry, or a measurement, which is its own answer. Returns how many marks were made, which is what a
 * caller needs to know whether it is worth listening for presses at all.
 */
export function markEntities(
    element: HTMLElement,
    entities: Detected[],
    onPress?: (entity: Detected, at: HTMLElement) => void,
): number {
    let made = 0;
    for (const entity of entities) {
        // A link is already a link; a measurement has no span of its own worth marking in the text.
        if (entity.kind === "url") continue;
        const target = findText(element, entity.text);
        if (!target) continue;
        mark(target.node, target.at, entity, onPress);
        made++;
    }
    return made;
}

/** The first text node holding `text`, and where in it, skipping anything already spoken for. */
function findText(element: HTMLElement, text: string): { node: Text; at: number } | undefined {
    if (!text.trim()) return undefined;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
            (node.parentElement?.closest(LEAVE_ALONE) ?? null) === null
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT,
    });
    let node = walker.nextNode() as Text | null;
    while (node) {
        const at = node.data.indexOf(text);
        if (at >= 0) return { node, at };
        node = walker.nextNode() as Text | null;
    }
    return undefined;
}

/**
 * Wraps the phrase where it sits.
 *
 * Always a button, never an anchor, even for the ones that are somewhere to go: an anchor in a message
 * body is a link as far as the rest of the app is concerned, and the message would sprout a preview
 * card for a map or an airline the moment it was marked.
 */
function mark(node: Text, at: number, entity: Detected, onPress?: (entity: Detected, at: HTMLElement) => void): void {
    const middle = node.splitText(at);
    middle.splitText(entity.text.length);

    const element = document.createElement("button");
    element.type = "button";
    element.className = CLASS;
    element.dataset.kind = kindOf(entity);
    element.textContent = middle.data;
    element.addEventListener("click", (event) => {
        // The message's own click does its own thing; this one is about the words that were pressed.
        event.preventDefault();
        event.stopPropagation();
        onPress?.(entity, element);
    });

    middle.replaceWith(element);
}
