/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "vitest-canvas-mock";
import {
    type ISendEventResponse,
    type MatrixClient,
    MatrixError,
    RelationType,
    Room,
    type UploadResponse,
} from "matrix-js-sdk/src/matrix";
import { type ImageInfo } from "matrix-js-sdk/src/types";
import encrypt, { type IEncryptedFile } from "matrix-encrypt-attachment";
import { createTestClient, flushPromises, mkEvent } from "test-utils";

import ContentMessages, { UploadCanceledError, uploadFile } from "./ContentMessages";
import { clearUploadedMediaCache, queryUploadedMediaCache } from "./utils/UploadedMediaCache";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { BlurhashEncoder } from "./BlurhashEncoder";
import Modal from "./Modal";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import { _t } from "./languageHandler";
import { PosthogAnalytics } from "./PosthogAnalytics";

vi.mock("matrix-encrypt-attachment", () => ({ default: { encryptAttachment: vi.fn().mockResolvedValue({}) } }));

vi.mock("./BlurhashEncoder", () => ({
    BlurhashEncoder: {
        instance: {
            getBlurhash: vi.fn(),
        },
    },
}));

vi.mock("./utils/local-room", () => ({
    doMaybeLocalRoomAction: vi.fn(),
}));

const createElement = document.createElement.bind(document);

vi.stubGlobal("OffscreenCanvas", undefined);

describe("ContentMessages", () => {
    const stickerUrl = "https://example.com/sticker";
    const roomId = "!room:example.com";
    const imageInfo = {} as unknown as ImageInfo;
    const text = "test sticker";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let prom: Promise<ISendEventResponse>;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        prom = Promise.resolve<ISendEventResponse>({ event_id: "$event_id" });
    });

    describe("sendStickerContentToRoom", () => {
        beforeEach(() => {
            vi.mocked(client.sendStickerMessage).mockReturnValue(prom);
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>, client?: MatrixClient) => {
                    return fn(roomId);
                },
            );
        });

        it("should forward the call to doMaybeLocalRoomAction", async () => {
            await contentMessages.sendStickerContentToRoom(stickerUrl, roomId, null, imageInfo, text, client);
            expect(client.sendStickerMessage).toHaveBeenCalledWith(roomId, null, stickerUrl, imageInfo, text);
        });
    });

    describe("sendContentToRoom", () => {
        const roomId = "!roomId:server";
        beforeEach(() => {
            Object.defineProperty(global.Image.prototype, "src", {
                // Define the property setter
                configurable: true,
                set(src) {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(global.Image.prototype, "height", {
                configurable: true,
                get() {
                    return 600;
                },
            });
            Object.defineProperty(global.Image.prototype, "width", {
                configurable: true,
                get() {
                    return 800;
                },
            });
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
        });

        it("should use m.image for image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should use m.image for PNG files which cannot be parsed but successfully thumbnail", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/png" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should fall back to m.file for invalid image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockRejectedValue("NOT_AN_IMAGE");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should use m.video for video files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "video") {
                    (<HTMLVideoElement>element).load = vi.fn();
                    (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                    (<HTMLVideoElement>element).pause = vi.fn();
                    Object.defineProperty(element, "videoHeight", {
                        get() {
                            return 600;
                        },
                    });
                    Object.defineProperty(element, "videoWidth", {
                        get() {
                            return 800;
                        },
                    });
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 123;
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "video/mp4" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.video",
                    info: expect.objectContaining({
                        duration: 123000,
                    }),
                }),
            );
        });

        describe("round video notes", () => {
            beforeEach(() => {
                vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                    const element = createElement(tagName);
                    if (tagName === "video") {
                        (<HTMLVideoElement>element).load = vi.fn();
                        (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                        (<HTMLVideoElement>element).pause = vi.fn();
                        Object.defineProperty(element, "videoHeight", { get: () => 384 });
                        Object.defineProperty(element, "videoWidth", { get: () => 384 });
                        Object.defineProperty(element, "duration", { get: () => 12 });
                    }
                    return element;
                });
                vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            });

            afterEach(() => {
                vi.mocked(document.createElement).mockRestore();
            });

            const sentInfo = (): Record<string, unknown> =>
                (vi.mocked(client.sendMessage).mock.calls[0][2] as any).info;

            it("marks a video sent as a round video note", async () => {
                const file = new File([], "note.mp4", { type: "video/mp4" });
                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined, undefined, {
                    roundVideo: true,
                });

                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({ msgtype: "m.video" }),
                );
                expect(sentInfo()["fi.mau.telegram.round_message"]).toBe(true);
            });

            it("does not mark an ordinary video", async () => {
                const file = new File([], "clip.mp4", { type: "video/mp4" });
                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);

                expect(sentInfo()).not.toHaveProperty("fi.mau.telegram.round_message");
            });

            it("does not mark something that is not a video", async () => {
                const file = new File([], "photo.jpg", { type: "image/jpeg" });
                await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined, undefined, {
                    roundVideo: true,
                });

                expect(client.sendMessage).toHaveBeenCalledWith(
                    roomId,
                    null,
                    expect.objectContaining({ msgtype: "m.image" }),
                );
                expect(sentInfo()).not.toHaveProperty("fi.mau.telegram.round_message");
            });
        });

        it("should use m.audio for audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 621;
                        },
                    });
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onloadedmetadata!(new Event("loadedmetadata"));
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.audio",
                    info: expect.objectContaining({
                        duration: 621000,
                    }),
                }),
            );
        });

        it("should fall back to m.file for invalid audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onerror!("fail");
                        },
                    });
                }
                return element;
            });
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should default to name 'Attachment' if file doesn't have a name", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                    body: "Attachment",
                }),
            );
        });

        it("should keep RoomUpload's total and loaded values up to date", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            const prom = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            const [upload] = contentMessages.getCurrentUploads();

            expect(upload.loaded).toBe(0);
            expect(upload.total).toBe(file.size);
            await flushPromises();
            const { progressHandler } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            progressHandler!({ loaded: 123, total: 1234 });
            expect(upload.loaded).toBe(123);
            expect(upload.total).toBe(1234);
            await prom;
        });

        it("properly handles replies", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            const replyToEvent = mkEvent({
                type: "m.room.message",
                user: "@bob:test",
                room: roomId,
                content: {},
                event: true,
            });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, replyToEvent);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    "url": "mxc://server/file",
                    "msgtype": "m.image",
                    "m.mentions": {
                        user_ids: ["@bob:test"],
                    },
                }),
            );
        });

        it("handles 413 error", async () => {
            vi.mocked(client.uploadContent).mockRejectedValue(
                new MatrixError(
                    {
                        errcode: "M_TOO_LARGE",
                        error: "File size limit exceeded",
                    },
                    413,
                ),
            );
            const file = new File([], "fileName", { type: "image/jpeg" });
            const dialogSpy = vi.spyOn(Modal, "createDialog");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(dialogSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    description: _t("upload_failed_size", { fileName: "fileName" }),
                }),
            );
            dialogSpy.mockRestore();
        });
    });

    describe("getCurrentUploads", () => {
        const file1 = new File([], "file1");
        const file2 = new File([], "file2");
        const roomId = "!roomId:server";

        beforeEach(() => {
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
        });

        it("should return only uploads for the given relation", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads(relation);
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(relation);
            expect(uploads[0].fileName).toEqual("file1");
            await Promise.all([p1, p2]);
        });

        it("should return only uploads for no relation when not passed one", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads();
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(undefined);
            expect(uploads[0].fileName).toEqual("file2");
            await Promise.all([p1, p2]);
        });
    });

    describe("cancelUpload", () => {
        it("should cancel in-flight upload", async () => {
            const deferred = Promise.withResolvers<UploadResponse>();
            vi.mocked(client.uploadContent).mockReturnValue(deferred.promise);
            const file1 = new File([], "file1");
            const prom = contentMessages.sendContentToRoom(file1, roomId, undefined, client, undefined);
            await flushPromises();
            const { abortController } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            expect(abortController!.signal.aborted).toBeFalsy();
            const [upload] = contentMessages.getCurrentUploads();
            contentMessages.cancelUpload(upload);
            expect(abortController!.signal.aborted).toBeTruthy();
            deferred.resolve({} as UploadResponse);
            await prom;
        });
    });
});

describe("uploadFile", () => {
    let client: MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
    });

    it("should not encrypt the file if the room isn't encrypted", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const progressHandler = vi.fn();
        const file = new Blob([]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBe("mxc://server/file");
        expect(res.file).toBeFalsy();
        expect(encrypt.encryptAttachment).not.toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ progressHandler }));
    });

    it("should encrypt the file if the room is encrypted", async () => {
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const progressHandler = vi.fn();
        const file = new Blob(["123"]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBeFalsy();
        expect(res.file).toEqual(
            expect.objectContaining({
                url: "mxc://server/file",
            }),
        );
        expect(encrypt.encryptAttachment).toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(
            expect.any(Blob),
            expect.objectContaining({
                progressHandler,
                includeFilename: false,
                type: "application/octet-stream",
            }),
        );
        expect(vi.mocked(client.uploadContent).mock.calls[0][0]).not.toBe(file);
    });

    it("should keep the uploaded file so it does not have to be downloaded again", async () => {
        clearUploadedMediaCache();
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/plain" });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/plain")).toBe(file);
    });

    it("should keep the plaintext of an encrypted upload rather than the ciphertext", async () => {
        clearUploadedMediaCache();
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/encrypted" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/encrypted")).toBe(file);
    });

    it("should throw UploadCanceledError upon aborting the upload", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://foo/bar" });
        const file = new Blob([]);
        const controller = new AbortController();
        controller.abort();

        await expect(uploadFile(client, "!roomId:server", file, undefined, controller)).rejects.toThrow(
            UploadCanceledError,
        );
    });
});

describe("sendContentListToRoom analytics", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let trackEvent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(contentMessages, "sendContentToRoom").mockResolvedValue(undefined);
        trackEvent = vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        // Automatically continue through the per-file confirmation dialog.
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown, ...rest: any[]) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([true, false]) } as any;
            }
            // Any other dialog (e.g. the fetching-media-config spinner) never resolves on its own.
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mkFile(type: string, name = "file"): File {
        return new File(["content"], name, { type });
    }

    it("tracks AttachmentSend with the most common file type when files are sent", async () => {
        const files = [mkFile("image/png", "a.png"), mkFile("image/jpeg", "b.jpg"), mkFile("video/mp4", "c.mp4")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                count: 3,
                kind: "local",
                type: "image",
            }),
        );
    });

    it("marks the attachment as a reply and in-thread when applicable", async () => {
        const replyToEvent = { getId: () => "$event" } as any;
        const relation = { rel_type: "m.thread" } as any;
        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, relation, replyToEvent, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                isReply: true,
                inThread: true,
            }),
        );
    });

    it("tracks AttachmentCancel when the user cancels at the confirmation dialog", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([false, false]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });

        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentCancel",
                kind: "local",
                stage: "Confirmation",
            }),
        );
        expect(contentMessages.sendContentToRoom).not.toHaveBeenCalled();
    });
});

describe("sendContentListToRoom albums", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    /** What the user answers in each confirmation dialog, in order; "all" once everything is confirmed. */
    let answers: Array<"upload" | "all" | "cancel">;

    beforeEach(() => {
        // Let every picture load and thumbnail.
        Object.defineProperty(global.Image.prototype, "src", {
            configurable: true,
            set() {
                window.setTimeout(() => this.onload());
            },
        });
        Object.defineProperty(global.Image.prototype, "height", { configurable: true, get: () => 600 });
        Object.defineProperty(global.Image.prototype, "width", { configurable: true, get: () => 800 });
        vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");

        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(client.uploadContent).mockImplementation(async (file) => ({
            content_uri: `mxc://server/${(file as File).name}`,
        }));
        vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$sent" });
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        answers = ["all"];
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                const answer = answers.shift() ?? "upload";
                return { finished: Promise.resolve([answer !== "cancel", answer === "all"]) } as any;
            }
            // Any other dialog (the upload error) is simply left open.
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const image = (name: string): File => new File(["content"], name, { type: "image/jpeg" });

    /** The content of every event sent so far, in the order it was sent. */
    const sent = (): Record<string, any>[] => vi.mocked(client.sendMessage).mock.calls.map((call) => call[2] as any);

    async function send(files: File[]): Promise<void> {
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);
        // sendContentListToRoom returns once everything is queued; wait for the uploads and sends.
        await vi.waitFor(() => expect(contentMessages.getCurrentUploads()).toHaveLength(0));
    }

    it("stamps pictures sent together with one album id, their position and the count", async () => {
        await send([image("a.jpg"), image("b.jpg"), image("c.jpg")]);

        const albums = sent().map((content) => content["fi.mau.album"]);
        expect(sent().map((content) => content.body)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
        expect(albums.map((album) => album.index)).toEqual([0, 1, 2]);
        expect(albums.map((album) => album.count)).toEqual([3, 3, 3]);
        expect(albums[0].id).toEqual(expect.any(String));
        expect(albums[0].id).not.toBe("");
        expect(new Set(albums.map((album) => album.id)).size).toBe(1);
        // Event content may not hold floats: the homeserver rejects the event.
        for (const album of albums) {
            expect(Object.keys(album).sort()).toEqual(["count", "id", "index"]);
            expect(Number.isInteger(album.index)).toBe(true);
            expect(Number.isInteger(album.count)).toBe(true);
        }
    });

    it("gives two batches different album ids", async () => {
        await send([image("a.jpg"), image("b.jpg")]);
        answers = ["all"];
        await send([image("c.jpg"), image("d.jpg")]);

        const ids = sent().map((content) => content["fi.mau.album"].id);
        expect(ids[0]).toBe(ids[1]);
        expect(ids[2]).toBe(ids[3]);
        expect(ids[0]).not.toBe(ids[2]);
    });

    it("does not stamp a picture sent on its own", async () => {
        await send([image("a.jpg")]);

        expect(sent()).toHaveLength(1);
        expect(sent()[0]).not.toHaveProperty("fi.mau.album");
    });

    it("leaves a document out of the album it was sent along with", async () => {
        await send([image("a.jpg"), new File(["text"], "notes.txt", { type: "text/plain" }), image("b.jpg")]);

        expect(sent().map((content) => [content.body, content.msgtype])).toEqual([
            ["a.jpg", "m.image"],
            ["notes.txt", "m.file"],
            ["b.jpg", "m.image"],
        ]);
        expect(sent()[0]["fi.mau.album"]).toEqual({ id: expect.any(String), index: 0, count: 2 });
        expect(sent()[1]).not.toHaveProperty("fi.mau.album");
        expect(sent()[2]["fi.mau.album"]).toEqual({ id: sent()[0]["fi.mau.album"].id, index: 1, count: 2 });
    });

    it("does not make an album of a picture and a document", async () => {
        await send([image("a.jpg"), new File(["text"], "notes.txt", { type: "text/plain" })]);

        expect(sent()).toHaveLength(2);
        expect(sent()[0]).not.toHaveProperty("fi.mau.album");
        expect(sent()[1]).not.toHaveProperty("fi.mau.album");
    });

    it("counts only the uploads that made it", async () => {
        vi.mocked(client.uploadContent).mockImplementation(async (file) => {
            if ((file as File).name === "b.jpg") throw new Error("upload failed");
            return { content_uri: `mxc://server/${(file as File).name}` };
        });
        await send([image("a.jpg"), image("b.jpg"), image("c.jpg")]);

        expect(sent().map((content) => content.body)).toEqual(["a.jpg", "c.jpg"]);
        expect(sent()[0]["fi.mau.album"]).toEqual({ id: expect.any(String), index: 0, count: 2 });
        expect(sent()[1]["fi.mau.album"]).toEqual({ id: sent()[0]["fi.mau.album"].id, index: 1, count: 2 });
    });

    it("sends the one upload that made it without a marker", async () => {
        vi.mocked(client.uploadContent).mockImplementation(async (file) => {
            if ((file as File).name === "b.jpg") throw new Error("upload failed");
            return { content_uri: `mxc://server/${(file as File).name}` };
        });
        await send([image("a.jpg"), image("b.jpg")]);

        expect(sent()).toHaveLength(1);
        expect(sent()[0]).not.toHaveProperty("fi.mau.album");
    });

    it("leaves out an upload cancelled while the others are still going", async () => {
        const slow = Promise.withResolvers<UploadResponse>();
        vi.mocked(client.uploadContent).mockImplementation(async (file) => {
            if ((file as File).name === "c.jpg") return slow.promise;
            return { content_uri: `mxc://server/${(file as File).name}` };
        });
        await contentMessages.sendContentListToRoom(
            [image("a.jpg"), image("b.jpg"), image("c.jpg")],
            roomId,
            undefined,
            undefined,
            client,
        );
        await vi.waitFor(() => expect(client.uploadContent).toHaveBeenCalledTimes(3));
        await flushPromises();
        // Nothing is sent while the album is still uploading: its size is not known yet.
        expect(client.sendMessage).not.toHaveBeenCalled();

        const cancelled = contentMessages.getCurrentUploads().find((upload) => upload.fileName === "b.jpg")!;
        contentMessages.cancelUpload(cancelled);
        slow.resolve({ content_uri: "mxc://server/c.jpg" });
        await vi.waitFor(() => expect(contentMessages.getCurrentUploads()).toHaveLength(0));

        expect(sent().map((content) => content.body)).toEqual(["a.jpg", "c.jpg"]);
        expect(sent().map((content) => content["fi.mau.album"].index)).toEqual([0, 1]);
        expect(sent().map((content) => content["fi.mau.album"].count)).toEqual([2, 2]);
    });

    it("counts only the files the user confirmed", async () => {
        answers = ["upload", "upload", "cancel"];
        await send([image("a.jpg"), image("b.jpg"), image("c.jpg")]);

        expect(sent().map((content) => content.body)).toEqual(["a.jpg", "b.jpg"]);
        expect(sent().map((content) => content["fi.mau.album"].count)).toEqual([2, 2]);
    });

    it("sends the only confirmed file without a marker", async () => {
        answers = ["upload", "cancel"];
        await send([image("a.jpg"), image("b.jpg")]);

        expect(sent()).toHaveLength(1);
        expect(sent()[0]).not.toHaveProperty("fi.mau.album");
    });

    it("starts a new album after ten items", async () => {
        await send(Array.from({ length: 12 }, (_, i) => image(`${i}.jpg`)));

        const albums = sent().map((content) => content["fi.mau.album"]);
        expect(albums.map((album) => album.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
        expect(albums.map((album) => album.count)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 2, 2]);
        expect(new Set(albums.slice(0, 10).map((album) => album.id)).size).toBe(1);
        expect(albums[10].id).toBe(albums[11].id);
        expect(albums[10].id).not.toBe(albums[0].id);
    });
});

describe("sendContentListToRoom view once", () => {
    const roomId = "!roomId:server";
    const VIEW_ONCE = { type: "count", count: 1 };
    let client: MatrixClient;
    let room: Room;
    let contentMessages: ContentMessages;
    /** What the confirmation dialog answers, and the props it was last shown with. */
    let answer: unknown[];
    let dialogProps: Record<string, unknown>[];

    const bridgeTo = (file: Record<string, unknown>): void => {
        room.currentState.setStateEvents([
            mkEvent({
                event: true,
                type: "m.bridge",
                skey: "whatsapp",
                room: roomId,
                user: "@bot:x",
                content: { protocol: { id: "whatsapp", displayname: "WhatsApp" } },
            }),
            mkEvent({
                event: true,
                type: "com.beeper.room_features",
                skey: "whatsapp",
                room: roomId,
                user: "@bot:x",
                content: { file },
            }),
        ]);
    };

    beforeEach(() => {
        Object.defineProperty(global.Image.prototype, "src", {
            configurable: true,
            set() {
                window.setTimeout(() => this.onload());
            },
        });
        Object.defineProperty(global.Image.prototype, "height", { configurable: true, get: () => 600 });
        Object.defineProperty(global.Image.prototype, "width", { configurable: true, get: () => 800 });
        vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");

        client = createTestClient();
        room = new Room(roomId, client, client.getSafeUserId());
        vi.mocked(client.getRoom).mockReturnValue(room);
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$sent" });
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        answer = [true, false, { viewOnce: true }];
        dialogProps = [];
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown, props: any) => {
            if (component === UploadConfirmDialog) {
                dialogProps.push(props);
                return { finished: Promise.resolve(answer) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const image = (name: string): File => new File(["content"], name, { type: "image/jpeg" });
    const sent = (): Record<string, any>[] => vi.mocked(client.sendMessage).mock.calls.map((call) => call[2] as any);

    async function send(files: File[]): Promise<void> {
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);
        await vi.waitFor(() => expect(contentMessages.getCurrentUploads()).toHaveLength(0));
    }

    it("offers view once where the bridge takes it, and marks the event when chosen", async () => {
        bridgeTo({ "m.image": { mime_types: { "image/*": 2 }, view_limited_types: [VIEW_ONCE] } });
        await send([image("a.jpg")]);

        expect(dialogProps[0].viewOnceNetwork).toBe("WhatsApp");
        expect(sent()).toHaveLength(1);
        expect(sent()[0]["com.beeper.view_limited"]).toEqual(VIEW_ONCE);
        expect(sent()[0].msgtype).toBe("m.image");
    });

    it("sends an ordinary picture when view once is left off", async () => {
        bridgeTo({ "m.image": { mime_types: { "image/*": 2 }, view_limited_types: [VIEW_ONCE] } });
        answer = [true, false, { viewOnce: false }];
        await send([image("a.jpg")]);

        expect(sent()[0]).not.toHaveProperty("com.beeper.view_limited");
    });

    it("does not offer view once in a room whose bridge does not declare it", async () => {
        bridgeTo({ "m.image": { mime_types: { "image/*": 2 } } });
        await send([image("a.jpg")]);

        expect(dialogProps[0].viewOnceNetwork).toBeUndefined();
        expect(sent()[0]).not.toHaveProperty("com.beeper.view_limited");
    });

    it("does not offer view once in a plain Matrix room", async () => {
        await send([image("a.jpg")]);

        expect(dialogProps[0].viewOnceNetwork).toBeUndefined();
        expect(sent()[0]).not.toHaveProperty("com.beeper.view_limited");
    });

    it("does not offer view once for several files at once", async () => {
        bridgeTo({ "m.image": { mime_types: { "image/*": 2 }, view_limited_types: [VIEW_ONCE] } });
        await send([image("a.jpg"), image("b.jpg")]);

        expect(dialogProps.map((props) => props.viewOnceNetwork)).toEqual([undefined, undefined]);
        expect(sent()).toHaveLength(2);
        for (const content of sent()) expect(content).not.toHaveProperty("com.beeper.view_limited");
    });

    it("marks a file sent directly as view once", async () => {
        await contentMessages.sendContentToRoom(image("a.jpg"), roomId, undefined, client, undefined, undefined, {
            viewOnce: true,
        });

        expect(sent()[0]["com.beeper.view_limited"]).toEqual(VIEW_ONCE);
    });
});
