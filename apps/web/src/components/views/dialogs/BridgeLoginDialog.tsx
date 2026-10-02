/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useRef, useState } from "react";

import { _t } from "../../../languageHandler";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import Field from "../elements/Field";
import QRCode from "../elements/QRCode";
import Spinner from "../elements/Spinner";
import {
    canDoStep,
    cancelLogin,
    initialValues,
    invalidFields,
    type LoginField,
    type LoginFlow,
    loginFlows,
    type LoginStep,
    startLogin,
    submitLoginStep,
} from "../../../utils/bridge/loginFlow";

interface Props {
    /** The network, as the bridge names it. */
    network: string;
    provisioningUrl: string;
    /** The login being signed back in to; without it, an account is added. */
    again?: string;
    /** Opens the bridge's chat, for a sign-in that cannot be done from here. */
    onOpenChat: () => void;
    onFinished: () => void;
}

/** What kind of box a field gets. The bridge's types are hints; anything else is plain text. */
const INPUT_TYPE: Record<string, string> = {
    password: "password",
    phone_number: "tel",
    email: "email",
    url: "url",
};

/**
 * Signs in to a network through its bridge, a step at a time, with whatever the bridge asks for at each:
 * something to type, or something to scan while it waits.
 */
export default function BridgeLoginDialog({
    network,
    provisioningUrl,
    again,
    onOpenChat,
    onFinished,
}: Props): JSX.Element {
    const client = useContext(MatrixClientContext);
    const [flows, setFlows] = useState<LoginFlow[] | null>(null);
    const [step, setStep] = useState<LoginStep | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [invalid, setInvalid] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The step the bridge is waiting on, for telling it when the dialog is closed part-way.
    const openStep = useRef<LoginStep | null>(null);
    openStep.current = step && step.type !== "complete" ? step : null;
    useEffect(
        () => () => {
            if (openStep.current) void cancelLogin(client, provisioningUrl, openStep.current);
        },
        [client, provisioningUrl],
    );

    const show = useCallback((next: LoginStep): void => {
        setStep(next);
        setValues(initialValues(next.user_input?.fields ?? []));
        setInvalid([]);
        setError(null);
    }, []);

    const start = useCallback(
        async (flow: LoginFlow): Promise<void> => {
            setBusy(true);
            setError(null);
            try {
                show(await startLogin(client, provisioningUrl, flow.id, again));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [client, provisioningUrl, again, show],
    );

    // The ways to sign in. One way is no choice: it starts.
    useEffect(() => {
        const abort = new AbortController();
        loginFlows(client, provisioningUrl, abort.signal)
            .then((found) => {
                setFlows(found);
                if (found.length === 1) void start(found[0]);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
            });
        return () => abort.abort();
    }, [client, provisioningUrl, start]);

    // A step that shows something waits by itself: the request is answered when the phone has done its part.
    useEffect(() => {
        if (step?.type !== "display_and_wait") return;
        const abort = new AbortController();
        submitLoginStep(client, provisioningUrl, step, {}, abort.signal)
            .then(show)
            .catch((e) => {
                if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
            });
        return () => abort.abort();
    }, [client, provisioningUrl, step, show]);

    const submit = async (): Promise<void> => {
        if (!step?.user_input) return;
        const wrong = invalidFields(step.user_input.fields, values);
        setInvalid(wrong);
        if (wrong.length) return;
        setBusy(true);
        setError(null);
        try {
            show(await submitLoginStep(client, provisioningUrl, step, values));
        } catch (e) {
            // The step stands: a wrong code is typed again, not started over.
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const startOver = (): void => {
        if (openStep.current) void cancelLogin(client, provisioningUrl, openStep.current);
        setStep(null);
        setError(null);
        if (flows?.length === 1) void start(flows[0]);
    };

    const field = (spec: LoginField): JSX.Element => {
        const common = {
            label: spec.name,
            value: values[spec.id] ?? "",
            disabled: busy,
            forceValidity: invalid.includes(spec.id) ? false : undefined,
            tooltipContent: invalid.includes(spec.id) ? _t("tg_layout|bridge_login_invalid") : undefined,
            onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void =>
                setValues((current) => ({ ...current, [spec.id]: ev.target.value })),
        };
        return (
            <div key={spec.id} className="mx_BridgeLoginDialog_field">
                {spec.type === "select" && spec.options?.length ? (
                    <Field {...common} element="select">
                        <option value="" disabled hidden>
                            {spec.name}
                        </option>
                        {spec.options.map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </Field>
                ) : (
                    <Field
                        {...common}
                        type={INPUT_TYPE[spec.type] ?? "text"}
                        inputMode={spec.type === "2fa_code" ? "numeric" : undefined}
                        autoComplete={spec.type === "2fa_code" ? "one-time-code" : "off"}
                    />
                )}
                {spec.description && <p className="mx_BridgeLoginDialog_hint">{spec.description}</p>}
            </div>
        );
    };

    let body: JSX.Element;
    let buttons: JSX.Element | null = null;
    if (step?.type === "complete") {
        body = <p>{_t("tg_layout|bridge_login_done", { network })}</p>;
        buttons = (
            <DialogButtons primaryButton={_t("action|done")} onPrimaryButtonClick={onFinished} hasCancel={false} />
        );
    } else if (step && !canDoStep(step)) {
        body = <p>{_t("tg_layout|bridge_login_unsupported", { network })}</p>;
        buttons = (
            <DialogButtons
                primaryButton={_t("tg_layout|bridge_open_chat")}
                onPrimaryButtonClick={(): void => {
                    onFinished();
                    onOpenChat();
                }}
                cancelButton={flows && flows.length > 1 ? _t("tg_layout|bridge_login_other_way") : undefined}
                onCancel={flows && flows.length > 1 ? startOver : onFinished}
            />
        );
    } else if (step?.type === "user_input") {
        body = (
            <form
                onSubmit={(ev): void => {
                    ev.preventDefault();
                    void submit();
                }}
            >
                {step.instructions && <p>{step.instructions}</p>}
                {(step.user_input?.fields ?? []).map(field)}
                <DialogButtons
                    primaryButton={_t("action|continue")}
                    primaryIsSubmit
                    primaryDisabled={busy}
                    onPrimaryButtonClick={(): void => {}}
                    onCancel={onFinished}
                />
            </form>
        );
    } else if (step?.type === "display_and_wait") {
        const shown = step.display_and_wait;
        body = (
            <div className="mx_BridgeLoginDialog_show">
                {step.instructions && <p>{step.instructions}</p>}
                {shown?.type === "qr" && shown.data && (
                    <QRCode data={shown.data} className="mx_BridgeLoginDialog_qr" width={240} />
                )}
                {(shown?.type === "code" || shown?.type === "emoji") && shown.data && (
                    <output className={`mx_BridgeLoginDialog_code mx_BridgeLoginDialog_code--${shown.type}`}>
                        {shown.data}
                    </output>
                )}
                <p className="mx_BridgeLoginDialog_hint" role="status">
                    {_t("tg_layout|bridge_login_waiting", { network })}
                </p>
            </div>
        );
        buttons = (
            <DialogButtons primaryButton={_t("action|cancel")} onPrimaryButtonClick={onFinished} hasCancel={false} />
        );
    } else if (flows && flows.length !== 1 && !busy) {
        body = flows.length ? (
            <div className="mx_BridgeLoginDialog_flows">
                <p>{_t("tg_layout|bridge_login_choose")}</p>
                {flows.map((flow) => (
                    <button
                        key={flow.id}
                        type="button"
                        className="mx_BridgeLoginDialog_flow"
                        onClick={(): void => void start(flow)}
                    >
                        <span className="mx_BridgeLoginDialog_flowName">{flow.name}</span>
                        {flow.description && <span className="mx_BridgeLoginDialog_hint">{flow.description}</span>}
                    </button>
                ))}
            </div>
        ) : (
            <p>{_t("tg_layout|bridge_login_unsupported", { network })}</p>
        );
    } else {
        body = error ? <></> : <Spinner />;
    }

    return (
        <BaseDialog
            className="mx_BridgeLoginDialog"
            title={_t("tg_layout|bridge_login_title", { network })}
            onFinished={onFinished}
            fixedWidth
        >
            {body}
            {error && (
                <p className="mx_BridgeLoginDialog_error" role="alert">
                    {_t("tg_layout|bridge_login_failed", { error })}
                </p>
            )}
            {buttons}
        </BaseDialog>
    );
}
