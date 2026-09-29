/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useState, useCallback, useContext } from "react";
import { Flex, RoomListHeaderView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../../settings/UIFeature";
import { RoomListSearch } from "./RoomListSearch";
import { HistoryStatusMini } from "../../telegram/TgHistoryChip";
import { RoomListView } from "./RoomListView";
import { RoomListPill } from "./RoomListPill";
import { ContactsView } from "../../contacts/ContactsView";
import { contactsTab } from "../../../../utils/contacts/contactsTab";
import { setRoomListPanelView, useRoomListPanelView } from "../../../../utils/roomListPanelView";
import { _t } from "../../../../languageHandler";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import { Landmark, LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { type IState as IRovingTabIndexState } from "../../../../accessibility/RovingTabIndex";
import { RoomListHeaderViewModel } from "../../../../viewmodels/room-list/RoomListHeaderViewModel";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { SDKContext } from "../../../../contexts/SDKContext.ts";

type RoomListPanelProps = {
    /**
     * Current active space
     * See {@link RoomListSearch}
     */
    activeSpace: string;
};

/**
 * The panel of the room list
 */
export const RoomListPanel: React.FC<RoomListPanelProps> = ({ activeSpace }) => {
    const sdkContext = useContext(SDKContext);
    const displayRoomSearch = shouldShowComponent(UIComponent.FilterContainer);
    const [focusedElement, setFocusedElement] = useState<Element | null>(null);

    const onFocus = useCallback((ev: React.FocusEvent): void => {
        setFocusedElement(ev.target);
    }, []);

    const onBlur = useCallback((): void => {
        setFocusedElement(null);
    }, []);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent, state?: IRovingTabIndexState): void => {
            if (!focusedElement) return;
            const navAction = getKeyBindingsManager().getNavigationAction(ev);
            if (navAction === KeyBindingAction.PreviousLandmark || navAction === KeyBindingAction.NextLandmark) {
                ev.stopPropagation();
                ev.preventDefault();
                LandmarkNavigation.findAndFocusNextLandmark(
                    Landmark.ROOM_SEARCH,
                    navAction === KeyBindingAction.PreviousLandmark,
                );
            }
        },
        [focusedElement],
    );

    const panelView = useRoomListPanelView();
    const matrixClient = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () => new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore }),
    );

    return (
        <Flex
            as="nav"
            className="mx_RoomListPanel"
            direction="column"
            align="stretch"
            aria-label={_t("room_list|list_title")}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
        >
            {panelView === "contacts" ? (
                /*
                 * In place of the list, not over it: one column, one thing in it. Keyed on the tab so
                 * reopening on Calls from the pill remounts rather than leaving the last tab showing.
                 */
                <ContactsView
                    key={contactsTab()}
                    initialTab={contactsTab()}
                    onFinished={() => setRoomListPanelView("rooms")}
                />
            ) : (
                <>
                    {displayRoomSearch && (
                        /* Fork: the search row also carries what is left of the bridge status once the
                   imports are done - a tick, rather than the full chip taking a row of its own. */
                        <div className="mx_RoomListPanel_searchRow">
                            <RoomListSearch activeSpace={activeSpace} />
                            <HistoryStatusMini />
                        </div>
                    )}
                    <RoomListHeaderView vm={vm} />
                    <RoomListView />
                    {/* Fork: over the list rather than above it, so it costs the list no height. */}
                    <RoomListPill />
                </>
            )}
        </Flex>
    );
};
