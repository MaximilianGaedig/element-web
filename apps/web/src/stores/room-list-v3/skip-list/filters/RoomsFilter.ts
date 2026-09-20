/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Room } from "matrix-js-sdk/src/matrix";
import { type Filter, FilterEnum } from ".";
import { isDirectMessage } from "../../../../utils/dm/isDirectMessage";

export class RoomsFilter implements Filter {
    public matches(room: Room): boolean {
        // This should filter rooms that are not DMs, bridged DMs included
        return !isDirectMessage(room);
    }

    public get key(): FilterEnum.RoomsFilter {
        return FilterEnum.RoomsFilter;
    }
}
