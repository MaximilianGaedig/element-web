/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type PresetThemeSettings } from "../config/themePresets";

/** What Element Web uses of tweb's colour helpers (src/helpers/color.ts). */

/** A wallpaper's gradient stops as `#rrggbb`, comma-separated, as the gradient renderer takes them. */
export function getColorsFromWallPaper(wallPaper: PresetThemeSettings["wallpaper"]): string;
