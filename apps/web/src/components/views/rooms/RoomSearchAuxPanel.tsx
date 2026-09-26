/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, useRef, useState } from "react";
import SearchIcon from "@vector-im/compound-design-tokens/assets/web/icons/search";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import CalendarIcon from "@vector-im/compound-design-tokens/assets/web/icons/calendar";
import { IconButton, Link } from "@vector-im/compound-web";
import { DateSeparatorContextMenuView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import { SDKContext } from "../../../contexts/SDKContext";
import { useSettingValue } from "../../../hooks/useSettings";
import { DateSeparatorViewModel } from "../../../viewmodels/room/timeline/DateSeparatorViewModel";
import { PosthogScreenTracker } from "../../../PosthogTrackers";
import SearchWarning, { WarningKind } from "../elements/SearchWarning";
import { type SearchInfo, SearchScope } from "../../../Searching";
import InlineSpinner from "../elements/InlineSpinner";

/**
 * Calendar button in the search bar, opening the timeline's own jump-to-date menu.
 *
 * Every messenger with search offers this: often the reader does not have a word to search
 * for, they know roughly when something was said. Jumping closes the results, because they
 * are covering the timeline the jump lands in.
 */
const SearchDateButton: React.FC<{ roomId: string; onJumped: () => void }> = ({ roomId, onJumped }) => {
    const sdkContext = useContext(SDKContext);
    const [open, setOpen] = useState(false);
    // The view model is built once, so it must not close over a callback that may be
    // replaced by a later render.
    const onJumpedRef = useRef(onJumped);
    onJumpedRef.current = onJumped;
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new DateSeparatorViewModel({
                roomId,
                // The picker opens on today, being the end of the history it searches back through.
                ts: Date.now(),
                onJumped: () => onJumpedRef.current(),
                roomViewStore: sdkContext.roomViewStore,
            }),
    );

    return (
        <DateSeparatorContextMenuView
            vm={vm}
            open={open}
            onOpenChange={setOpen}
            trigger={
                <IconButton tooltip={_t("room|jump_to_date")} aria-label={_t("room|jump_to_date")}>
                    <CalendarIcon width="20px" height="20px" />
                </IconButton>
            }
        />
    );
};

interface Props {
    searchInfo?: SearchInfo;
    isRoomEncrypted: boolean;
    onSearchScopeChange(this: void, scope: SearchScope): void;
    onCancelClick(this: void): void;
}

const RoomSearchAuxPanel: React.FC<Props> = ({ searchInfo, isRoomEncrypted, onSearchScopeChange, onCancelClick }) => {
    const scope = searchInfo?.scope ?? SearchScope.Room;
    // Off where the homeserver cannot look an event up by date (MSC3030); the setting's
    // controller keeps track of that for us.
    const jumpToDateEnabled = useSettingValue("feature_jump_to_date");

    return (
        <>
            <PosthogScreenTracker screenName="RoomSearch" />
            <div className="mx_RoomSearchAuxPanel">
                <div className="mx_RoomSearchAuxPanel_summary">
                    <SearchIcon width="24px" height="24px" />
                    <div className="mx_RoomSearchAuxPanel_summary_text">
                        {searchInfo?.count !== undefined ? (
                            _t(
                                "room|search|summary",
                                { count: searchInfo.count },
                                { query: () => <strong>{searchInfo.term}</strong> },
                            )
                        ) : searchInfo?.error !== undefined ? (
                            searchInfo?.error.message
                        ) : (
                            <InlineSpinner />
                        )}
                        <SearchWarning
                            kind={WarningKind.Search}
                            isRoomEncrypted={isRoomEncrypted}
                            showLogo={false}
                            scope={scope}
                            roomId={searchInfo?.roomId}
                        />
                    </div>
                </div>
                <div className="mx_RoomSearchAuxPanel_buttons">
                    {/* Only for a single room: a date can only be looked up in one room's
                        history, and jumping to it means going to that room's timeline. */}
                    {jumpToDateEnabled && scope === SearchScope.Room && searchInfo?.roomId && (
                        <SearchDateButton roomId={searchInfo.roomId} onJumped={onCancelClick} />
                    )}
                    <Link
                        onClick={() =>
                            onSearchScopeChange(scope === SearchScope.Room ? SearchScope.All : SearchScope.Room)
                        }
                        kind="primary"
                    >
                        {scope === SearchScope.All
                            ? _t("room|search|this_room_button")
                            : _t("room|search|all_rooms_button")}
                    </Link>
                    <IconButton
                        onClick={onCancelClick}
                        destructive
                        tooltip={_t("action|cancel")}
                        aria-label={_t("action|cancel")}
                    >
                        <CloseIcon width="20px" height="20px" />
                    </IconButton>
                </div>
            </div>
        </>
    );
};

export default RoomSearchAuxPanel;
