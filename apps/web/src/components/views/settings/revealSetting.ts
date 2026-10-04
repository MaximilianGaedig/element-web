/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Showing where a setting is, once a search has opened its section.
 *
 * The sections are Element's and mark nothing to look a setting up by, so it is found by what it says: the
 * element whose own text is the label the search showed. A section may still be drawing (some load their
 * state first), so it is looked for again as the section changes, until it is found or has had its time.
 */

const FLASH_CLASS = "mx_UserSettingsPage_found";
/** Long enough for a section that loads before it draws, short enough not to act on a page moved on from. */
const GIVE_UP_MS = 4000;

const fold = (text: string): string => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();

function find(root: HTMLElement, label: string): HTMLElement | undefined {
    const wanted = fold(label);
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
        // The element that holds the words and nothing else: a heading, a label, not everything around it.
        if (element.childElementCount === 0 && fold(element.textContent ?? "") === wanted) return element;
    }
    return undefined;
}

/** Scrolls to the labelled setting under `root` and flashes it; returns the undo. */
export function revealSetting(root: HTMLElement, label: string): () => void {
    let done = false;
    let flashed: HTMLElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (): void => {
        if (done) return;
        const target = find(root, label);
        if (!target) return;
        done = true;
        observer.disconnect();
        /*
         * The row the label is in, not the label: the highlight should cover the control that goes with it.
         * Its own parent is the nearest thing that holds both, and the section's body is never that.
         */
        const row = target.parentElement && target.parentElement !== root ? target.parentElement : target;
        row.scrollIntoView({ block: "center" });
        row.classList.add(FLASH_CLASS);
        flashed = row;
        timer = setTimeout(() => row.classList.remove(FLASH_CLASS), 2000);
    };

    const observer = new MutationObserver(attempt);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const giveUp = setTimeout(() => observer.disconnect(), GIVE_UP_MS);
    attempt();

    return () => {
        done = true;
        observer.disconnect();
        clearTimeout(giveUp);
        clearTimeout(timer);
        flashed?.classList.remove(FLASH_CLASS);
    };
}
