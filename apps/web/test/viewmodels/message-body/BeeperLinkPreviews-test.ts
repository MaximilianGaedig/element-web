/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { expect } from "@jest/globals";

import type { MockedObject } from "jest-mock";
import type { MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { UrlPreviewGroupViewModel } from "../../../src/viewmodels/message-body/UrlPreviewGroupViewModel";
import { getMockClientWithEventEmitter, mkEvent } from "../../test-utils";
import SettingsStore from "../../../src/settings/SettingsStore";
import { findBundledLinkPreview, mergeBundledLinks } from "../../../src/utils/beeper/linkPreviews";
import * as DecryptFile from "../../../src/utils/DecryptFile";

const BUNDLED = {
    "matched_url": "https://t.me/example",
    "og:url": "https://t.me/example/",
    "og:title": "Example channel",
    "og:description": "Bundled by the bridge",
    "og:image": "mxc://example.org/img",
    "og:image:width": 400,
    "og:image:height": 200,
};

function mkMsg(content: Record<string, unknown>, encrypted = false): MatrixEvent {
    const ev = mkEvent({
        event: true,
        user: "@telegram_1:example.org",
        room: "!portal:example.org",
        type: "m.room.message",
        content: { msgtype: "m.text", body: "look https://t.me/example", ...content },
        id: "$id",
    });
    if (encrypted) jest.spyOn(ev, "isEncrypted").mockReturnValue(true);
    return ev;
}

function getVm(
    mxEvent: MatrixEvent,
    visible = true,
): { vm: UrlPreviewGroupViewModel; client: MockedObject<MatrixClient> } {
    const client = getMockClientWithEventEmitter({
        getUrlPreview: jest.fn().mockResolvedValue({ "og:title": "Fetched from homeserver" }),
        mxcUrlToHttp: jest.fn().mockImplementation((mxc: string) => `https://hs/${mxc}`),
    });
    const vm = new UrlPreviewGroupViewModel({
        client,
        mediaVisible: true,
        visible,
        onImageClicked: jest.fn(),
        mxEvent,
    });
    return { vm, client };
}

function bodyWith(html: string): HTMLDivElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
}

describe("Beeper bundled link previews", () => {
    afterEach(() => jest.restoreAllMocks());

    it("matches previews by matched_url or og:url, ignoring a trailing slash", () => {
        const ev = mkMsg({ "com.beeper.linkpreviews": [BUNDLED] });
        expect(findBundledLinkPreview(ev, "https://t.me/example")).toBe(BUNDLED);
        expect(findBundledLinkPreview(ev, "https://t.me/example/")).toBe(BUNDLED);
        expect(findBundledLinkPreview(ev, "https://other.example")).toBeUndefined();
        expect(mergeBundledLinks(ev, ["https://a.example/x"])).toEqual(["https://a.example/x", "https://t.me/example"]);
    });

    it("uses the bundled preview instead of asking the homeserver", async () => {
        const ev = mkMsg({ "com.beeper.linkpreviews": [BUNDLED] });
        const { vm, client } = getVm(ev);
        await vm.updateEventElement(bodyWith('look <a href="https://t.me/example">https://t.me/example</a>'));

        expect(client.getUrlPreview).not.toHaveBeenCalled();
        const [preview] = vm.getSnapshot().previews;
        expect(preview.title).toBe("Example channel");
        expect(preview.description).toBe("Bundled by the bridge");
        expect(preview.image?.imageThumb).toContain("mxc://example.org/img");
    });

    it("still fetches links that have no bundled preview", async () => {
        const ev = mkMsg({ "com.beeper.linkpreviews": [BUNDLED] });
        const { vm, client } = getVm(ev);
        await vm.updateEventElement(
            bodyWith('<a href="https://t.me/example">https://t.me/example</a> <a href="https://b.example/p">b/p</a>'),
        );
        expect(client.getUrlPreview).toHaveBeenCalledTimes(1);
        expect(client.getUrlPreview).toHaveBeenCalledWith("https://b.example/p", expect.any(Number));
        expect(vm.getSnapshot().previews.map((p) => p.title)).toEqual(["Example channel", "Fetched from homeserver"]);
    });

    it("shows only bundled previews in encrypted rooms where fetching is off", async () => {
        jest.spyOn(SettingsStore, "getValue").mockImplementation((name) => name === "urlPreviewsEnabled");
        const ev = mkMsg({ "com.beeper.linkpreviews": [BUNDLED] }, true);
        const { vm, client } = getVm(ev, false);
        await vm.updateEventElement(
            bodyWith('<a href="https://t.me/example">https://t.me/example</a> <a href="https://b.example/p">b/p</a>'),
        );
        expect(client.getUrlPreview).not.toHaveBeenCalled();
        expect(vm.getSnapshot().previews.map((p) => p.title)).toEqual(["Example channel"]);
    });

    it("shows nothing when previews are off in an unencrypted room", async () => {
        const ev = mkMsg({ "com.beeper.linkpreviews": [BUNDLED] });
        const { vm } = getVm(ev, false);
        await vm.updateEventElement(bodyWith('<a href="https://t.me/example">https://t.me/example</a>'));
        expect(vm.getSnapshot().previews).toEqual([]);
    });

    it("decrypts encrypted bundled images", async () => {
        const decrypt = jest.spyOn(DecryptFile, "decryptFile").mockResolvedValue(new Blob(["png"]));
        const encrypted = { ...BUNDLED, "og:image": undefined, "beeper:image:encryption": { url: "mxc://e/f" } };
        const ev = mkMsg({ "com.beeper.linkpreviews": [encrypted] });
        const { vm } = getVm(ev);
        await vm.updateEventElement(bodyWith('<a href="https://t.me/example">https://t.me/example</a>'));
        expect(decrypt).toHaveBeenCalled();
        expect(vm.getSnapshot().previews[0].image?.imageThumb).toBe("blob");
    });
});
