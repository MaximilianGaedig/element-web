/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { Room } from "matrix-js-sdk/src/matrix";
import { type Filter, FilterEnum } from ".";
import { isDirectMessage } from "../../../../utils/dm/isDirectMessage";

export class PeopleFilter implements Filter {
    public matches(room: Room): boolean {
        // Match rooms that are DMs, including the bridged ones Element has no m.direct entry for
        return isDirectMessage(room);
    }

    public get key(): FilterEnum.PeopleFilter {
        return FilterEnum.PeopleFilter;
    }
}
