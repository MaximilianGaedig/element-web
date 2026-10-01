/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";

import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { MediaEventHelper } from "./MediaEventHelper.ts";
import { cacheUploadedMedia, clearUploadedMediaCache } from "./UploadedMediaCache.ts";
import * as DecryptFile from "./DecryptFile.ts";

describe("MediaEventHelper", () => {
    it("should set the mime type on the blob based on the event metadata", async () => {
        stubClient();

        const event = new MatrixEvent({
            type: "m.room.message",
            content: {
                msgtype: "m.image",
                body: "image.png",
                info: {
                    mimetype: "image/png",
                    size: 1234,
                    w: 100,
                    h: 100,
                    thumbnail_info: {
                        mimetype: "image/png",
                    },
                    thumbnail_url: "mxc://matrix.org/thumbnail",
                },
                url: "mxc://matrix.org/abcdef",
            },
        });
        const helper = new MediaEventHelper(event);

        const blob = await helper.thumbnailBlob.value;
        expect(blob?.type).toBe(event.getContent().info.thumbnail_info?.mimetype);
    });

    describe("object URLs", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("leaves none behind when tiles go away while their media is still decrypting", async () => {
            // Scrolling through an encrypted chat: each tile asks for its picture, and is gone before
            // the decryption finishes. An object URL made after that has nobody left to revoke it, and
            // an unrevoked URL keeps the whole decrypted file in memory until the page is closed.
            stubClient();
            let made = 0;
            const outstanding = new Set<string>();
            vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
                const url = `blob:test/${made++}`;
                outstanding.add(url);
                return url;
            });
            vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void outstanding.delete(url));
            const decrypting = Promise.withResolvers<Blob>();
            vi.spyOn(DecryptFile, "decryptFile").mockReturnValue(decrypting.promise);

            const asked: Promise<unknown>[] = [];
            for (let i = 0; i < 200; i++) {
                const helper = new MediaEventHelper(
                    new MatrixEvent({
                        type: "m.room.message",
                        content: {
                            msgtype: "m.image",
                            body: "image.png",
                            info: { thumbnail_file: { url: `mxc://matrix.org/thumb${i}` } },
                            file: { url: `mxc://matrix.org/source${i}` },
                        },
                    }),
                );
                asked.push(helper.sourceUrl.value, helper.thumbnailUrl.value);
                helper.destroy();
            }
            decrypting.resolve(new Blob(["decrypted"]));
            await Promise.all(asked);

            expect(outstanding.size).toBe(0);
        });

        it("still revokes the URLs of a tile that goes away after its media arrived", async () => {
            stubClient();
            const outstanding = new Set<string>();
            let made = 0;
            vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
                const url = `blob:test/${made++}`;
                outstanding.add(url);
                return url;
            });
            vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void outstanding.delete(url));
            vi.spyOn(DecryptFile, "decryptFile").mockResolvedValue(new Blob(["decrypted"]));
            const helper = new MediaEventHelper(
                new MatrixEvent({
                    type: "m.room.message",
                    content: {
                        msgtype: "m.image",
                        body: "image.png",
                        info: { thumbnail_file: { url: "mxc://matrix.org/thumb" } },
                        file: { url: "mxc://matrix.org/source" },
                    },
                }),
            );

            expect(await helper.sourceUrl.value).toMatch(/^blob:/);
            expect(await helper.thumbnailUrl.value).toMatch(/^blob:/);
            expect(outstanding.size).toBe(2);
            helper.destroy();

            expect(outstanding.size).toBe(0);
        });
    });

    describe("for media this client uploaded", () => {
        const uploaded = new Blob(["uploaded bytes"], { type: "image/png" });
        const thumbnail = new Blob(["thumbnail bytes"], { type: "image/jpeg" });

        afterEach(() => {
            clearUploadedMediaCache();
            vi.restoreAllMocks();
        });

        it("serves an encrypted source and thumbnail from memory instead of downloading and decrypting", async () => {
            stubClient();
            const decrypt = vi.spyOn(DecryptFile, "decryptFile");
            cacheUploadedMedia("mxc://matrix.org/source", uploaded);
            cacheUploadedMedia("mxc://matrix.org/thumbnail", thumbnail);
            const event = new MatrixEvent({
                type: "m.room.message",
                content: {
                    msgtype: "m.image",
                    body: "image.png",
                    info: {
                        mimetype: "image/png",
                        thumbnail_info: { mimetype: "image/jpeg" },
                        thumbnail_file: { url: "mxc://matrix.org/thumbnail" },
                    },
                    file: { url: "mxc://matrix.org/source" },
                },
            });
            const helper = new MediaEventHelper(event);

            expect(helper.isFromLocalUpload).toBe(true);
            await expect((await helper.sourceBlob.value).text()).resolves.toBe("uploaded bytes");
            await expect((await helper.thumbnailBlob.value)!.text()).resolves.toBe("thumbnail bytes");
            expect(decrypt).not.toHaveBeenCalled();
        });

        it("hands out an object URL for an unencrypted upload and revokes it on destroy", async () => {
            stubClient();
            const revoke = vi.spyOn(URL, "revokeObjectURL");
            cacheUploadedMedia("mxc://matrix.org/source", uploaded);
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { msgtype: "m.image", body: "image.png", url: "mxc://matrix.org/source" },
            });
            const helper = new MediaEventHelper(event);

            const url = await helper.sourceUrl.value;
            expect(url).toMatch(/^blob:/);
            expect(url).not.toBe(helper.media.srcHttp);
            helper.destroy();
            expect(revoke).toHaveBeenCalledWith(url);
        });

        it("still uses the server for media someone else uploaded", async () => {
            stubClient();
            const event = new MatrixEvent({
                type: "m.room.message",
                content: { msgtype: "m.image", body: "image.png", url: "mxc://matrix.org/other" },
            });
            const helper = new MediaEventHelper(event);

            expect(helper.isFromLocalUpload).toBe(false);
            await expect(helper.sourceUrl.value).resolves.toBe(helper.media.srcHttp);
        });
    });
});
