/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useState } from "react";
import { Button, HelpMessage, InlineField, Label, ToggleControl } from "@vector-im/compound-web";

import { _t } from "../../../../../languageHandler";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import {
    type DeclaredControl,
    type DeclaredSettings,
    requestSetting,
} from "../../../../../utils/bridge/declaredSettings";

/*
 * The controls a bridge says it offers, drawn from its own declaration.
 *
 * One loop over a list, deliberately: the label and the type travel with each control, so a bridge
 * adding one costs nothing here. That is the whole point of the shape - the alternative is a switch
 * over networks in the client, which means every new control needs a release of Element.
 *
 * Nothing is kept. A change is a request, and the acknowledgement is the bridge rewriting its own
 * state event, which arrives as a normal sync and re-renders this. So there is no local value to go
 * stale and no spinner to get stuck: the control shows what the bridge last said.
 */
export function DeclaredSettingsControls({ declaration }: { declaration: DeclaredSettings }): JSX.Element | null {
    const client = useContext(MatrixClientContext);
    // Only to say what went wrong. Success needs no state: the state event changing is the answer.
    const [failed, setFailed] = useState<string | undefined>();

    if (!declaration.settings.length) return null;

    const ask = (control: DeclaredControl, value: unknown): void => {
        setFailed(undefined);
        void requestSetting(client, declaration, control, value).catch((e) =>
            setFailed(e instanceof Error ? e.message : String(e)),
        );
    };

    return (
        <div className="mx_DeclaredSettings">
            {declaration.settings.map((control) => (
                <div key={control.key} className="mx_DeclaredSettings_control">
                    {control.type === "action" ? (
                        <Button
                            kind="secondary"
                            size="md"
                            disabled={!!control.disabled_reason}
                            onClick={() => ask(control, null)}
                        >
                            {control.label}
                        </Button>
                    ) : control.type === "boolean" ? (
                        <InlineField
                            name={control.key}
                            control={
                                <ToggleControl
                                    name={control.key}
                                    checked={control.value === true}
                                    disabled={!!control.disabled_reason}
                                    onChange={(e) => ask(control, e.target.checked)}
                                />
                            }
                        >
                            <Label>{control.label}</Label>
                            {control.disabled_reason && <HelpMessage>{control.disabled_reason}</HelpMessage>}
                        </InlineField>
                    ) : control.type === "enum" ? (
                        <label className="mx_DeclaredSettings_labelled">
                            <span>{control.label}</span>
                            <select
                                className="mx_DeclaredSettings_select"
                                value={typeof control.value === "string" ? control.value : ""}
                                disabled={!!control.disabled_reason}
                                onChange={(e) => ask(control, e.target.value)}
                            >
                                {control.options?.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label className="mx_DeclaredSettings_labelled">
                            <span>{control.label}</span>
                            <input
                                className="mx_DeclaredSettings_input"
                                type={control.type === "number" ? "number" : "text"}
                                defaultValue={
                                    typeof control.value === "string" || typeof control.value === "number"
                                        ? control.value
                                        : ""
                                }
                                disabled={!!control.disabled_reason}
                                /* On blur rather than on change: a request per keystroke would be a
                                   message per keystroke into the management room. */
                                onBlur={(e) =>
                                    ask(control, control.type === "number" ? Number(e.target.value) : e.target.value)
                                }
                            />
                        </label>
                    )}
                    {/* The bridge's own words for why it cannot be used, rather than this client
                        inventing a guess about somebody else's network. */}
                    {control.disabled_reason && <p className="mx_DeclaredSettings_why">{control.disabled_reason}</p>}
                </div>
            ))}
            {failed && (
                <p className="mx_DeclaredSettings_failed" role="alert">
                    {_t("tg_layout|bridge_setting_failed", { reason: failed })}
                </p>
            )}
        </div>
    );
}
