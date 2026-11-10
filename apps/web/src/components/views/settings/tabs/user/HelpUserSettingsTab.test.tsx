/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render } from "test-utils-rtl";
import { describe, it, expect, afterEach } from "vitest";

import HelpUserSettingsTab from "./HelpUserSettingsTab";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import SdkConfig from "../../../../../SdkConfig";
import { stubClient } from "test-utils";

describe("HelpUserSettingsTab", () => {
    afterEach(() => {
        SdkConfig.reset();
    });

    function renderTab(): ReturnType<typeof render> {
        const client = stubClient();
        // The tab shows the crypto version; the stub's crypto has none.
        client.getCrypto = () => undefined;
        return render(
            <MatrixClientContext.Provider value={client}>
                <HelpUserSettingsTab />
            </MatrixClientContext.Provider>,
        );
    }

    it.each([
        ["with a bug report endpoint", "https://example.org/submit"],
        ["without a bug report endpoint", undefined],
    ])("offers the debug logs toggle, off by default, %s", (_, url) => {
        SdkConfig.put({ bug_report_endpoint_url: url });
        const { getByRole } = renderTab();
        const toggle = getByRole("switch", { name: "Keep debug logs" });
        expect(toggle).not.toBeChecked();
    });
});
