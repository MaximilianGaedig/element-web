/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useSyncExternalStore } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import InlineSpinner from "../elements/InlineSpinner";
import { _t } from "../../../languageHandler";
import RecordingPlayback from "../audio_messages/RecordingPlayback";
import MAudioBody from "./MAudioBody";
import MediaProcessingError from "./shared/MediaProcessingError";
import { isVoiceMessage } from "../../../utils/EventUtils";
import { PlaybackQueue } from "../../../audio/PlaybackQueue";
import { type Playback, PlaybackState } from "../../../audio/Playback";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import { PlaybackSpeed } from "../../../audio/PlaybackSpeed";
import { ListenedVoiceMessages } from "../../../audio/ListenedVoiceMessages";
import { attachMediaSession } from "../../../audio/PlaybackMediaSession";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import RoomContext from "../../../contexts/RoomContext";
import { FileBodyFactory, renderMBody } from "./MBodyFactory";
import { TgTranscript } from "../telegram/TgTranscript";

/** The player, with a dot for a message from somebody else that has not been played yet. */
function VoiceMessagePlayer({ playback, mxEvent }: { playback: Playback; mxEvent: MatrixEvent }): JSX.Element {
    const unplayed = useSyncExternalStore(ListenedVoiceMessages.subscribe, () =>
        ListenedVoiceMessages.isUnplayed(mxEvent, MatrixClientPeg.get()?.getUserId() ?? null),
    );
    return <RecordingPlayback playback={playback} unplayed={unplayed} showSpeed />;
}

export default class MVoiceMessageBody extends MAudioBody {
    /** Undoes what onMount hooked the playback up to. */
    private detach: Array<() => void> = [];

    public static contextType = RoomContext;
    declare public context: React.ContextType<typeof RoomContext>;

    protected onMount(playback: Playback): void {
        this.hookUp(playback);
        if (isVoiceMessage(this.props.mxEvent)) {
            PlaybackQueue.forRoom(this.props.mxEvent.getRoomId()!, this.context.roomViewStore).unsortedEnqueue(
                this.props.mxEvent,
                playback,
            );
        }
    }

    /** The things every voice message does besides play: follow the shared speed, count as listened to, show on the system's media controls. */
    private hookUp(playback: Playback): void {
        const { mxEvent } = this.props;
        const eventId = mxEvent.getId();

        const applySpeed = (): void => playback.setPlaybackRate(PlaybackSpeed.current);
        applySpeed();
        this.detach.push(PlaybackSpeed.subscribe(applySpeed));

        const onUpdate = (state: PlaybackState): void => {
            if (state === PlaybackState.Playing && eventId) ListenedVoiceMessages.mark(eventId);
        };
        playback.on(UPDATE_EVENT, onUpdate);
        this.detach.push(() => playback.off(UPDATE_EVENT, onUpdate));

        const client = MatrixClientPeg.get();
        const room = client?.getRoom(mxEvent.getRoomId());
        const sender = mxEvent.sender?.name ?? mxEvent.getSender() ?? "";
        this.detach.push(
            attachMediaSession(playback, _t("timeline|voice_message|from", { name: sender }), room?.name ?? ""),
        );
    }

    public componentWillUnmount(): void {
        this.detach.forEach((undo) => undo());
        this.detach = [];
        const playback = this.state.playback;
        if (playback && isVoiceMessage(this.props.mxEvent)) {
            // The queue outlives this tile; what it is not told to drop it holds for the session.
            PlaybackQueue.dequeue(this.props.mxEvent.getRoomId()!, this.props.mxEvent, playback);
        }
        super.componentWillUnmount();
    }

    // A voice message is an audio file but rendered in a special way.
    public render(): React.ReactNode {
        if (this.state.error) {
            return (
                <MediaProcessingError className="mx_MVoiceMessageBody">
                    {_t("timeline|m.audio|error_processing_voice_message")}
                </MediaProcessingError>
            );
        }

        if (!this.state.playback) {
            return (
                <span className="mx_MVoiceMessageBody">
                    <InlineSpinner />
                </span>
            );
        }

        // At this point we should have a playable state
        return (
            <span className="mx_MVoiceMessageBody">
                <VoiceMessagePlayer playback={this.state.playback} mxEvent={this.props.mxEvent} />
                {/* Fork: what it said, under it, the way Telegram shows a transcript. */}
                {!this.props.forExport && <TgTranscript mxEvent={this.props.mxEvent} />}
                {this.showFileBody && renderMBody({ ...this.props, showFileInfo: false }, FileBodyFactory)}
            </span>
        );
    }
}
