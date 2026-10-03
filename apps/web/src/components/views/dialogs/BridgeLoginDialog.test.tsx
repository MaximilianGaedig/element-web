/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import BridgeLoginDialog from "./BridgeLoginDialog";
import * as loginFlow from "../../../utils/bridge/loginFlow";
import { type LoginStep } from "../../../utils/bridge/loginFlow";

vi.mock("../elements/QRCode", () => ({
    default: ({ data }: { data: string }) => <div data-testid="qr">{data}</div>,
}));

const API = "https://bridge.example/_matrix/provision";
const PHONE: LoginStep = {
    login_id: "proc",
    type: "user_input",
    step_id: "phone",
    instructions: "Enter your phone number",
    user_input: { fields: [{ type: "phone_number", id: "phone", name: "Phone number", pattern: "^\\+[0-9]+$" }] },
};
const QR: LoginStep = {
    login_id: "proc",
    type: "display_and_wait",
    step_id: "qr",
    instructions: "Scan this with your phone",
    display_and_wait: { type: "qr", data: "qr-payload" },
};
const DONE: LoginStep = { login_id: "proc", type: "complete", step_id: "done", complete: { user_login_id: "123" } };

describe("<BridgeLoginDialog />", () => {
    const onFinished = vi.fn();
    const onOpenChat = vi.fn();
    const flows = vi.spyOn(loginFlow, "loginFlows");
    const start = vi.spyOn(loginFlow, "startLogin");
    const submit = vi.spyOn(loginFlow, "submitLoginStep");
    const cancel = vi.spyOn(loginFlow, "cancelLogin");

    beforeEach(() => {
        vi.clearAllMocks();
        cancel.mockResolvedValue();
    });

    // As Modal shows it: in a root of its own, outside the app's client context.
    const open = (again?: string) => {
        stubClient();
        return render(
            <BridgeLoginDialog
                network="Telegram"
                provisioningUrl={API}
                again={again}
                onOpenChat={onOpenChat}
                onFinished={onFinished}
            />,
        );
    };

    it("asks the bridge as the signed-in user, though a dialog is outside the app's client context", async () => {
        flows.mockResolvedValue([{ id: "qr", name: "QR code", description: "" }]);
        start.mockResolvedValue(DONE);
        open();

        await waitFor(() => expect(flows).toHaveBeenCalled());
        expect(flows.mock.calls[0][0]).toBe(MatrixClientPeg.safeGet());
    });

    it("offers the bridge's ways to sign in, and walks the one chosen to the end", async () => {
        flows.mockResolvedValue([
            { id: "phone", name: "Phone number" },
            { id: "qr", name: "QR code", description: "Scan from another device" },
        ]);
        start.mockResolvedValue(PHONE);
        submit.mockResolvedValueOnce(DONE);
        open();

        await userEvent.click(await screen.findByRole("button", { name: /Phone number/ }));
        expect(start).toHaveBeenCalledWith(expect.anything(), API, "phone", undefined);
        expect(await screen.findByText("Enter your phone number")).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText("Phone number"), "+48600");
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(submit).toHaveBeenCalledWith(expect.anything(), API, PHONE, { phone: "+48600" });
        expect(await screen.findByText(/Connected/)).toBeInTheDocument();
        // Finished: nothing for the bridge to stop waiting on when the dialog goes
        await userEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(onFinished).toHaveBeenCalled();
    });

    it("starts the only way there is without asking, on the login being signed back in to", async () => {
        flows.mockResolvedValue([{ id: "qr", name: "QR" }]);
        start.mockResolvedValue(QR);
        submit.mockReturnValue(new Promise(() => {})); // the phone has not scanned yet
        open("existing-login");

        expect(await screen.findByTestId("qr")).toHaveTextContent("qr-payload");
        expect(start).toHaveBeenCalledWith(expect.anything(), API, "qr", "existing-login");
        expect(screen.getByText("Scan this with your phone")).toBeInTheDocument();
        // It waits by itself: the request is the waiting
        expect(submit).toHaveBeenCalledWith(expect.anything(), API, QR, {}, expect.anything());
    });

    it("moves on by itself once the phone has scanned", async () => {
        flows.mockResolvedValue([{ id: "qr", name: "QR" }]);
        start.mockResolvedValue(QR);
        submit.mockResolvedValueOnce(DONE);
        open();

        expect(await screen.findByText(/Connected/)).toBeInTheDocument();
    });

    it("does not send what the bridge's own pattern rules out", async () => {
        flows.mockResolvedValue([{ id: "phone", name: "Phone number" }]);
        start.mockResolvedValue(PHONE);
        open();

        await userEvent.type(await screen.findByLabelText("Phone number"), "600");
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(submit).not.toHaveBeenCalled();
    });

    it("keeps the step, with what the bridge said, when the bridge refuses the answer", async () => {
        flows.mockResolvedValue([{ id: "phone", name: "Phone number" }]);
        start.mockResolvedValue(PHONE);
        submit.mockRejectedValueOnce(new Error("That number is not on Telegram"));
        open();

        await userEvent.type(await screen.findByLabelText("Phone number"), "+48600");
        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("That number is not on Telegram");
        expect(screen.getByLabelText("Phone number")).toHaveValue("+48600");
    });

    it("sends a sign-in that needs the network's own site to the bridge's chat", async () => {
        flows.mockResolvedValue([{ id: "web", name: "Browser" }]);
        start.mockResolvedValue({ login_id: "proc", type: "cookies", step_id: "cookies" });
        open();

        await userEvent.click(await screen.findByRole("button", { name: "Open bridge chat" }));

        expect(onOpenChat).toHaveBeenCalled();
        expect(onFinished).toHaveBeenCalled();
    });

    it("tells the bridge to stop waiting when closed part-way", async () => {
        flows.mockResolvedValue([{ id: "phone", name: "Phone number" }]);
        start.mockResolvedValue(PHONE);
        const { unmount } = open();
        await screen.findByLabelText("Phone number");

        unmount();

        await waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.anything(), API, PHONE));
    });

    it("says what the bridge said when it cannot be asked at all", async () => {
        flows.mockRejectedValue(new Error("502 from the bridge"));
        open();

        expect(await screen.findByRole("alert")).toHaveTextContent("502 from the bridge");
    });
});
