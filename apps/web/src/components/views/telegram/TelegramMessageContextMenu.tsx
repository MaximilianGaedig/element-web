/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The message context menu of Telegram Web K (GPL-3.0, https://github.com/morethanwords/tweb),
 * src/components/chat/contextMenu.ts ChatContextMenu.setButtons: its items in its order, with its
 * icons, mapped to Matrix actions. Items tweb has no counterpart for (view source, …) follow tweb's
 * items, before Delete, which tweb always puts last.
 */

import React, { type JSX, useContext, useMemo, useState, useSyncExternalStore, useCallback } from "react";
import {
    EventType,
    type MatrixEvent,
    type Relations,
    RelationType,
    RelationsEvent,
    Thread,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import TelegramMessageMenu, { type TelegramMenuItem } from "./TelegramMessageMenu";
import TelegramReactionBar from "./TelegramReactionBar";
import ReactionPicker from "../emojipicker/ReactionPicker";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import RoomContext, { TimelineRenderingType } from "../../../contexts/RoomContext";
import { CardContext } from "../right_panel/context";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ShowThreadPayload } from "../../../dispatcher/payloads/ShowThreadPayload";
import { canEditContent, isContentActionable } from "../../../utils/EventUtils";
import { copyPlaintext, getSelectedText } from "../../../utils/strings";
import PinningUtils from "../../../utils/PinningUtils";
import { getForwardableEvent } from "../../../events/forward/getForwardableEvent";
import { getShareableLocationEvent } from "../../../events/location/getShareableLocationEvent";
import { createMapSiteLinkFromEvent } from "../../../utils/location";
import { isUrlPermitted } from "../../../HtmlUtils";
import SettingsStore from "../../../settings/SettingsStore";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { FileDownloader } from "../../../utils/FileDownloader";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";
import { editBlockedReason, getRoomFeatures, isReactionAllowed } from "../../../utils/bridge/roomFeatures";
import { getMenuReactions } from "../../../utils/telegram/telegramMenu";
import { get as getRecentEmoji } from "../../../emojipicker/recent";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { type IEventTileOps } from "../rooms/EventTile";

export interface TelegramMenuHandlers {
    reply: () => void;
    edit: () => void;
    quote: () => void;
    pin: (isPinned: boolean) => void;
    forward: (event: MatrixEvent) => () => void;
    report: () => void;
    select: () => void;
    viewSource: () => void;
    redact: () => void;
    endPoll: () => void;
    resendReactions: () => void;
    unhidePreview: () => void;
    collapseReplyChain: () => void;
    viewInRoom: () => void;
    jumpToRelated: (eventId: string) => void;
}

interface Props {
    point: { x: number; y: number };
    mxEvent: MatrixEvent;
    /** The href of a clicked link, or the event permalink. */
    link?: string;
    permalinkCreator?: RoomPermalinkCreator;
    reactions?: Relations | null;
    eventTileOps?: IEventTileOps;
    collapseReplyChain?: () => void;
    canRedact: boolean;
    canPin: boolean;
    canEndPoll: boolean;
    unsentReactions: MatrixEvent[];
    /** Whether the selected text lies in one message text, so it can be quoted. */
    quotable: boolean;
    handlers: TelegramMenuHandlers;
    onFinished: () => void;
}

/** The keys of the reactions we sent on the event, mapped to the reaction event ids. */
function useMyReactions(reactions: Relations | null | undefined): Map<string, string> {
    const subscribe = useCallback(
        (cb: () => void) => {
            if (!reactions) return () => {};
            reactions.on(RelationsEvent.Add, cb);
            reactions.on(RelationsEvent.Remove, cb);
            reactions.on(RelationsEvent.Redaction, cb);
            return () => {
                reactions.off(RelationsEvent.Add, cb);
                reactions.off(RelationsEvent.Remove, cb);
                reactions.off(RelationsEvent.Redaction, cb);
            };
        },
        [reactions],
    );
    const snapshot = useSyncExternalStore(subscribe, () => {
        const me = MatrixClientPeg.safeGet().getSafeUserId();
        const mine = reactions?.getAnnotationsBySender()?.[me];
        return JSON.stringify(
            [...(mine ?? [])].filter((e) => !e.isRedacted()).map((e) => [e.getRelation()?.key, e.getId()]),
        );
    });
    return useMemo(() => new Map(JSON.parse(snapshot) as [string, string][]), [snapshot]);
}

async function downloadMedia(mxEvent: MatrixEvent): Promise<void> {
    try {
        const helper = new MediaEventHelper(mxEvent);
        const blob = await helper.sourceBlob.value;
        await new FileDownloader().download({ blob, name: helper.fileName });
    } catch (e) {
        logger.warn("Failed to download media", e);
        Modal.createDialog(ErrorDialog, {
            title: _t("timeline|download_failed"),
            description: `${_t("timeline|download_failed_description")}\n\n${String(e)}`,
        });
    }
}

export default function TelegramMessageContextMenu({
    point,
    mxEvent,
    link,
    permalinkCreator,
    reactions,
    eventTileOps,
    collapseReplyChain,
    canRedact,
    canPin,
    canEndPoll,
    unsentReactions,
    quotable,
    handlers,
    onFinished,
}: Props): JSX.Element {
    const roomContext = useContext(RoomContext);
    const cardContext = useContext(CardContext);
    const [expanded, setExpanded] = useState(false);
    const myReactions = useMyReactions(reactions);
    const cli = MatrixClientPeg.safeGet();
    const room = cli.getRoom(mxEvent.getRoomId());
    const { timelineRenderingType, canReact, canSendMessages, canSelfRedact } = roomContext;
    const contentActionable = isContentActionable(mxEvent);
    const isSent = !mxEvent.status || mxEvent.status === "sent";
    const permalink = permalinkCreator?.forEvent(mxEvent.getId()!);
    const selectedText = getSelectedText();
    const content = mxEvent.getContent();
    const bodyText = typeof content.body === "string" && !MediaEventHelper.isEligible(mxEvent) ? content.body : "";

    const react = (key: string): void => {
        const existing = myReactions.get(key);
        if (existing) {
            if (!mxEvent.isRedacted() && canSelfRedact) void cli.redactEvent(mxEvent.getRoomId()!, existing);
        } else if (isReactionAllowed(room ?? null, key)) {
            void cli.sendEvent(mxEvent.getRoomId()!, EventType.Reaction, {
                "m.relates_to": { rel_type: RelationType.Annotation, event_id: mxEvent.getId()!, key },
            });
            dis.dispatch({ action: "message_sent" });
        }
    };

    const items: TelegramMenuItem[] = [];
    const add = (item: TelegramMenuItem | false | undefined | null | ""): void => {
        if (item) items.push(item);
    };

    // tweb: Quote (only for a text selection), Reply, View replies (threads), Edit.
    add(
        !!selectedText.trim() &&
            quotable && {
                key: "quote",
                icon: "message_quote",
                label: _t("action|quote"),
                onClick: handlers.quote,
                triggerOnMouseDown: true,
            },
    );
    add(
        contentActionable &&
            canSendMessages && { key: "reply", icon: "reply", label: _t("action|reply"), onClick: handlers.reply },
    );
    const relationType = mxEvent.getRelation()?.rel_type;
    add(
        contentActionable &&
            canSendMessages &&
            !!Thread.hasServerSideSupport &&
            timelineRenderingType !== TimelineRenderingType.Thread &&
            (!relationType || relationType === RelationType.Thread) && {
                key: "thread",
                icon: "bubblereply",
                label: _t("action|reply_in_thread"),
                onClick: () => {
                    const thread = mxEvent.getThread();
                    dis.dispatch<ShowThreadPayload>(
                        thread && !mxEvent.isThreadRoot
                            ? {
                                  action: Action.ShowThread,
                                  rootEvent: thread.rootEvent!,
                                  initialEvent: mxEvent,
                                  scroll_into_view: true,
                                  highlighted: true,
                                  push: cardContext.isCard,
                              }
                            : { action: Action.ShowThread, rootEvent: mxEvent, push: cardContext.isCard },
                    );
                },
            },
    );
    add(
        canEditContent(cli, mxEvent) &&
            !editBlockedReason(mxEvent, room) && {
                key: "edit",
                icon: "edit",
                label: _t("action|edit"),
                onClick: handlers.edit,
            },
    );

    // tweb: Copy (the whole text) or Copy Selected Text, then Copy Link for a clicked link.
    if (selectedText) {
        add({
            key: "copy",
            icon: "copy",
            label: _t("bridge|telegram_menu_copy_selected"),
            onClick: () => void copyPlaintext(selectedText),
            triggerOnMouseDown: true,
        });
    } else if (bodyText && contentActionable) {
        add({ key: "copy", icon: "copy", label: _t("action|copy"), onClick: () => void copyPlaintext(bodyText) });
    }
    add(
        !!link &&
            link !== permalink && {
                key: "copyLink",
                icon: "copy",
                label: _t("action|copy_link"),
                onClick: () => void copyPlaintext(link),
            },
    );

    // tweb: Copy Message Link, Pin/Unpin, Download, Stop Poll, Forward, Report, Select.
    add(
        !!permalink &&
            isSent && {
                key: "copyMessageLink",
                icon: "link",
                label: _t("bridge|telegram_menu_copy_message_link"),
                onClick: () => void copyPlaintext(permalink),
            },
    );
    if (canPin) {
        const isPinned = PinningUtils.isPinned(cli, mxEvent);
        add({
            key: "pin",
            icon: isPinned ? "unpin" : "pin",
            label: isPinned ? _t("action|unpin") : _t("action|pin"),
            onClick: () => handlers.pin(isPinned),
        });
    }
    add(
        MediaEventHelper.isEligible(mxEvent) &&
            contentActionable && {
                key: "download",
                icon: "download",
                label: _t("action|download"),
                onClick: () => void downloadMedia(mxEvent),
            },
    );
    add(canEndPoll && { key: "endPoll", icon: "stop", label: _t("poll|end_title"), onClick: handlers.endPoll });
    const forwardable = getForwardableEvent(mxEvent, cli);
    add(
        contentActionable &&
            !!forwardable && {
                key: "forward",
                icon: "forward",
                label: _t("action|forward"),
                onClick: handlers.forward(forwardable),
            },
    );
    add(
        mxEvent.getSender() !== cli.getUserId() && {
            key: "report",
            icon: "flag",
            label: _t("timeline|context_menu|report"),
            onClick: handlers.report,
        },
    );
    add({ key: "select", icon: "select", label: _t("bridge|telegram_menu_select"), onClick: handlers.select });

    // Matrix-only items.
    const isThreadRootInThread =
        (timelineRenderingType === TimelineRenderingType.Thread ||
            timelineRenderingType === TimelineRenderingType.ThreadsList) &&
        mxEvent.getThread()?.rootEvent === mxEvent;
    add(
        isThreadRootInThread && {
            key: "viewInRoom",
            icon: "eye",
            label: _t("timeline|mab|view_in_room"),
            onClick: handlers.viewInRoom,
        },
    );
    const location = getShareableLocationEvent(mxEvent, cli);
    add(
        !!location && {
            key: "map",
            icon: "location",
            label: _t("timeline|context_menu|open_in_osm"),
            href: createMapSiteLinkFromEvent(location) ?? undefined,
            onClick: () => {},
        },
    );
    const externalUrl = content.external_url;
    add(
        typeof externalUrl === "string" &&
            isUrlPermitted(externalUrl) && {
                key: "external",
                icon: "newtab",
                label: _t("timeline|context_menu|external_url"),
                href: externalUrl,
                onClick: () => {},
            },
    );
    add(
        !!eventTileOps?.isWidgetHidden() && {
            key: "unhidePreview",
            icon: "eye",
            label: _t("timeline|context_menu|show_url_preview"),
            onClick: handlers.unhidePreview,
        },
    );
    add(
        !!collapseReplyChain && {
            key: "collapse",
            icon: "up",
            label: _t("timeline|context_menu|collapse_reply_thread"),
            onClick: handlers.collapseReplyChain,
        },
    );
    add(
        !mxEvent.isRedacted() &&
            unsentReactions.length > 0 && {
                key: "resendReactions",
                icon: "rotate_right",
                label: _t("timeline|context_menu|resent_unsent_reactions", { unsentCount: unsentReactions.length }),
                onClick: handlers.resendReactions,
            },
    );
    const relatedEventId = mxEvent.getAssociatedId();
    add(
        !!relatedEventId &&
            SettingsStore.getValue("developerMode") && {
                key: "related",
                icon: "info",
                label: _t("timeline|context_menu|view_related_event"),
                onClick: () => handlers.jumpToRelated(relatedEventId),
            },
    );
    add({
        key: "viewSource",
        icon: "info",
        label: _t("timeline|context_menu|view_source"),
        onClick: handlers.viewSource,
    });

    // tweb: Delete last.
    add(
        isSent &&
            canRedact && {
                key: "delete",
                icon: "delete",
                label: _t("action|delete"),
                onClick: handlers.redact,
                danger: true,
            },
    );

    // tweb shows the bar unless the chat has reactions off (chatReactionsNone).
    const features = getRoomFeatures(room);
    const reactionsOff = features ? !((features.reaction ?? 0) > 0) : false;
    const showReactions = contentActionable && canReact && !reactionsOff && !mxEvent.isRedacted();
    const menuReactions = useMemo(
        () => getMenuReactions(getRecentEmoji(), features?.allowed_reactions),
        [features?.allowed_reactions],
    );

    return (
        <TelegramMessageMenu
            point={point}
            items={items}
            reactions={
                showReactions
                    ? (close) => (
                          <TelegramReactionBar
                              reactions={menuReactions}
                              chosen={new Set(myReactions.keys())}
                              onChoose={(emoji) => {
                                  react(emoji);
                                  close();
                              }}
                              onMore={() => setExpanded(true)}
                          />
                      )
                    : undefined
            }
            expanded={
                expanded
                    ? (close) => (
                          <div className="mx_TgMenu_picker">
                              <ReactionPicker mxEvent={mxEvent} reactions={reactions} onFinished={close} />
                          </div>
                      )
                    : undefined
            }
            onFinished={onFinished}
        />
    );
}
