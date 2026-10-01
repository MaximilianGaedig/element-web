/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { secureRandomString } from "matrix-js-sdk/src/randomstring";

/**
 * The album marker of an outgoing media event (`fi.mau.album`, see MediaAlbum.ts for the reading side).
 * All three are set and `index`/`count` are integers: event content may never hold a float.
 */
export interface OutgoingAlbumMarker {
    id: string;
    /** Position within the album, 0-based and dense: the events of one album carry 0..count-1. */
    index: number;
    /** How many events carry this album id. */
    count: number;
}

/** Whether a file is sent as a picture or a video, the only things that make up an album. */
export function isAlbumCandidate(file: File): boolean {
    return file.type.startsWith("image/") || file.type.startsWith("video/");
}

type MemberState = "uploading" | "ready" | "left";

/** One file's seat in an {@link OutgoingMediaAlbum}. */
export class OutgoingAlbumMember {
    private state: MemberState = "uploading";
    private stillWanted: () => boolean = () => true;
    private readonly deferred = Promise.withResolvers<OutgoingAlbumMarker | undefined>();

    /**
     * What to stamp on this file's event, or undefined to send it as an ordinary lone message. Settles only
     * once every file of the album has finished uploading (or dropped out), so the count is the real one.
     */
    public readonly marker: Promise<OutgoingAlbumMarker | undefined> = this.deferred.promise;

    public constructor(private readonly album: OutgoingMediaAlbum) {}

    /**
     * The file is uploaded and about to be sent as a picture or a video.
     * @param stillWanted - asked when the album is counted; false if the upload was cancelled meanwhile
     */
    public ready(stillWanted: () => boolean = () => true): void {
        if (this.state !== "uploading") return;
        this.state = "ready";
        this.stillWanted = stillWanted;
        this.album.onMemberSettled();
    }

    /** The file will not be part of the album: its upload failed or was cancelled, or it is sent as a plain file. */
    public leave(): void {
        if (this.state === "left" || this.album.isCounted) return;
        this.state = "left";
        this.album.onMemberSettled();
    }

    /** @internal */
    public get isSettled(): boolean {
        return this.state !== "uploading";
    }

    /** @internal */
    public get isIn(): boolean {
        return this.state === "ready" && this.stillWanted();
    }

    /** @internal */
    public resolve(marker: OutgoingAlbumMarker | undefined): void {
        this.deferred.resolve(marker);
    }
}

/**
 * Pictures and videos sent together, which bridges (and our own timeline) should treat as one album.
 *
 * The marker of each event needs the album's final size, which is not known when the first upload starts:
 * the user may still be confirming the other files, and any upload may fail or be cancelled. So the events
 * of an album are held back until the album is sealed (no more files will join) and each file has either
 * finished uploading or dropped out. Only then are the survivors numbered 0..count-1 in the order they were
 * added. Fewer than two survivors is no album: they are sent without a marker.
 */
export class OutgoingMediaAlbum {
    public readonly id = secureRandomString(16);
    private readonly members: OutgoingAlbumMember[] = [];
    private sealed = false;
    private counted = false;

    /** How many files have joined so far. */
    public get size(): number {
        return this.members.length;
    }

    /** Whether the markers have been handed out; nothing changes after that. */
    public get isCounted(): boolean {
        return this.counted;
    }

    /** Adds the next file of the album. */
    public join(): OutgoingAlbumMember {
        if (this.sealed) throw new Error("This album is sealed");
        const member = new OutgoingAlbumMember(this);
        this.members.push(member);
        return member;
    }

    /** No more files will join. */
    public seal(): void {
        this.sealed = true;
        this.onMemberSettled();
    }

    /** @internal */
    public onMemberSettled(): void {
        if (this.counted || !this.sealed || !this.members.every((m) => m.isSettled)) return;
        this.counted = true;
        const survivors = this.members.filter((m) => m.isIn);
        const isAlbum = survivors.length >= 2;
        for (const member of this.members) {
            const index = survivors.indexOf(member);
            member.resolve(isAlbum && index >= 0 ? { id: this.id, index, count: survivors.length } : undefined);
        }
    }
}
