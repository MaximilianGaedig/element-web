/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import classNames from "classnames";
import {
    type IEventRelation,
    type Room,
    type MatrixClient,
    THREAD_RELATION_TYPE,
    M_POLL_START,
} from "matrix-js-sdk/src/matrix";
import React, { type JSX, type ReactElement, type ReactNode, useContext, useRef } from "react";
import {
    MicOnIcon,
    OverflowHorizontalIcon,
    PlusIcon,
    PollsIcon,
    StickerIcon,
    TextFormattingIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import AiIcon from "@vector-im/compound-design-tokens/assets/web/icons/ai";
import { UploadButton, useViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import { CollapsibleButton, OverflowMenuContext } from "./CollapsibleButton";
import { type MenuProps } from "../../structures/ContextMenu";
import ErrorDialog from "../dialogs/ErrorDialog";
import { LocationButton } from "../location";
import Modal from "../../../Modal";
import PollCreateDialog from "../elements/PollCreateDialog";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import { EmojiButton } from "./EmojiButton";
import { TgEmoticonsDropdown } from "../telegram/TgEmoticonsDropdown";
import UIStore from "../../../stores/UIStore";
import { filterBoolean } from "../../../utils/arrays";
import { askAbout, askOpenQuestions, canAsk, composerText } from "../../../utils/ai/asking";
import { useSettingValue } from "../../../hooks/useSettings";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { useScopedRoomContext } from "../../../contexts/ScopedRoomContext.tsx";
import { useRoomUploadViewModel } from "../../../viewmodels/room/RoomUploadViewModel.tsx";

interface IProps {
    addEmoji: (emoji: string) => boolean;
    haveRecording: boolean;
    isMenuOpen: boolean;
    isStickerPickerOpen: boolean;
    menuPosition?: MenuProps;
    onRecordStartEndClick: () => void;
    relation?: IEventRelation;
    setStickerPickerOpen: (isStickerPickerOpen: boolean) => void;
    showLocationButton: boolean;
    showPollsButton: boolean;
    /** The Telegram-style composer records from its send capsule instead. */
    hideVoiceButton?: boolean;
    /**
     * Telegram-style composer: the smiley opens tweb's combined emoji/sticker dropdown (so there is no
     * separate sticker button), and the buttons get classes the Telegram layout orders by.
     */
    telegram?: boolean;
    /**
     * Telegram-style composer islands: "attach" renders only the round + button with its menu (the
     * island left of the input), "inline" only the sticker/emoji button inside the input.
     */
    telegramSlot?: "attach" | "inline";
    /** Whether the input has text (the Telegram sticker button turns into the emoji button). */
    hasText?: boolean;
    showStickersButton: boolean;
    toggleButtonMenu: () => void;
    isRichTextEnabled: boolean;
    onComposerModeClick: () => void;
}

/*
 * Asking about this chat, from the menu the other things you can do already live in.
 *
 * Here rather than in a strip of its own above the composer: that strip was ninety pixels of the
 * conversation, in every chat, permanently, to offer something used twice a day. What happens next is
 * shown over the composer while it happens (views/ai/AiStatus.tsx).
 *
 * Asking about what is typed is offered only when something is - it asks about the words in the composer,
 * so with an empty composer there is no question to ask.
 */
function askingOptions(client: MatrixClient, room: Room): ReactNode[] {
    if (!canAsk()) return [];
    const typed = composerText();
    return filterBoolean([
        <IconizedContextMenuOption
            key="ai-catch-up"
            icon={<AiIcon />}
            label={_t("ai|catch_up")}
            onClick={() => void askAbout(client, room, "summary")}
        />,
        <IconizedContextMenuOption
            key="ai-questions"
            icon={<AiIcon />}
            label={_t("ai|open_questions")}
            onClick={() => void askOpenQuestions(client, room)}
        />,
        typed ? (
            <IconizedContextMenuOption
                key="ai-ask"
                icon={<AiIcon />}
                label={_t("ai|ask")}
                onClick={() => void askAbout(client, room, "question", typed)}
            />
        ) : null,
    ]);
}

const MessageComposerButtons: React.FC<IProps> = (props: IProps) => {
    const matrixClient = useContext(MatrixClientContext);
    const roomUploadVM = useRoomUploadViewModel();
    const roomUploadSnapshot = useViewModel(roomUploadVM);
    const { room, narrow } = useScopedRoomContext("room", "narrow");

    const isWysiwygLabEnabled = useSettingValue("feature_wysiwyg_composer");
    const moreButton = useRef<HTMLDivElement>(null);

    if (!matrixClient || !room || props.haveRecording) {
        return null;
    }

    let mainButtons: ReactNode[];
    let moreButtons: ReactNode[];
    const uploadOptions = roomUploadSnapshot.options.map(({ type, icon: Icon, label }) => (
        <IconizedContextMenuOption
            onClick={() => roomUploadVM.onUploadOptionSelected(type)}
            icon={Icon && <Icon />}
            label={label}
            key={type}
        />
    ));
    if (props.telegram && !isWysiwygLabEnabled) {
        // Telegram-style: one menu button at the start holding the attachment options, polls and
        // location; the smiley at the end opens the combined emoji/sticker dropdown.
        mainButtons = [
            <TgEmoticonsDropdown
                key="emoticons"
                room={room}
                threadId={props.relation?.rel_type === THREAD_RELATION_TYPE.name ? props.relation.event_id! : null}
                addEmoji={props.addEmoji}
                hasText={!!props.hasText}
            />,
        ];
        moreButtons = [
            uploadOptions,
            props.showPollsButton ? pollButton(room, props.relation) : null,
            showLocationButton(props, room, matrixClient),
            askingOptions(matrixClient, room),
        ];
    } else if (narrow) {
        mainButtons = [
            isWysiwygLabEnabled ? (
                <ComposerModeButton
                    key="composerModeButton"
                    isRichTextEnabled={props.isRichTextEnabled}
                    onClick={props.onComposerModeClick}
                />
            ) : (
                emojiButton(props)
            ),
        ];
        moreButtons = [
            // This a textual list of buttons, so we can't use the UploadButton here.
            uploadOptions,
            showStickersButton(props),
            voiceRecordingButton(props, narrow),
            props.showPollsButton ? pollButton(room, props.relation) : null,
            showLocationButton(props, room, matrixClient),
            askingOptions(matrixClient, room),
        ];
    } else {
        mainButtons = [
            isWysiwygLabEnabled ? (
                <ComposerModeButton
                    key="composerModeButton"
                    isRichTextEnabled={props.isRichTextEnabled}
                    onClick={props.onComposerModeClick}
                />
            ) : (
                emojiButton(props)
            ),
            <UploadButton key="upload" vm={roomUploadVM} />,
        ];
        moreButtons = [
            showStickersButton(props),
            voiceRecordingButton(props, narrow),
            props.showPollsButton ? pollButton(room, props.relation) : null,
            showLocationButton(props, room, matrixClient),
            askingOptions(matrixClient, room),
        ];
    }

    mainButtons = filterBoolean(mainButtons);
    moreButtons = filterBoolean(moreButtons);

    const moreOptionsClasses = classNames({
        mx_MessageComposer_button: true,
        mx_MessageComposer_buttonMenu: true,
        mx_MessageComposer_closeButtonMenu: props.isMenuOpen,
    });

    const slot = props.telegram ? props.telegramSlot : undefined;
    return (
        <>
            {slot !== "attach" && mainButtons}
            {slot !== "inline" && moreButtons.length > 0 && (
                <AccessibleButton
                    ref={moreButton}
                    className={classNames(moreOptionsClasses, { mx_TgAttachButton: slot === "attach" })}
                    onClick={props.toggleButtonMenu}
                    title={slot === "attach" ? _t("bridge|telegram_attach") : _t("quick_settings|sidebar_settings")}
                >
                    {slot === "attach" ? <PlusIcon /> : <OverflowHorizontalIcon />}
                </AccessibleButton>
            )}
            {slot !== "inline" && props.isMenuOpen && (
                <IconizedContextMenu
                    onFinished={props.toggleButtonMenu}
                    {...(props.telegram ? telegramMenuPosition(moreButton.current) : props.menuPosition)}
                    wrapperClassName="mx_MessageComposer_Menu"
                    compact={true}
                >
                    <OverflowMenuContext.Provider value={props.toggleButtonMenu}>
                        <IconizedContextMenuOptionList>{moreButtons}</IconizedContextMenuOptionList>
                    </OverflowMenuContext.Provider>
                </IconizedContextMenu>
            )}
        </>
    );
};

/** tweb's attach menu opens above its button, aligned to the button's start. */
function telegramMenuPosition(button: HTMLElement | null): MenuProps | undefined {
    const rect = button?.getBoundingClientRect();
    if (!rect) return undefined;
    return { left: rect.left, bottom: UIStore.instance.windowHeight - rect.top + 8 };
}

function emojiButton(props: IProps): ReactElement {
    return (
        <EmojiButton
            key="emoji_button"
            addEmoji={props.addEmoji}
            menuPosition={props.menuPosition}
            className="mx_MessageComposer_button"
        />
    );
}

function showStickersButton(props: IProps): ReactElement | null {
    return props.showStickersButton ? (
        <CollapsibleButton
            id="stickersButton"
            key="controls_stickers"
            className="mx_MessageComposer_button"
            onClick={() => props.setStickerPickerOpen(!props.isStickerPickerOpen)}
            title={props.isStickerPickerOpen ? _t("composer|close_sticker_picker") : _t("common|sticker")}
        >
            <StickerIcon />
        </CollapsibleButton>
    ) : null;
}

function voiceRecordingButton(props: IProps, narrow: boolean): ReactElement | null {
    // XXX: recording UI does not work well in narrow mode, so hide for now
    return narrow || props.hideVoiceButton ? null : (
        <CollapsibleButton
            key="voice_message_send"
            className="mx_MessageComposer_button"
            onClick={props.onRecordStartEndClick}
            title={_t("composer|voice_message_button")}
        >
            <MicOnIcon />
        </CollapsibleButton>
    );
}

function pollButton(room: Room, relation?: IEventRelation): ReactElement {
    return <PollButton key="polls" room={room} relation={relation} />;
}

interface IPollButtonProps {
    room: Room;
    relation?: IEventRelation;
}

class PollButton extends React.PureComponent<IPollButtonProps> {
    public static contextType = OverflowMenuContext;
    declare public context: React.ContextType<typeof OverflowMenuContext>;

    private onCreateClick = (): void => {
        this.context?.(); // close overflow menu
        const canSend = this.props.room.currentState.maySendEvent(
            M_POLL_START.name,
            MatrixClientPeg.safeGet().getSafeUserId(),
        );
        if (!canSend) {
            Modal.createDialog(ErrorDialog, {
                title: _t("composer|poll_button_no_perms_title"),
                description: _t("composer|poll_button_no_perms_description"),
            });
        } else {
            const threadId =
                this.props.relation?.rel_type === THREAD_RELATION_TYPE.name ? this.props.relation.event_id : undefined;

            Modal.createDialog(
                PollCreateDialog,
                {
                    room: this.props.room,
                    threadId,
                },
                "mx_CompoundDialog",
                false, // isPriorityModal
                true, // isStaticModal
            );
        }
    };

    public render(): React.ReactNode {
        // do not allow sending polls within threads at this time
        if (this.props.relation?.rel_type === THREAD_RELATION_TYPE.name) return null;

        return (
            <CollapsibleButton
                className="mx_MessageComposer_button"
                onClick={this.onCreateClick}
                title={_t("composer|poll_button")}
            >
                <PollsIcon />
            </CollapsibleButton>
        );
    }
}

function showLocationButton(props: IProps, room: Room, matrixClient: MatrixClient): ReactElement | null {
    const sender = room.getMember(matrixClient.getSafeUserId());

    return props.showLocationButton && sender ? (
        <LocationButton
            key="location"
            roomId={room.roomId}
            relation={props.relation}
            sender={sender}
            menuPosition={props.menuPosition}
        />
    ) : null;
}

interface WysiwygToggleButtonProps {
    isRichTextEnabled: boolean;
    onClick: (ev: ButtonEvent) => void;
}

function ComposerModeButton({ isRichTextEnabled, onClick }: WysiwygToggleButtonProps): JSX.Element {
    const title = isRichTextEnabled ? _t("composer|mode_plain") : _t("composer|mode_rich_text");

    return (
        <CollapsibleButton className="mx_MessageComposer_button" onClick={onClick} title={title}>
            <TextFormattingIcon />
        </CollapsibleButton>
    );
}
export default MessageComposerButtons;
