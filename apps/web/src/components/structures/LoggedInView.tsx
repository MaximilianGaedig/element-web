/*
Copyright 2024 New Vector Ltd.
Copyright 2015-2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ClipboardEvent, startTransition } from "react";
import {
    ClientEvent,
    type MatrixClient,
    type MatrixEvent,
    RoomStateEvent,
    type MatrixError,
    type IUsageLimit,
    type SyncStateData,
    SyncState,
    EventType,
    ProfileKeyTimezone,
    ProfileKeyMSC4175Timezone,
} from "matrix-js-sdk/src/matrix";
import { type MatrixCall } from "matrix-js-sdk/src/webrtc/call";
import classNames from "classnames";
import { GroupView, SeparatorView, Panel, LeftResizablePanelView } from "@element-hq/web-shared-components";

import { isOnlyCtrlOrCmdKeyEvent, Key } from "../../Keyboard";
import PageTypes from "../../PageTypes";
import MediaDeviceHandler from "../../MediaDeviceHandler";
import dis from "../../dispatcher/dispatcher";
import { type IMatrixClientCreds } from "../../utils/createMatrixClient";
import SettingsStore from "../../settings/SettingsStore";
import { ROOMS_AHEAD, mayPrepareRooms, roomsAhead } from "../../utils/room/roomsAhead";
import { type SwitchKind, switchAsked, switchShown, switchTimings } from "../../utils/room/switchTimings";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { SettingLevel } from "../../settings/SettingLevel";
import PlatformPeg from "../../PlatformPeg";
import { hideToast as hideServerLimitToast, showToast as showServerLimitToast } from "../../toasts/ServerLimitToast";
import { Action } from "../../dispatcher/actions";
import LeftPanel from "./LeftPanel";
import { type ViewRoomDeltaPayload } from "../../dispatcher/payloads/ViewRoomDeltaPayload";
import RoomListStoreV3 from "../../stores/room-list-v3/RoomListStoreV3";
import NonUrgentToastContainer from "./NonUrgentToastContainer";
import { type IOOBData, type IThreepidInvite } from "../../stores/ThreepidInviteStore";
import Modal from "../../Modal";
import { getKeyBindingsManager } from "../../KeyBindingsManager";
import { type IOpts } from "../../createRoom";
import SpacePanel from "../views/spaces/SpacePanel";
import { LegacyCallHandlerEvent } from "../../LegacyCallHandler";
import AudioFeedArrayForLegacyCall from "../views/voip/AudioFeedArrayForLegacyCall";
import { OwnProfileStore } from "../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import { RoomView } from "./RoomView";
import ToastContainer from "./ToastContainer";
import UserView from "./UserView";
import { mediaFromMxc } from "../../customisations/Media";
import { UserTab } from "../views/dialogs/UserTab";
import { type OpenToTabPayload } from "../../dispatcher/payloads/OpenToTabPayload";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import { KeyBindingAction } from "../../accessibility/KeyboardShortcuts";
import { type SwitchSpacePayload } from "../../dispatcher/payloads/SwitchSpacePayload";
import LeftPanelLiveShareWarning from "../views/beacon/LeftPanelLiveShareWarning";
import HomePage from "./HomePage";
import { PipContainer } from "./PipContainer";
import { monitorSyncedPushRules } from "../../utils/pushRules/monitorSyncedPushRules";
import { MatrixClientContextProvider } from "./MatrixClientContextProvider";
import { Landmark, LandmarkNavigation } from "../../accessibility/LandmarkNavigation";
import { ModuleApi } from "../../modules/Api.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import { ResizerViewModel } from "../../viewmodels/structures/ResizerViewModel.ts";
import { TgColumns } from "../views/telegram/TgColumns";
import { AppearanceAttributes } from "../../utils/telegram/tgLayout/appearance";
import { TgTweaksPanel } from "../views/telegram/TgTweaksPanel";
import { TgMetricsPanel } from "../views/telegram/TgMetricsPanel";

// We need to fetch each pinned message individually (if we don't already have it)
// so each pinned message may trigger a request. Limit the number per room for sanity.
// NB. this is just for server notices rather than pinned messages in general.
const MAX_PINNED_NOTICES_PER_ROOM = 2;
/** How many rooms stay mounted for instant switching back, the one on screen included. */
const KEPT_ROOMS = 5;
/** How long the app has been up before the rooms at the top of the list are got ready: startup comes first. */
const IDLE_AHEAD_MS = 8000;

// Used to find the closest inputable thing. Because of how our composer works,
// your caret might be within a paragraph/font/div/whatever within the
// contenteditable rather than directly in something inputable.
function getInputableElement(el: HTMLElement): HTMLElement | null {
    return el.closest("input, textarea, select, [contenteditable=true]");
}

interface IProps {
    matrixClient: MatrixClient;
    // Called with the credentials of a registered user (if they were a ROU that
    // transitioned to PWLU)
    onRegistered: (this: void, credentials: IMatrixClientCreds) => Promise<MatrixClient>;
    hideToSRUsers: boolean;

    page_type?: string;
    threepidInvite?: IThreepidInvite;
    roomOobData?: IOOBData;
    currentRoomId: string | null;
    currentUserId: string | null;
    justRegistered?: boolean;
    roomJustCreatedOpts?: IOpts;
    forceTimeline?: boolean; // see props on MatrixChat
}

interface IState {
    syncErrorData?: SyncStateData;
    usageLimitDismissed: boolean;
    usageLimitEventContent?: IUsageLimit;
    usageLimitEventTs?: number;
    useCompactLayout: boolean;
    /** Fork: the timeline is held to a readable width, with the chat list beside it ("chatColumns"). */
    chatColumns: boolean;
    activeCalls: Array<MatrixCall>;
    backgroundImage?: string;
    /** Rooms mounted ahead of being opened, newest first (utils/room/roomsAhead). */
    ahead: readonly string[];
}

/**
 * This is what our MatrixChat shows when we are logged in. The precise view is
 * determined by the page_type property.
 *
 * Currently, it's very tightly coupled with MatrixChat. We should try to do
 * something about that.
 *
 * Components mounted below us can access the matrix client via the react context.
 */
class LoggedInView extends React.Component<IProps, IState> {
    public static displayName = "LoggedInView";

    protected readonly _matrixClient: MatrixClient;
    protected readonly _roomView: React.RefObject<RoomView | null>;
    /** The rooms kept mounted, most recently shown first (see keptRooms). */
    private kept: string[] = [];
    /** Every room that was mounted by the last render, to tell how the next one switched to was found. */
    private mounted: readonly string[] = [];
    /** Which of those were only mounted ahead of being opened. */
    private mountedAhead: ReadonlySet<string> = new Set();
    private switchDispatcherRef?: string;
    private stopWatchingAhead?: () => void;
    private idleAhead?: ReturnType<typeof setTimeout>;
    protected layoutWatcherRef?: string;
    protected compactLayoutWatcherRef?: string;
    protected backgroundImageWatcherRef?: string;
    protected chatColumnsWatcherRef?: string;
    protected timezoneProfileUpdateRef?: string[];

    private resizerViewModel?: ResizerViewModel;

    public static contextType = SDKContext;
    declare public context: React.ContextType<typeof SDKContext>;

    public constructor(props: IProps, context: React.ContextType<typeof SDKContext>) {
        super(props, context);

        this.state = {
            syncErrorData: undefined,
            // use compact timeline view
            useCompactLayout: SettingsStore.getValue("useCompactLayout"),
            chatColumns: !!SettingsStore.getValue("chatColumns"),
            usageLimitDismissed: false,
            activeCalls: context.legacyCallHandler.getAllActiveCalls(),
            ahead: roomsAhead.list(),
        };

        // stash the MatrixClient in case we log out before we are unmounted
        this._matrixClient = this.props.matrixClient;

        void MediaDeviceHandler.loadDevices();

        this._roomView = React.createRef();
    }

    public componentDidMount(): void {
        /*
         * A room got ready ahead of the click is mounted as a transition: building its view is real
         * work, and done at the ordinary priority it would hold up the pointer that is still moving
         * over the room list. As a transition it gives way to anything the reader does - including the
         * click it was started for, which then finds the work part done rather than not begun.
         */
        this.stopWatchingAhead = roomsAhead.subscribe(() =>
            startTransition(() => this.setState({ ahead: roomsAhead.list() })),
        );
        this.idleAhead = setTimeout(() => void this.prepareTopRooms(), IDLE_AHEAD_MS);
        // The clock on a switch starts when the room is asked for, wherever that is asked from.
        this.switchDispatcherRef = dis.register((payload) => {
            if (payload.action === Action.ViewRoom && typeof payload.room_id === "string") {
                switchAsked(payload.room_id);
            }
        });
        window.mxSwitchTimings = switchTimings;
        this.noteMounted();
        document.addEventListener("keydown", this.onNativeKeyDown, false);
        this.context.legacyCallHandler.addListener(LegacyCallHandlerEvent.CallState, this.onCallState);

        void this.updateServerNoticeEvents();

        this._matrixClient.on(ClientEvent.AccountData, this.onAccountData);
        // check push rules on start up as well
        void monitorSyncedPushRules(this._matrixClient.getAccountData(EventType.PushRules), this._matrixClient);
        this._matrixClient.on(ClientEvent.Sync, this.onSync);
        // Call `onSync` with the current state as well
        this.onSync(this._matrixClient.getSyncState(), null, this._matrixClient.getSyncStateData() ?? undefined);
        this._matrixClient.on(RoomStateEvent.Events, this.onRoomStateEvents);

        this.layoutWatcherRef = SettingsStore.watchSetting("layout", null, this.onCompactLayoutChanged);
        this.compactLayoutWatcherRef = SettingsStore.watchSetting(
            "useCompactLayout",
            null,
            this.onCompactLayoutChanged,
        );
        this.chatColumnsWatcherRef = SettingsStore.watchSetting("chatColumns", null, () =>
            this.setState({ chatColumns: !!SettingsStore.getValue("chatColumns") }),
        );
        this.backgroundImageWatcherRef = SettingsStore.watchSetting(
            "RoomList.backgroundImage",
            null,
            this.refreshBackgroundImage,
        );

        this.timezoneProfileUpdateRef = [
            SettingsStore.watchSetting("userTimezonePublish", null, this.onTimezoneUpdate),
            SettingsStore.watchSetting("userTimezone", null, this.onTimezoneUpdate),
        ];
        // Call this initially to ensure that we set the correct timezone, if the
        // system time has changed between sessions.
        void this.onTimezoneUpdate();

        OwnProfileStore.instance.on(UPDATE_EVENT, this.refreshBackgroundImage);
        void this.refreshBackgroundImage();
    }

    private getResizerViewModel(): ResizerViewModel {
        if (!this.resizerViewModel) {
            this.resizerViewModel = new ResizerViewModel(this.context.callStore);
        }
        return this.resizerViewModel;
    }

    private disposeResizerViewModel(): void {
        this.resizerViewModel?.dispose();
        this.resizerViewModel = undefined;
    }

    private onTimezoneUpdate = async (): Promise<void> => {
        // TODO: In a future app release, remove support for legacy key.
        if (!SettingsStore.getValue("userTimezonePublish")) {
            // Ensure it's deleted
            try {
                await this._matrixClient.deleteExtendedProfileProperty(ProfileKeyMSC4175Timezone);
                await this._matrixClient.deleteExtendedProfileProperty(ProfileKeyTimezone);
            } catch (ex) {
                console.warn("Failed to delete timezone from user profile", ex);
            }
            return;
        }
        const currentTimezone =
            SettingsStore.getValue("userTimezone") ||
            // If the timezone is empty, then use the browser timezone.
            // eslint-disable-next-line new-cap
            Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!currentTimezone || typeof currentTimezone !== "string") {
            return;
        }
        try {
            await this._matrixClient.setExtendedProfileProperty(ProfileKeyTimezone, currentTimezone);
            await this._matrixClient.setExtendedProfileProperty(ProfileKeyMSC4175Timezone, currentTimezone);
        } catch (ex) {
            console.warn("Failed to update user profile with current timezone", ex);
        }
    };

    public componentWillUnmount(): void {
        this.stopWatchingAhead?.();
        clearTimeout(this.idleAhead);
        if (this.switchDispatcherRef) dis.unregister(this.switchDispatcherRef);
        roomsAhead.clear();
        document.removeEventListener("keydown", this.onNativeKeyDown, false);
        this.context.legacyCallHandler.removeListener(LegacyCallHandlerEvent.CallState, this.onCallState);
        this._matrixClient.removeListener(ClientEvent.AccountData, this.onAccountData);
        this._matrixClient.removeListener(ClientEvent.Sync, this.onSync);
        this._matrixClient.removeListener(RoomStateEvent.Events, this.onRoomStateEvents);
        OwnProfileStore.instance.off(UPDATE_EVENT, this.refreshBackgroundImage);
        SettingsStore.unwatchSetting(this.layoutWatcherRef);
        SettingsStore.unwatchSetting(this.compactLayoutWatcherRef);
        SettingsStore.unwatchSetting(this.backgroundImageWatcherRef);
        SettingsStore.unwatchSetting(this.chatColumnsWatcherRef);
        this.timezoneProfileUpdateRef?.forEach((s) => SettingsStore.unwatchSetting(s));
        this.disposeResizerViewModel();
    }

    private onCallState = (): void => {
        const activeCalls = this.context.legacyCallHandler.getAllActiveCalls();
        if (activeCalls === this.state.activeCalls) return;
        this.setState({ activeCalls });
    };

    private refreshBackgroundImage = async (): Promise<void> => {
        let backgroundImage = SettingsStore.getValue("RoomList.backgroundImage");
        if (backgroundImage) {
            // convert to http before going much further
            backgroundImage = mediaFromMxc(backgroundImage).srcHttp;
        } else {
            backgroundImage = OwnProfileStore.instance.getHttpAvatarUrl();
        }
        this.setState({ backgroundImage: backgroundImage ?? undefined });
    };

    public canResetTimelineInRoom = (roomId: string): boolean => {
        if (!this._roomView.current) {
            return true;
        }
        return this._roomView.current.canResetTimeline();
    };

    private onAccountData = (event: MatrixEvent): void => {
        if (event.getType() === "m.ignored_user_list") {
            dis.dispatch({ action: "ignore_state_changed" });
        }
        void monitorSyncedPushRules(event, this._matrixClient);
    };

    /** Fork: the handheld Telegram-style layout's back navigation, from a chat to the chat list. */
    private onTgBack = (): void => {
        dis.dispatch({ action: Action.ViewHomePage });
    };

    private onCompactLayoutChanged = (): void => {
        this.setState({
            useCompactLayout: SettingsStore.getValue("useCompactLayout"),
        });
    };

    private onSync = (syncState: SyncState | null, oldSyncState: SyncState | null, data?: SyncStateData): void => {
        const oldErrCode = (this.state.syncErrorData?.error as MatrixError)?.errcode;
        const newErrCode = (data?.error as MatrixError)?.errcode;
        if (syncState === oldSyncState && oldErrCode === newErrCode) return;

        const syncErrorData = syncState === SyncState.Error ? data : undefined;
        this.setState({
            syncErrorData,
        });

        if (oldSyncState === SyncState.Prepared && syncState === SyncState.Syncing) {
            void this.updateServerNoticeEvents();
        } else {
            this.calculateServerLimitToast(syncErrorData, this.state.usageLimitEventContent);
        }
    };

    private onRoomStateEvents = (ev: MatrixEvent): void => {
        const serverNoticeList = RoomListStoreV3.instance.getServerNoticeRooms();
        if (serverNoticeList.some((r) => r.roomId === ev.getRoomId())) {
            void this.updateServerNoticeEvents();
        }
    };

    private onUsageLimitDismissed = (): void => {
        this.setState({
            usageLimitDismissed: true,
        });
    };

    private calculateServerLimitToast(syncError: IState["syncErrorData"], usageLimitEventContent?: IUsageLimit): void {
        const error = (syncError?.error as MatrixError)?.errcode === "M_RESOURCE_LIMIT_EXCEEDED";
        if (error) {
            usageLimitEventContent = (syncError?.error as MatrixError)?.data as IUsageLimit;
        }

        // usageLimitDismissed is true when the user has explicitly hidden the toast
        // and it will be reset to false if a *new* usage alert comes in.
        if (usageLimitEventContent && !this.state.usageLimitDismissed) {
            showServerLimitToast(
                usageLimitEventContent.limit_type,
                this.onUsageLimitDismissed,
                usageLimitEventContent.admin_contact,
                error,
            );
        } else {
            hideServerLimitToast();
        }
    }

    private updateServerNoticeEvents = async (): Promise<void> => {
        const serverNoticeList = RoomListStoreV3.instance.getServerNoticeRooms();
        if (!serverNoticeList.length) return;

        const events: MatrixEvent[] = [];
        let pinnedEventTs = 0;
        for (const room of serverNoticeList) {
            const pinStateEvent = room.currentState.getStateEvents("m.room.pinned_events", "");

            if (!pinStateEvent || !pinStateEvent.getContent().pinned) continue;
            pinnedEventTs = pinStateEvent.getTs();

            const pinnedEventIds = pinStateEvent.getContent().pinned.slice(0, MAX_PINNED_NOTICES_PER_ROOM);
            for (const eventId of pinnedEventIds) {
                const timeline = await this._matrixClient.getEventTimeline(room.getUnfilteredTimelineSet(), eventId);
                const event = timeline?.getEvents().find((ev) => ev.getId() === eventId);
                if (event) events.push(event);
            }
        }

        if (pinnedEventTs && this.state.usageLimitEventTs && this.state.usageLimitEventTs > pinnedEventTs) {
            // We've processed a newer event than this one, so ignore it.
            return;
        }

        const usageLimitEvent = events.find((e) => {
            return (
                e &&
                e.getType() === "m.room.message" &&
                e.getContent()["server_notice_type"] === "m.server_notice.usage_limit_reached"
            );
        });
        const usageLimitEventContent = usageLimitEvent?.getContent<IUsageLimit>();
        this.calculateServerLimitToast(this.state.syncErrorData, usageLimitEventContent);
        this.setState({
            usageLimitEventContent,
            usageLimitEventTs: pinnedEventTs,
            // This is a fresh toast, we can show toasts again
            usageLimitDismissed: false,
        });
    };

    private onPaste = (ev: ClipboardEvent): void => {
        const element = ev.target as HTMLElement;
        const inputableElement = getInputableElement(element);
        if (inputableElement === document.activeElement) return; // nothing to do

        if (inputableElement?.focus) {
            inputableElement.focus();
        } else {
            const inThread = !!document.activeElement?.closest(".mx_ThreadView");
            // refocusing during a paste event will make the paste end up in the newly focused element,
            // so dispatch synchronously before paste happens
            dis.dispatch(
                {
                    action: Action.FocusSendMessageComposer,
                    context: inThread ? TimelineRenderingType.Thread : TimelineRenderingType.Room,
                },
                true,
            );
        }
    };

    /*
    SOME HACKERY BELOW:
    React optimizes event handlers, by always attaching only 1 handler to the document for a given type.
    It then internally determines the order in which React event handlers should be called,
    emulating the capture and bubbling phases the DOM also has.

    But, as the native handler for React is always attached on the document,
    it will always run last for bubbling (first for capturing) handlers,
    and thus React basically has its own event phases, and will always run
    after (before for capturing) any native other event handlers (as they tend to be attached last).

    So ideally one wouldn't mix React and native event handlers to have bubbling working as expected,
    but we do need a native event handler here on the document,
    to get keydown events when there is no focused element (target=body).

    We also do need bubbling here to give child components a chance to call `stopPropagation()`,
    for keydown events it can handle itself, and shouldn't be redirected to the composer.

    So we listen with React on this component to get any events on focused elements, and get bubbling working as expected.
    We also listen with a native listener on the document to get keydown events when no element is focused.
    Bubbling is irrelevant here as the target is the body element.
    */
    private onReactKeyDown = (ev: React.KeyboardEvent): void => {
        // events caught while bubbling up on the root element
        // of this component, so something must be focused.
        this.onKeyDown(ev);
    };

    private onNativeKeyDown = (ev: KeyboardEvent): void => {
        // only pass this if there is no focused element.
        // if there is, onKeyDown will be called by the
        // react keydown handler that respects the react bubbling order.
        if (ev.target === document.body) {
            this.onKeyDown(ev);
        }
    };

    private onKeyDown = (ev: React.KeyboardEvent | KeyboardEvent): void => {
        let handled = false;

        const roomAction = getKeyBindingsManager().getRoomAction(ev);
        switch (roomAction) {
            case KeyBindingAction.ScrollUp:
            case KeyBindingAction.ScrollDown:
            case KeyBindingAction.JumpToFirstMessage:
            case KeyBindingAction.JumpToLatestMessage:
                // pass the event down to the scroll panel
                this.onScrollKeyPressed(ev);
                handled = true;
                break;
            case KeyBindingAction.SearchInRoom:
                dis.fire(Action.FocusMessageSearch);
                handled = true;
                break;
        }
        if (handled) {
            ev.stopPropagation();
            ev.preventDefault();
            return;
        }

        const navAction = getKeyBindingsManager().getNavigationAction(ev);
        switch (navAction) {
            case KeyBindingAction.NextLandmark:
            case KeyBindingAction.PreviousLandmark:
                LandmarkNavigation.findAndFocusNextLandmark(
                    Landmark.MESSAGE_COMPOSER_OR_HOME,
                    navAction === KeyBindingAction.PreviousLandmark,
                );
                handled = true;
                break;
            case KeyBindingAction.FilterRooms:
                dis.fire(Action.OpenSpotlight);
                handled = true;
                break;
            case KeyBindingAction.ToggleUserMenu:
                dis.fire(Action.ToggleUserMenu);
                handled = true;
                break;
            case KeyBindingAction.ShowKeyboardSettings:
                dis.dispatch<OpenToTabPayload>({
                    action: Action.ViewUserSettings,
                    initialTabId: UserTab.Keyboard,
                });
                handled = true;
                break;
            case KeyBindingAction.GoToHome:
                // even if we cancel because there are modals open, we still
                // handled it: nothing else should happen.
                handled = true;
                if (Modal.hasDialogs()) {
                    return;
                }
                dis.dispatch({
                    action: Action.ViewHomePage,
                });
                break;
            case KeyBindingAction.ToggleSpacePanel:
                dis.fire(Action.ToggleSpacePanel);
                handled = true;
                break;
            case KeyBindingAction.ToggleRoomSidePanel:
                if (this.props.page_type === "room_view") {
                    this.context.rightPanelStore.togglePanel(null);
                    handled = true;
                }
                break;
            case KeyBindingAction.SelectPrevRoom:
                dis.dispatch<ViewRoomDeltaPayload>({
                    action: Action.ViewRoomDelta,
                    delta: -1,
                    unread: false,
                });
                handled = true;
                break;
            case KeyBindingAction.SelectNextRoom:
                dis.dispatch<ViewRoomDeltaPayload>({
                    action: Action.ViewRoomDelta,
                    delta: 1,
                    unread: false,
                });
                handled = true;
                break;
            case KeyBindingAction.SelectPrevUnreadRoom:
                dis.dispatch<ViewRoomDeltaPayload>({
                    action: Action.ViewRoomDelta,
                    delta: -1,
                    unread: true,
                });
                break;
            case KeyBindingAction.SelectNextUnreadRoom:
                dis.dispatch<ViewRoomDeltaPayload>({
                    action: Action.ViewRoomDelta,
                    delta: 1,
                    unread: true,
                });
                break;
            case KeyBindingAction.PreviousVisitedRoomOrSpace:
                PlatformPeg.get()?.navigateForwardBack(true);
                handled = true;
                break;
            case KeyBindingAction.NextVisitedRoomOrSpace:
                PlatformPeg.get()?.navigateForwardBack(false);
                handled = true;
                break;
        }

        // Handle labs actions here, as they apply within the same scope
        if (!handled) {
            const labsAction = getKeyBindingsManager().getLabsAction(ev);
            switch (labsAction) {
                case KeyBindingAction.ToggleHiddenEventVisibility: {
                    const hiddenEventVisibility = SettingsStore.getValueAt(
                        SettingLevel.DEVICE,
                        "showHiddenEventsInTimeline",
                        undefined,
                        false,
                    );
                    void SettingsStore.setValue(
                        "showHiddenEventsInTimeline",
                        null,
                        SettingLevel.DEVICE,
                        !hiddenEventVisibility,
                    );
                    handled = true;
                    break;
                }
            }
        }

        if (
            !handled &&
            PlatformPeg.get()?.overrideBrowserShortcuts() &&
            ev.code.startsWith("Digit") &&
            ev.code !== "Digit0" && // this is the shortcut for reset zoom, don't override it
            isOnlyCtrlOrCmdKeyEvent(ev)
        ) {
            dis.dispatch<SwitchSpacePayload>({
                action: Action.SwitchSpace,
                num: parseInt(ev.code.slice(5), 10), // Cut off the first 5 characters - "Digit"
            });
            handled = true;
        }

        if (handled) {
            ev.stopPropagation();
            ev.preventDefault();
            return;
        }

        const isModifier = ev.key === Key.ALT || ev.key === Key.CONTROL || ev.key === Key.META || ev.key === Key.SHIFT;
        if (!isModifier && !ev.ctrlKey && !ev.metaKey) {
            // The above condition is crafted to _allow_ characters with Shift
            // already pressed (but not the Shift key down itself).
            const isClickShortcut = ev.target !== document.body && (ev.key === Key.SPACE || ev.key === Key.ENTER);

            // We explicitly allow alt to be held due to it being a common accent modifier.
            // XXX: Forwarding Dead keys in this way does not work as intended but better to at least
            // move focus to the composer so the user can re-type the dead key correctly.
            const isPrintable = ev.key.length === 1 || ev.key === "Dead";

            // If the user is entering a printable character outside of an input field
            // redirect it to the composer for them.
            if (!isClickShortcut && isPrintable && !getInputableElement(ev.target as HTMLElement)) {
                const inThread = !!document.activeElement?.closest(".mx_ThreadView");
                // synchronous dispatch so we focus before key generates input
                dis.dispatch(
                    {
                        action: Action.FocusSendMessageComposer,
                        context: inThread ? TimelineRenderingType.Thread : TimelineRenderingType.Room,
                    },
                    true,
                );
                ev.stopPropagation();
                // we should *not* preventDefault() here as that would prevent typing in the now-focused composer
            }
        }
    };

    /**
     * dispatch a page-up/page-down/etc to the appropriate component
     * @param {Object} ev The key event
     */
    private onScrollKeyPressed = (ev: React.KeyboardEvent | KeyboardEvent): void => {
        this._roomView.current?.handleScrollKey(ev);
    };

    /**
     * The rooms to keep mounted: the one on screen and the last few before it, while they are still rooms
     * the reader is in. Only with the new timeline, which knows when it is behind another room (it sends
     * no read receipts then); with the old one a room is remounted on every switch, as before.
     */
    private keptRooms(current: string | null | undefined): string[] {
        if (!current) return [];
        if (!SettingsStore.getValue("feature_new_timeline")) {
            this.kept = [current];
            return this.kept;
        }
        const client = this._matrixClient;
        const stillIn = (roomId: string): boolean =>
            roomId === current || client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join;
        this.kept = [current, ...this.kept.filter((roomId) => roomId !== current && stillIn(roomId))].slice(
            0,
            KEPT_ROOMS,
        );
        return this.kept;
    }

    /** What is mounted now that a render has been committed: what the next switch will be told from. */
    private noteMounted(): void {
        const ahead = this.aheadRooms(this.kept);
        this.mounted = [...this.kept, ...ahead];
        this.mountedAhead = new Set(ahead);
    }

    public componentDidUpdate(prevProps: IProps): void {
        const current = this.props.currentRoomId;
        if (current && current !== prevProps.currentRoomId && this.props.page_type === PageTypes.RoomView) {
            // How the room now in front was found: still mounted from before, mounted ahead, or built just now.
            const kind: SwitchKind = !this.mounted.includes(current)
                ? "cold"
                : this.mountedAhead.has(current)
                  ? "ahead"
                  : "kept";
            switchShown(current, kind);
            // Opened, so it is kept in its own right from here on.
            roomsAhead.forget(current);
        }
        this.noteMounted();
    }

    /**
     * The rooms to mount ahead of being opened: the ones somebody said the reader is about to open, that
     * are not mounted in their own right and are rooms the reader is in. As with the kept rooms, only
     * with the new timeline.
     */
    private aheadRooms(kept: readonly string[]): string[] {
        if (!SettingsStore.getValue("feature_new_timeline")) return [];
        const client = this._matrixClient;
        return this.state.ahead.filter(
            (roomId) => !kept.includes(roomId) && client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join,
        );
    }

    /**
     * The rooms at the top of the list, got ready once the app has been up a while and has nothing else
     * to do: where the reader is most likely to go next, and the only head start there is on a phone,
     * which has no pointer to rest on a room before it is tapped.
     */
    private async prepareTopRooms(): Promise<void> {
        if (!mayPrepareRooms() || !SettingsStore.getValue("feature_new_timeline")) return;
        await new Promise<void>((resolve) =>
            typeof requestIdleCallback === "undefined" ? resolve() : requestIdleCallback(() => resolve()),
        );
        // Loaded here rather than at the top: the room list store is not something the shell should pull in.
        const { default: RoomListStoreV3 } = await import("../../stores/room-list-v3/RoomListStoreV3");
        const top = RoomListStoreV3.instance
            .getSortedRoomsInActiveSpace()
            .sections.flatMap((section) => section.rooms)
            .map((room) => room.roomId)
            .filter((roomId) => roomId !== this.props.currentRoomId && !this.kept.includes(roomId))
            .slice(0, ROOMS_AHEAD);
        // The first in the list last, so it is the newest and the last to make way.
        for (const roomId of top.reverse()) roomsAhead.prepare(roomId);
    }

    public render(): React.ReactNode {
        let pageElement;

        const moduleRenderer = this.props.page_type
            ? ModuleApi.instance.navigation.locationRenderers.get(this.props.page_type)
            : undefined;

        switch (this.props.page_type) {
            case PageTypes.RoomView: {
                const current = this.props.currentRoomId;
                const kept = this.keptRooms(current);
                const mounted = [...kept, ...this.aheadRooms(kept)];
                /*
                 * The last few rooms stay mounted, the one on screen over the others, so switching back to
                 * one is instant - its timeline, scroll and composer as they were, no spinner in between -
                 * as Telegram keeps the chats it has shown. Each room is still its own RoomView (it does not
                 * support changing room); the ones behind are told so and keep out of the reader's way.
                 *
                 * The rooms the reader is about to open are mounted behind it in the same way (aheadRooms),
                 * so opening one of those for the first time is the same switch.
                 */
                pageElement = (
                    <>
                        {mounted.map((roomId) => {
                            const active = roomId === current;
                            return (
                                <div key={roomId} className="mx_RoomView_kept" data-active={active}>
                                    <RoomView
                                        ref={active ? this._roomView : undefined}
                                        active={active}
                                        keptRoomId={roomId}
                                        onRegistered={this.props.onRegistered}
                                        threepidInvite={active ? this.props.threepidInvite : undefined}
                                        oobData={active ? this.props.roomOobData : undefined}
                                        justCreatedOpts={active ? this.props.roomJustCreatedOpts : undefined}
                                        forceTimeline={active ? this.props.forceTimeline : undefined}
                                    />
                                </div>
                            );
                        })}
                        {!current && (
                            <RoomView
                                ref={this._roomView}
                                onRegistered={this.props.onRegistered}
                                threepidInvite={this.props.threepidInvite}
                                oobData={this.props.roomOobData}
                                key="roomview"
                                justCreatedOpts={this.props.roomJustCreatedOpts}
                                forceTimeline={this.props.forceTimeline}
                            />
                        )}
                    </>
                );
                break;
            }

            case PageTypes.HomePage:
                pageElement = <HomePage justRegistered={this.props.justRegistered} />;
                break;

            case PageTypes.UserView:
                if (!!this.props.currentUserId) {
                    pageElement = (
                        <UserView userId={this.props.currentUserId} resizeNotifier={this.context.resizeNotifier} />
                    );
                }
                break;
            default: {
                if (moduleRenderer) {
                    // Since the view will be removed, remove the vm as well
                    this.disposeResizerViewModel();
                    pageElement = moduleRenderer();
                } else {
                    console.warn(`Couldn't render page type "${this.props.page_type}"`);
                }
            }
        }

        const wrapperClasses = classNames({
            mx_MatrixChat_wrapper: true,
            mx_MatrixChat_useCompactLayout: this.state.useCompactLayout,
        });
        const bodyClasses = classNames({
            "mx_MatrixChat": true,
            "mx_MatrixChat--with-avatar": this.state.backgroundImage,
        });

        const leftPanelWrapperClasses = classNames("mx_LeftPanel_wrapper");

        const audioFeedArraysForCalls = this.state.activeCalls.map((call) => {
            return <AudioFeedArrayForLegacyCall call={call} key={call.callId} />;
        });

        const leftPanel = (
            <div className="mx_LeftPanel_outerWrapper">
                <LeftPanelLiveShareWarning isMinimized={false} />
                <div className={leftPanelWrapperClasses}>
                    {!moduleRenderer && (
                        <div className="mx_LeftPanel_wrapper--user">
                            <LeftPanel isMinimized={false} resizeNotifier={this.context.resizeNotifier} />
                        </div>
                    )}
                </div>
            </div>
        );

        const roomView = <div className="mx_RoomView_wrapper">{pageElement}</div>;

        let content: React.ReactNode;
        const resizerViewModel = !moduleRenderer && !this.state.chatColumns ? this.getResizerViewModel() : undefined;
        if (!moduleRenderer && this.state.chatColumns) {
            // Fork: Telegram Web K's columns (draggable chat-list edge, collapsed avatars column,
            // single-pane handheld navigation) replace the resizable panel group.
            content = (
                <TgColumns
                    spacePanel={<SpacePanel />}
                    leftPanel={leftPanel}
                    resizeNotifier={this.context.resizeNotifier}
                    chatOpen={
                        this.props.page_type === PageTypes.RoomView || this.props.page_type === PageTypes.UserView
                    }
                    chatKey={this.props.currentRoomId ?? this.props.currentUserId ?? undefined}
                    onBack={this.onTgBack}
                >
                    {roomView}
                    <TgTweaksPanel />
                    <TgMetricsPanel />
                </TgColumns>
            );
        } else if (resizerViewModel && !moduleRenderer) {
            // Resizable layout with a draggable separator. The SpacePanel lives inside GroupView
            // (leftPanel omits it).
            content = (
                <GroupView vm={resizerViewModel}>
                    <SpacePanel />
                    <LeftResizablePanelView
                        vm={resizerViewModel}
                        className="mx_LeftPanel_panel"
                        minSize="200px"
                        maxSize="370px"
                        defaultSize="370px"
                    >
                        {leftPanel}
                    </LeftResizablePanelView>
                    <SeparatorView className="mx_Separator" vm={resizerViewModel} />
                    <Panel className="mx_LeftPanel_panel">{roomView}</Panel>
                </GroupView>
            );
        } else {
            // Fallback layout for a module's full-screen view (e.g. multiroom) which must not use the
            // resizable layout above. The ResizeHandle is dropped for module views, which manage their
            // own layout.
            content = (
                <>
                    <SpacePanel />
                    {leftPanel}
                    {roomView}
                </>
            );
        }

        return (
            <MatrixClientContextProvider client={this._matrixClient}>
                <div
                    onPaste={this.onPaste}
                    onKeyDown={this.onReactKeyDown}
                    className={wrapperClasses}
                    aria-hidden={this.props.hideToSRUsers}
                >
                    <AppearanceAttributes />
                    <ToastContainer />
                    <div className={bodyClasses}>{content}</div>
                </div>
                <PipContainer />
                <NonUrgentToastContainer />
                {audioFeedArraysForCalls}
            </MatrixClientContextProvider>
        );
    }
}

export default LoggedInView;
