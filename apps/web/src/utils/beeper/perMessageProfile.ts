/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type IContent, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Content key for Beeper per-message profiles (MSC4144-style), used by mautrix bridges in
 * relay mode to say "this message was really sent by <displayname>" while the Matrix sender
 * is the relay user or bridge bot.
 */
export const PER_MESSAGE_PROFILE_KEY = "com.beeper.per_message_profile";

export interface PerMessageProfile {
    /** Opaque per-sender identifier, stable across messages from the same remote sender. */
    id: string;
    displayname?: string;
    avatar_url?: string;
    /** Set when the bridge prefixed `Displayname: ` to body/formatted_body as a fallback. */
    has_fallback?: boolean;
}

function parseProfile(raw: unknown): PerMessageProfile | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const obj = raw as Record<string, unknown>;
    const profile: PerMessageProfile = { id: typeof obj.id === "string" ? obj.id : "" };
    if (typeof obj.displayname === "string" && obj.displayname) profile.displayname = obj.displayname;
    if (typeof obj.avatar_url === "string" && obj.avatar_url.startsWith("mxc://")) profile.avatar_url = obj.avatar_url;
    if (obj.has_fallback === true) profile.has_fallback = true;
    if (!profile.displayname && !profile.avatar_url) return undefined;
    return profile;
}

/**
 * Returns the per-message profile of an event, or undefined if it has none (or the one it has
 * carries nothing we can render). Edits keep the profile of the original event.
 */
export function getPerMessageProfile(mxEvent: MatrixEvent | undefined | null): PerMessageProfile | undefined {
    if (!mxEvent) return undefined;
    return (
        parseProfile(mxEvent.getOriginalContent()?.[PER_MESSAGE_PROFILE_KEY]) ??
        parseProfile(mxEvent.getContent()?.[PER_MESSAGE_PROFILE_KEY])
    );
}

// Same pattern mautrix-go uses to remove the fallback (event.HTMLProfileFallbackRegex).
const HTML_FALLBACK_RE = /<strong\s+data-mx-profile-fallback(?:="")?\s*>([^<]+): <\/strong\s*>/g;

/**
 * Removes the `Displayname: ` prefix bridges add for clients that don't understand per-message
 * profiles. Returns the content unchanged (same object) when there is nothing to strip.
 */
export function stripPerMessageProfileFallback(content: IContent): IContent {
    const profile = parseProfile(content?.[PER_MESSAGE_PROFILE_KEY]);
    if (!profile?.has_fallback || !profile.displayname) return content;
    const prefix = `${profile.displayname}: `;
    const stripped: IContent = { ...content };
    if (typeof content.body === "string" && content.body.startsWith(prefix)) {
        stripped.body = content.body.slice(prefix.length);
    }
    if (typeof content.formatted_body === "string") {
        stripped.formatted_body = content.formatted_body.replace(HTML_FALLBACK_RE, "");
    }
    return stripped;
}
