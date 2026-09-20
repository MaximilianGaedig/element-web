/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Layout constants ported from Telegram Web K (https://github.com/morethanwords/tweb, GPL-3.0).
 * Each value names the tweb file it comes from; keep them in sync with tweb rather than tuning them.
 */

/** tweb src/helpers/mediaSizes.ts MOBILE_SIZE: at or below this width the layout is single-pane. */
export const MOBILE_SIZE = 600;
/** tweb src/helpers/mediaSizes.ts FLOATING_LEFT_SIDEBAR_SIZE: at or below, the chat list stops docking. */
export const FLOATING_LEFT_SIDEBAR_SIZE = 925;
/** tweb src/helpers/mediaSizes.ts LARGE_SIZE. */
export const LARGE_SIZE = 1680;

/** tweb src/helpers/updateColumnWidths.ts DEFAULT_COLUMN_WIDTH. */
export const DEFAULT_COLUMN_WIDTH = 360;
/** tweb src/helpers/updateColumnWidths.ts MIN_SIDEBAR_WIDTH. */
export const MIN_SIDEBAR_WIDTH = 320;
/** tweb src/helpers/updateColumnWidths.ts MAX_SIDEBAR_WIDTH. */
export const MAX_SIDEBAR_WIDTH = 480;
/** tweb src/helpers/updateColumnWidths.ts SIDEBAR_COLLAPSE_FACTOR: a drag narrower than MIN × this collapses. */
export const SIDEBAR_COLLAPSE_FACTOR = 0.65;
/** tweb src/helpers/updateColumnWidths.ts SIDEBAR_COLLAPSED_WIDTH (--sidebar-collapsed-width). */
export const SIDEBAR_COLLAPSED_WIDTH = 80;
/** tweb src/helpers/updateColumnWidths.ts STORAGE_KEY_LEFT; "0" records the collapsed state. */
export const STORAGE_KEY_LEFT = "sidebar-left-width";
/** tweb src/helpers/updateColumnWidths.ts persistLeftPreference throttle (ms). */
export const PERSIST_THROTTLE_MS = 200;

/** tweb src/helpers/dom/handleHorizontalSwipe.ts: vertical travel that cancels a not-yet-horizontal swipe. */
export const SWIPE_VERTICAL_CANCEL = 20;
/** tweb src/helpers/dom/handleTabSwipe.ts: horizontal travel past which the swipe navigates. */
export const SWIPE_COMMIT_THRESHOLD = 50;

/** tweb src/helpers/dom/attachContextMenuListener.ts: touch hold that opens the context menu (ms). */
export const LONG_PRESS_MS = 400;

/** tweb src/scss/base.scss --tabs-transition (.2s ease-in-out): handheld column slide. */
export const TABS_TRANSITION_MS = 200;
/** tweb src/scss/base.scss --transition-standard-in-time. */
export const TRANSITION_STANDARD_IN_MS = 300;
/** tweb src/scss/base.scss --transition-standard-out-time. */
export const TRANSITION_STANDARD_OUT_MS = 250;
/** tweb src/components/animatedSuper.ts AnimatedSuper.DEFAULT_DURATION (matches --pm-transition). */
export const ANIMATED_SUPER_DURATION_MS = 200;
