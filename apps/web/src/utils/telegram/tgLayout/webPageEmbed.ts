/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The player a video link's preview plays in, as Telegram's `webPage.embed_url` gives tweb one.
 *
 * A Matrix preview carries no player: the homeserver keeps a page's `og:video` only when it is a video
 * file, and YouTube's is a player page (`og:video:type` text/html). So the player is worked out from the
 * link, for the sites whose embed address follows from their watch address. Nothing else is framed: an
 * arbitrary page's player URL would put that page inside the client.
 */

const YOUTUBE_ID = /^[\w-]{11}$/;

function youtubeId(url: URL): string | undefined {
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id: string | undefined;
    if (host === "youtu.be") {
        id = url.pathname.slice(1).split("/")[0];
    } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (url.pathname === "/watch") id = url.searchParams.get("v") ?? undefined;
        else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1];
    }
    return id && YOUTUBE_ID.test(id) ? id : undefined;
}

/** `t=1m30s`, `t=90s` or `t=90` as seconds. */
function startSeconds(value: string | null): number | undefined {
    if (!value) return undefined;
    const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (!match || !match[0]) return undefined;
    const [, h = "0", m = "0", s = "0"] = match;
    const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
    return seconds > 0 ? seconds : undefined;
}

/** The address of the player for `link`, started playing, or undefined if it isn't a video we can embed. */
export function videoEmbedUrl(link: string): string | undefined {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

    const youtube = youtubeId(url);
    if (youtube) {
        const embed = new URL(`https://www.youtube-nocookie.com/embed/${youtube}`);
        embed.searchParams.set("autoplay", "1");
        const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
        if (start) embed.searchParams.set("start", String(start));
        return embed.toString();
    }

    const host = url.hostname.replace(/^www\./, "");
    const vimeo = host === "vimeo.com" ? url.pathname.match(/^\/(\d+)\/?$/)?.[1] : undefined;
    if (vimeo) return `https://player.vimeo.com/video/${vimeo}?autoplay=1`;

    return undefined;
}
