/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Drag to dismiss for the sheets that dialogs and menus become on handhelds (see _TgSheets.pcss): grab a
 * sheet by its top edge (a menu anywhere while it is scrolled to the top), pull it down and let go, and it
 * slides away when it was pulled far or fast enough, else springs back. Dismissal goes through the same
 * routes as a tap outside or Escape, so dialogs and menus clean up as they always do.
 */

/** How far down (px) or how fast (px/ms) a release closes the sheet. */
const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.6;
/** A dialog is grabbed by its top edge, where the grabber is. */
const GRAB_HEIGHT = 56;
/** Movement before a touch counts as a drag rather than a tap. */
const SLOP = 6;

function closeDialog(sheet: HTMLElement): void {
    const target = sheet.querySelector<HTMLElement>(".mx_Dialog, .mx_CompoundDialog") ?? sheet;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

function closeMenu(wrapper: HTMLElement): void {
    const background = wrapper.parentElement?.querySelector<HTMLElement>(".mx_ContextualMenu_background");
    background?.click();
}

function makeDraggable(sheet: HTMLElement, canGrab: (y: number, rect: DOMRect) => boolean, close: () => void): void {
    if (sheet.dataset.tgSheet) return;
    sheet.dataset.tgSheet = "true";

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let armed = false;
    let dragging = false;

    const reset = (animate: boolean): void => {
        sheet.style.transition = animate ? "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
        sheet.style.transform = "";
    };

    sheet.addEventListener(
        "pointerdown",
        (e) => {
            if (e.pointerType === "mouse") return;
            const rect = sheet.getBoundingClientRect();
            if (!canGrab(e.clientY, rect)) return;
            armed = true;
            dragging = false;
            startY = lastY = e.clientY;
            lastT = e.timeStamp;
            velocity = 0;
        },
        { passive: true },
    );

    sheet.addEventListener(
        "pointermove",
        (e) => {
            if (!armed) return;
            const dy = e.clientY - startY;
            if (!dragging) {
                if (dy < -SLOP) {
                    armed = false; // moving up is a scroll, not a dismiss
                    return;
                }
                if (dy < SLOP) return;
                dragging = true;
                sheet.setPointerCapture(e.pointerId);
            }
            const dt = Math.max(1, e.timeStamp - lastT);
            velocity = (e.clientY - lastY) / dt;
            lastY = e.clientY;
            lastT = e.timeStamp;
            sheet.style.transition = "none";
            sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
        },
        { passive: true },
    );

    const finish = (e: PointerEvent): void => {
        if (!armed) return;
        armed = false;
        if (!dragging) return;
        dragging = false;
        const dy = e.clientY - startY;
        if (dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
            sheet.style.transition = "transform 0.18s ease-in";
            sheet.style.transform = "translateY(100%)";
            window.setTimeout(close, 160);
        } else {
            reset(true);
        }
    };
    sheet.addEventListener("pointerup", finish);
    sheet.addEventListener("pointercancel", finish);
}

function scan(root: ParentNode): void {
    for (const sheet of root.querySelectorAll<HTMLElement>(
        ".mx_Dialog_wrapper:not(.mx_Dialog_lightbox) .mx_Dialog_border",
    )) {
        makeDraggable(
            sheet,
            (y, rect) => y - rect.top <= GRAB_HEIGHT,
            () => closeDialog(sheet),
        );
    }
    for (const menu of root.querySelectorAll<HTMLElement>(".mx_ContextualMenu_wrapper > .mx_ContextualMenu")) {
        const wrapper = menu.parentElement!;
        makeDraggable(
            menu,
            () => menu.scrollTop <= 0,
            () => closeMenu(wrapper),
        );
    }
}

/** Starts watching for sheets; returns a function that stops. */
export function installSheetGestures(): () => void {
    scan(document);
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLElement) scan(node.parentElement ?? document);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return (): void => observer.disconnect();
}
