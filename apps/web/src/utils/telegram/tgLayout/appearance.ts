/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The messenger-style refinements to the app's own layout, written onto <html> so that CSS
 * anywhere — including overlays rendered outside the app tree, like dialogs and menus — can
 * see which of them are on.
 *
 * They live here, on a hook the logged-in view always mounts, rather than inside any one layout
 * component: each is a change to the standard view and has to apply whether or not the others
 * do. Putting them in the component that draws the columns is what made them one mode.
 */

import { useDocumentAttribute } from "./documentAttribute";
import { useSettingValue } from "../../../hooks/useSettings";

/** Set while the header, composer and scroll-down button float over the timeline. */
export const FLOATING_BARS_ATTRIBUTE = "data-floating-bars";
/** Set while the timeline is held to a readable width with the chat list beside it. */
export const CHAT_COLUMNS_ATTRIBUTE = "data-chat-columns";
/** Set while dialogs and menus are sheets on a handheld. */
export const HANDHELD_SHEETS_ATTRIBUTE = "data-handheld-sheets";
/** The frosted panels are plain while this is set. */
export const NO_GLASS_ATTRIBUTE = "data-no-glass";
/** Which app's bubble tail the timeline draws (see _TgBubbleTail.pcss). */
export const TAIL_ATTRIBUTE = "data-tg-tail";
/** How much room a message is given on a handheld. */
export const MESSAGE_PADDING_ATTRIBUTE = "data-tg-message-padding";

/** Writes every appearance setting onto <html> for as long as the app is mounted. */
export function useAppearanceAttributes(): void {
    useDocumentAttribute(FLOATING_BARS_ATTRIBUTE, useSettingValue("floatingBars") ? "true" : undefined);
    useDocumentAttribute(CHAT_COLUMNS_ATTRIBUTE, useSettingValue("chatColumns") ? "true" : undefined);
    useDocumentAttribute(HANDHELD_SHEETS_ATTRIBUTE, useSettingValue("handheldSheets") ? "true" : undefined);
    useDocumentAttribute(TAIL_ATTRIBUTE, useSettingValue("bubbleTail"));
    useDocumentAttribute(MESSAGE_PADDING_ATTRIBUTE, useSettingValue("mobileMessagePadding"));
    // The frosted panels are drawn by the GPU on every frame behind them, which is most of the
    // graphics work while scrolling; turning them off leaves plain panels (see _TgBase.pcss).
    useDocumentAttribute(NO_GLASS_ATTRIBUTE, useSettingValue("glassEffects") ? undefined : "true");
}

/**
 * Mounts {@link useAppearanceAttributes}. The logged-in view is a class, and this has to be in the
 * tree whatever it draws, so it rides along as a component that renders nothing.
 */
export function AppearanceAttributes(): null {
    useAppearanceAttributes();
    return null;
}
