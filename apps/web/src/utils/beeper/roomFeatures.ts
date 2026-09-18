/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../languageHandler";
import { formatBytes } from "../FormattingUtils";

/**
 * State event (state_key = bridge id) in which mautrix bridges describe what the remote network
 * supports. Types follow mautrix-go event/capabilities.d.ts.
 */
export const ROOM_FEATURES_EVENT_TYPE = "com.beeper.room_features";

/** -2 rejected, -1 dropped, 0 unsupported (may have a fallback), 1 partial, 2 full. Allowed if > 0. */
export type CapabilitySupportLevel = -2 | -1 | 0 | 1 | 2;

export interface FileFeatures {
    mime_types?: Record<string, CapabilitySupportLevel>;
    caption?: CapabilitySupportLevel;
    max_caption_length?: number;
    max_size?: number;
    max_width?: number;
    max_height?: number;
    max_duration?: number;
}

export interface RoomFeatures {
    formatting?: Record<string, CapabilitySupportLevel>;
    file?: Record<string, FileFeatures>;
    max_text_length?: number;
    reply?: CapabilitySupportLevel;
    thread?: CapabilitySupportLevel;
    edit?: CapabilitySupportLevel;
    edit_max_count?: number;
    /** Seconds. */
    edit_max_age?: number;
    delete?: CapabilitySupportLevel;
    /** Seconds. */
    delete_max_age?: number;
    reaction?: CapabilitySupportLevel;
    reaction_count?: number;
    allowed_reactions?: string[];
    custom_emoji_reactions?: boolean;
}

/** The FormattingFeature names used in room_features.formatting. */
export type FormattingFeature =
    | "bold"
    | "italic"
    | "strikethrough"
    | "inline_code"
    | "code_block"
    | "blockquote"
    | "inline_link";

const allowed = (level: CapabilitySupportLevel | undefined): boolean => (level ?? 0) > 0;

/** The room's bridge capabilities, or undefined for rooms without a bridge that publishes them. */
export function getRoomFeatures(room: Room | null | undefined): RoomFeatures | undefined {
    if (!room) return undefined;
    const events = room.currentState.getStateEvents(ROOM_FEATURES_EVENT_TYPE);
    const ev = events.find((e) => Object.keys(e.getContent()).length > 0);
    return ev?.getContent() as RoomFeatures | undefined;
}

/** A human-readable name for the remote network, from the m.bridge state event. */
export function getBridgeNetworkName(room: Room): string {
    for (const type of ["m.bridge", "uk.half-shot.bridge"]) {
        for (const ev of room.currentState.getStateEvents(type)) {
            const protocol = ev.getContent().protocol;
            const name = protocol?.displayname || protocol?.id;
            if (typeof name === "string" && name) return name;
        }
    }
    return _t("beeper|send_status_remote_network");
}

/**
 * Why our own message can't be edited on the remote network, or undefined if it can (or the room
 * doesn't restrict it).
 */
export function editBlockedReason(mxEvent: MatrixEvent, room: Room | null, now = Date.now()): string | undefined {
    const features = getRoomFeatures(room);
    if (!features || !room) return undefined;
    const network = getBridgeNetworkName(room);
    if (!allowed(features.edit)) return _t("beeper|features_edit_unsupported", { network });
    if (features.edit_max_age && now - mxEvent.getTs() > features.edit_max_age * 1000) {
        return _t("beeper|features_edit_too_old", { network });
    }
    if (features.edit_max_count) {
        const edits = room.relations
            .getChildEventsForEvent(mxEvent.getId()!, "m.replace", mxEvent.getType())
            ?.getRelations()
            .filter((e) => e.getSender() === mxEvent.getSender()).length;
        if ((edits ?? 0) >= features.edit_max_count) return _t("beeper|features_edit_too_many", { network });
    }
    return undefined;
}

/**
 * Why our own message can't be deleted for everyone on the remote network, or undefined if it can.
 * Only our own messages are affected: the bridge can't delete other people's remote messages anyway.
 */
export function deleteBlockedReason(mxEvent: MatrixEvent, room: Room | null, now = Date.now()): string | undefined {
    const features = getRoomFeatures(room);
    if (!features || !room || mxEvent.getSender() !== room.client.getUserId()) return undefined;
    if (mxEvent.isState() || mxEvent.getType() === "m.reaction") return undefined;
    const network = getBridgeNetworkName(room);
    if (!allowed(features.delete)) return _t("beeper|features_delete_unsupported", { network });
    if (features.delete_max_age && now - mxEvent.getTs() > features.delete_max_age * 1000) {
        return _t("beeper|features_delete_too_old", { network });
    }
    return undefined;
}

/** Why reactions can't be sent at all in this room, or undefined if they can. */
export function reactionsBlockedReason(room: Room | null): string | undefined {
    const features = getRoomFeatures(room);
    if (!features || !room) return undefined;
    return allowed(features.reaction)
        ? undefined
        : _t("beeper|features_reactions_unsupported", { network: getBridgeNetworkName(room) });
}

/** Whether a specific reaction key may be sent in this room. */
export function isReactionAllowed(room: Room | null, key: string): boolean {
    const features = getRoomFeatures(room);
    if (!features) return true;
    if (!allowed(features.reaction)) return false;
    if (key.startsWith("mxc://")) return !!features.custom_emoji_reactions;
    if (!features.allowed_reactions) return true;
    const strip = (s: string): string => s.replace(/\uFE0F/g, "");
    return features.allowed_reactions.some((r) => strip(r) === strip(key));
}

/** Explanation shown in the reaction picker when the network limits reactions, if it does. */
export function reactionsLimitNotice(room: Room | null): string | undefined {
    const features = getRoomFeatures(room);
    if (!features?.allowed_reactions || !room) return undefined;
    return _t("beeper|features_reactions_limited", {
        network: getBridgeNetworkName(room),
        count: features.allowed_reactions.length,
    });
}

/** Why a formatting feature isn't available, or undefined if it is. */
export function formattingBlockedReason(room: Room | null, feature: FormattingFeature): string | undefined {
    const features = getRoomFeatures(room);
    if (!features || !room) return undefined;
    return allowed(features.formatting?.[feature])
        ? undefined
        : _t("beeper|features_formatting_unsupported", { network: getBridgeNetworkName(room) });
}

/** Composer formatting actions (MessageComposerFormatBar's Formatting values) mapped to features. */
const COMPOSER_FORMATTING: Record<string, FormattingFeature> = {
    bold: "bold",
    italics: "italic",
    strikethrough: "strikethrough",
    code: "inline_code",
    quote: "blockquote",
    insert_link: "inline_link",
};

/** For each composer formatting action the room can't carry, the reason (for a tooltip). */
export function formattingDisabledReasons(room: Room | null): Record<string, string> {
    const reasons: Record<string, string> = {};
    for (const [action, feature] of Object.entries(COMPOSER_FORMATTING)) {
        const reason = formattingBlockedReason(room, feature);
        if (reason) reasons[action] = reason;
    }
    return reasons;
}

/** The capability message type a file would be sent as. */
function fileCapabilityType(file: File): string {
    const mime = file.type || "application/octet-stream";
    if (mime === "image/gif") return "fi.mau.gif";
    if (mime.startsWith("image/")) return "m.image";
    if (mime.startsWith("video/")) return "m.video";
    if (mime.startsWith("audio/")) return "m.audio";
    return "m.file";
}

function mimeSupport(features: FileFeatures, mime: string): CapabilitySupportLevel {
    const types = features.mime_types ?? {};
    const plain = mime.split(";")[0].trim();
    const general = `${plain.split("/")[0]}/*`;
    return types[mime] ?? types[plain] ?? types[general] ?? types["*/*"] ?? -2;
}

/** Why the remote network will reject this file, or undefined if it (probably) won't. */
export function fileBlockedReason(room: Room | null, file: File): string | undefined {
    const features = getRoomFeatures(room);
    if (!features || !room) return undefined;
    const network = getBridgeNetworkName(room);
    const type = fileCapabilityType(file);
    // GIFs fall back to plain images on networks without a dedicated GIF type.
    const fileFeatures = features.file?.[type] ?? (type === "fi.mau.gif" ? features.file?.["m.image"] : undefined);
    if (!fileFeatures || mimeSupport(fileFeatures, file.type || "application/octet-stream") <= -2) {
        return _t("beeper|features_file_type_unsupported", { network, type: file.type || file.name });
    }
    if (fileFeatures.max_size && file.size > fileFeatures.max_size) {
        return _t("beeper|features_file_too_large", { network, max: formatBytes(fileFeatures.max_size) });
    }
    return undefined;
}
