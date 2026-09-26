/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

export { DateSeparatorView, type DateSeparatorViewModel, type DateSeparatorViewSnapshot } from "./DateSeparatorView";
// Exported on its own so the jump-to-date menu can also be opened from outside a
// separator — room search offers it from a calendar button.
export { DateSeparatorContextMenuView } from "./DateSeparatorContextMenuView";
