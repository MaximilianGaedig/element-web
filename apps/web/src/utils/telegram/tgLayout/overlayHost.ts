/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where the layout's own full-window overlays (the media viewer, the emoji and sticker panel) are mounted.
 *
 * The children of <body> are each their own stacking context (#matrixchat by `contain`, the dialog and
 * menu containers by `isolation`, see _common.pcss), so a z-index inside one of them says nothing about
 * the others: between them, what comes later in the document is painted on top. An overlay appended to
 * the end of <body> with a z-index of its own therefore sat above every dialog and every menu, whatever
 * its number was - the viewer's Forward and Delete dialogs opened underneath the viewer.
 *
 * So the overlays get a container of their own, placed by document order where they belong: above the app
 * and the persisted widgets, below the dialogs and the menus. Inside it they are ordered by the
 * --mx-z-overlay-* scale (_TgBase.pcss).
 */

const HOST_ID = "mx_TgOverlay_Container";

/** The containers an overlay must stay under, in the order index.html declares them. */
const ABOVE_THE_OVERLAYS = ["mx_Dialog_StaticContainer", "mx_Dialog_Container", "mx_ContextualMenu_Container"];

export function getOverlayHost(): HTMLElement {
    const existing = document.getElementById(HOST_ID);
    if (existing) return existing;

    const host = document.createElement("div");
    host.id = HOST_ID;
    const firstAbove = ABOVE_THE_OVERLAYS.map((id) => document.getElementById(id)).find(
        (container) => container?.parentElement === document.body,
    );
    // Without any of them yet (they are also created on demand, at the end of <body>), the end is right.
    document.body.insertBefore(host, firstAbove ?? null);
    return host;
}
