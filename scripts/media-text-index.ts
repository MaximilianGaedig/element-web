#!/usr/bin/env node
/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The careful pass over a chat's history: reads every picture, transcribes every voice message, and
 * tells the server what they say, so all of it can be searched for.
 *
 * A device does this for what is on screen, as it goes (utils/detect/ocr.ts, TgLiveText). What a device
 * cannot do is years of history: that is thousands of pictures, and a phone should not be asked to warm
 * itself for an afternoon. So this reads the lot from anywhere that can reach the server, and sends its
 * readings to the same endpoint the device uses. The server asks nothing of either: `missing` says what
 * has not been read, so the two never do the same work twice, and `im.mxg.media_text` takes the answer.
 *
 * WHERE TO RUN IT. Anywhere with the token, including the homeserver itself - but it has to be told how
 * much of the machine it may have, because the answer differs by two orders of magnitude:
 *
 *   a desktop           --gap 0                    engine ~300 MB, a picture in well under a second
 *   the homeserver      --pictures-only --gap 2000  one picture at a time with a pause between, so the
 *                                                  people talking through it never notice
 *
 * Transcribing is what does not fit on a small server: whisper wants most of a gigabyte to itself, which
 * on a box with a gigabyte in total is the box. It is therefore off unless whisper-cpp, ffmpeg and
 * WHISPER_MODEL are all there, and can be kept off with --pictures-only.
 *
 * Needs, on PATH:
 *   whisper-cpp and ffmpeg, for voice messages - `nix shell nixpkgs#whisper-cpp nixpkgs#ffmpeg`
 * Pictures need nothing: the engine is this app's own, from node_modules.
 *
 *   MATRIX_TOKEN=… node scripts/media-text-index.ts --server https://matrix.example --room '!a:b'
 *
 * With no --room it works through every room the account is in. It can be stopped and started: what it
 * has done is on the server.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createWorker } from "tesseract.js";

const run = promisify(execFile);

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
    const name = process.argv[index];
    if (!name.startsWith("--")) continue;
    const value = process.argv[index + 1];
    // A flag with no value of its own - "--pictures-only" - is simply present.
    const isFlag = value === undefined || value.startsWith("--");
    args.set(name.slice(2), isFlag ? "" : value);
    if (!isFlag) index++;
}

const SERVER = args.get("server") ?? process.env.MATRIX_SERVER;
const TOKEN = process.env.MATRIX_TOKEN;
const ONLY_ROOM = args.get("room");
const LIMIT = Number(args.get("limit") ?? 500);
/** How long to wait between items, for a machine that has other things to do. */
const GAP = Number(args.get("gap") ?? 0);
/** Pictures only: transcribing is what a small server cannot afford. */
const PICTURES_ONLY = args.has("pictures-only");
/** Media bigger than this is left to a machine with more room (megabytes). */
const MAX_MB = Number(args.get("max-mb") ?? 50);

if (!SERVER || !TOKEN) {
    console.error("Set MATRIX_TOKEN and pass --server https://matrix.example (or MATRIX_SERVER).");
    process.exit(2);
}

/** Below this the engine is reading texture rather than letters - the same bar the app uses. */
const MIN_CONFIDENCE = 40;

/** What is asked of the server, and what comes back, in the shapes it uses. */
async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetch(`${SERVER}${url}`, {
        method,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
}

const UNSTABLE = "/_matrix/client/unstable";
const CLIENT = "/_matrix/client/v3";

/** Every room the account is in, or the one that was asked for. */
async function rooms(): Promise<string[]> {
    if (ONLY_ROOM) return [ONLY_ROOM];
    const { joined_rooms: joined } = await api<{ joined_rooms: string[] }>("GET", `${CLIENT}/joined_rooms`);
    return joined;
}

/** The events of one kind whose media nothing has read yet. */
async function missing(room: string, media: string, kind: string): Promise<string[]> {
    const found: string[] = [];
    let from: string | undefined;
    do {
        const query = new URLSearchParams({ media, kind, limit: "100", ...(from ? { from } : {}) });
        const page = await api<{ event_ids: string[]; end?: string }>(
            "GET",
            `${UNSTABLE}/im.mxg.media_text/rooms/${encodeURIComponent(room)}/missing?${query}`,
        );
        found.push(...page.event_ids);
        from = page.end;
    } while (from && found.length < LIMIT);
    return found.slice(0, LIMIT);
}

async function event(room: string, eventId: string): Promise<{ content: Record<string, any> }> {
    return api("GET", `${CLIENT}/rooms/${encodeURIComponent(room)}/event/${encodeURIComponent(eventId)}`);
}

/** The bytes of a piece of media, by the URL the event carries. */
async function download(mxc: string): Promise<Buffer> {
    const [, serverName, mediaId] = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc) ?? [];
    if (!serverName) throw new Error(`not a media URL: ${mxc}`);
    const response = await fetch(`${SERVER}${CLIENT}/media/download/${serverName}/${mediaId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!response.ok) throw new Error(`download ${mxc}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

async function store(room: string, eventId: string, kind: string, text: string): Promise<void> {
    await api(
        "POST",
        `${UNSTABLE}/im.mxg.media_text/rooms/${encodeURIComponent(room)}/${encodeURIComponent(eventId)}`,
        {
            kind,
            text,
        },
    );
}

/*
 * One engine for the whole run: starting it is most of the cost of a short read, and there are
 * thousands of short reads here.
 */
const engine = await createWorker(["eng", "pol", "deu"], undefined, { logger: () => {} });

/** What a picture says, or nothing where it says nothing worth keeping. */
async function readPicture(bytes: Buffer): Promise<string> {
    const { data } = await engine.recognize(bytes, undefined, { text: true });
    const text = data.text.trim();
    return text && data.confidence >= MIN_CONFIDENCE ? text : "";
}

/** What a voice message says, through whisper. */
async function transcribe(bytes: Buffer, extension: string): Promise<string> {
    const work = await mkdtemp(path.join(tmpdir(), "media-text-"));
    try {
        const input = path.join(work, `audio${extension}`);
        const wav = path.join(work, "audio.wav");
        await writeFile(input, bytes);
        // Whisper wants 16 kHz mono, and a voice message is whatever the phone that sent it felt like.
        await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", wav]);
        await run("whisper-cpp", ["-m", model(), "-f", wav, "-otxt", "-of", path.join(work, "out"), "-nt"]);
        return (await readFile(path.join(work, "out.txt"), "utf8")).trim();
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

/** Whisper's model file: whichever one the machine running this has. */
function model(): string {
    const named = process.env.WHISPER_MODEL;
    if (!named) throw new Error("Set WHISPER_MODEL to a whisper.cpp model file (e.g. ggml-base.bin).");
    return named;
}

/** Whether this machine can transcribe at all, asked once rather than per voice message. */
async function canTranscribe(): Promise<boolean> {
    if (!process.env.WHISPER_MODEL) return false;
    try {
        await run("whisper-cpp", ["--help"]);
        await run("ffmpeg", ["-version"]);
        return true;
    } catch {
        return false;
    }
}

const transcribing = !PICTURES_ONLY && (await canTranscribe());
if (!transcribing) {
    console.log(
        PICTURES_ONLY ? "Pictures only, as asked." : "No whisper-cpp, ffmpeg or WHISPER_MODEL: pictures only.",
    );
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One room, one kind of media at a time. */
async function work(room: string): Promise<void> {
    const jobs: Array<[media: string, kind: string, read: (bytes: Buffer, ext: string) => Promise<string>]> = [
        ["media", "ocr", (bytes) => readPicture(bytes)],
        ...(transcribing
            ? ([["voice", "transcript", transcribe]] as Array<
                  [string, string, (bytes: Buffer, ext: string) => Promise<string>]
              >)
            : []),
    ];

    for (const [media, kind, read] of jobs) {
        let events: string[];
        try {
            events = await missing(room, media, kind);
        } catch (error) {
            // An encrypted room, or one this account cannot see: nothing to do here.
            console.log(`${room}: ${media}/${kind} unavailable (${(error as Error).message.slice(0, 80)})`);
            continue;
        }
        if (!events.length) continue;
        console.log(`${room}: ${events.length} ${media} to read`);

        for (const eventId of events) {
            try {
                const { content } = await event(room, eventId);
                const url = content.url ?? content.file?.url;
                // No URL means an encrypted file, which this cannot read and the server could not index.
                if (typeof url !== "string") continue;
                const bytes = await download(url);
                if (bytes.length > MAX_MB * 1024 * 1024) {
                    console.log(`  ${eventId}: ${Math.round(bytes.length / 1e6)} MB, left for a bigger machine`);
                    continue;
                }
                const extension = path.extname(String(content.body ?? "")) || ".ogg";
                const text = await read(bytes, extension);
                // Empty is worth storing: it is how "this picture says nothing" stops being read again.
                await store(room, eventId, kind, text);
                if (text) console.log(`  ${eventId}: ${text.replaceAll("\n", " ").slice(0, 70)}`);
                if (GAP) await pause(GAP);
            } catch (error) {
                console.warn(`  ${eventId}: ${(error as Error).message.slice(0, 120)}`);
            }
        }
    }
}

for (const room of await rooms()) {
    await work(room);
}

await engine.terminate();
