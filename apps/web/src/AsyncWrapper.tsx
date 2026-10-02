/*
Copyright 2024 New Vector Ltd.
Copyright 2015-2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ErrorInfo, type ReactNode, Suspense } from "react";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "./languageHandler";
import BaseDialog from "./components/views/dialogs/BaseDialog";
import DialogButtons from "./components/views/elements/DialogButtons";
import Spinner from "./components/views/elements/Spinner";
import PlatformPeg from "./PlatformPeg";

interface IProps {
    onFinished(): void;
    children: ReactNode;
}

interface IState {
    error?: Error;
}

/**
 * Whether the error is the dialog's code failing to arrive, as opposed to the dialog failing once it
 * had: a chunk that could not be fetched (webpack's ChunkLoadError, or the browser's own wording for a
 * module it could not import).
 */
export function isLoadFailure(error: Error): boolean {
    return (
        error.name === "ChunkLoadError" ||
        /Loading (CSS )?chunk [^ ]+ failed|dynamically imported module|Importing a module script failed/i.test(
            error.message,
        )
    );
}

/**
 * Wrap an asynchronous loader function with a react component which shows a
 * spinner until the real component loads.
 */
export default class AsyncWrapper extends React.Component<IProps, IState> {
    public static getDerivedStateFromError(error: Error): IState {
        return { error };
    }

    public state: IState = {};

    public componentDidCatch(error: Error, { componentStack }: ErrorInfo): void {
        logger.error("A dialog failed:", error, componentStack);
    }

    private onReload = (): void => {
        PlatformPeg.get()?.reload();
    };

    public render(): React.ReactNode {
        const error = this.state.error;
        if (error) {
            /*
             * Everything that goes wrong inside a dialog ends up here, and only one of those things is the
             * network: the dialog's code not arriving. Anything else is the dialog itself failing, and
             * saying "check your connection" for that sends the reader looking in the wrong place. Either
             * way reloading is what gets them going again, so it is offered rather than only a way out.
             */
            return (
                <BaseDialog onFinished={this.props.onFinished} title={_t("common|error")}>
                    {isLoadFailure(error) ? (
                        _t("failed_load_async_component")
                    ) : (
                        <>
                            <p>{_t("error|something_went_wrong")}</p>
                            <p>
                                <code>{error.message}</code>
                            </p>
                        </>
                    )}
                    <DialogButtons
                        primaryButton={_t("action|reload")}
                        onPrimaryButtonClick={this.onReload}
                        cancelButton={_t("action|dismiss")}
                        onCancel={this.props.onFinished}
                    />
                </BaseDialog>
            );
        }

        return <Suspense fallback={<Spinner />}>{this.props.children}</Suspense>;
    }
}
