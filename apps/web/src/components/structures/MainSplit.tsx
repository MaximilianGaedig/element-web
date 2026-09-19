/*
Copyright 2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2018 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import { type NumberSize, Resizable } from "re-resizable";
import { type Direction } from "re-resizable/lib/resizer";
import { type WebPanelResize } from "@matrix-org/analytics-events/types/typescript/WebPanelResize";

import { PosthogAnalytics } from "../../PosthogAnalytics.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";
import SettingsStore from "../../settings/SettingsStore";
import { TRANSITION_STANDARD_IN_MS, TRANSITION_STANDARD_OUT_MS } from "../../utils/telegram/tgLayout/constants";

interface IProps {
    collapsedRhs?: boolean;
    panel?: JSX.Element;
    children: ReactNode;
    /**
     * A unique identifier for this panel split.
     *
     * This is appended to the key used to store the panel size in localStorage, allowing the widths of different
     * panels to be stored.
     */
    sizeKey?: string;
    /**
     * The size to use for the panel component if one isn't persisted in storage. Defaults to 320.
     */
    defaultSize: number;

    analyticsRoomType: WebPanelResize["roomType"];
}

/**
 * Fork: in the Telegram-style layout the side panel slides like Telegram Web K's right column
 * (src/scss/partials/_rightSidebar.scss, GPL-3.0): in with --transition-standard-in (.3s), out with
 * --transition-standard-out (.25s), both cubic-bezier(.4, 0, .2, 1). Closing keeps the panel rendered
 * until the slide-out ends.
 */
type PaneAnimation = "in" | "out";

interface IState {
    /** The panel being slid out after it was closed. */
    closingPanel?: JSX.Element;
    paneAnimation?: PaneAnimation;
}

function isTelegramLayout(): boolean {
    return !!SettingsStore.getValue("telegramStyleLayout");
}

export default class MainSplit extends React.Component<IProps, IState> {
    public static contextType = SDKContext;
    declare public context: React.ContextType<typeof SDKContext>;

    public static defaultProps = {
        defaultSize: 320,
    };

    private paneTimer?: number;

    public constructor(props: IProps, context: React.ContextType<typeof SDKContext>) {
        super(props, context);
        this.state = {};
    }

    private static isPanelShown(props: IProps): boolean {
        return !props.collapsedRhs && !!props.panel;
    }

    public componentDidUpdate(prevProps: IProps): void {
        const wasShown = MainSplit.isPanelShown(prevProps);
        const isShown = MainSplit.isPanelShown(this.props);
        if (wasShown === isShown || !isTelegramLayout()) return;

        window.clearTimeout(this.paneTimer);
        if (isShown) {
            this.setState({ closingPanel: undefined, paneAnimation: "in" });
            this.paneTimer = window.setTimeout(
                () => this.setState({ paneAnimation: undefined }),
                TRANSITION_STANDARD_IN_MS,
            );
        } else {
            this.setState({ closingPanel: prevProps.panel, paneAnimation: "out" });
            this.paneTimer = window.setTimeout(
                () => this.setState({ closingPanel: undefined, paneAnimation: undefined }),
                TRANSITION_STANDARD_OUT_MS,
            );
        }
    }

    public componentWillUnmount(): void {
        window.clearTimeout(this.paneTimer);
    }

    private onResizeStart = (): void => {
        this.context.resizeNotifier.startResizing();
    };

    private onResize = (): void => {
        this.context.resizeNotifier.notifyRightHandleResized();
    };

    private get sizeSettingStorageKey(): string {
        let key = "mx_rhs_size";
        if (!!this.props.sizeKey) {
            key += `_${this.props.sizeKey}`;
        }
        return key;
    }

    private onResizeStop = (
        event: MouseEvent | TouchEvent,
        direction: Direction,
        elementRef: HTMLElement,
        delta: NumberSize,
    ): void => {
        const newSize = this.loadSidePanelSize().width + delta.width;
        this.context.resizeNotifier.stopResizing();
        window.localStorage.setItem(this.sizeSettingStorageKey, newSize.toString());

        PosthogAnalytics.instance.trackEvent<WebPanelResize>({
            eventName: "WebPanelResize",
            panel: "right",
            roomType: this.props.analyticsRoomType,
            size: newSize,
        });
    };

    private loadSidePanelSize(): { height: string | number; width: number } {
        let rhsSize = parseInt(window.localStorage.getItem(this.sizeSettingStorageKey)!, 10);

        if (isNaN(rhsSize)) {
            rhsSize = this.props.defaultSize;
        }

        return {
            height: "100%",
            width: rhsSize,
        };
    }

    public render(): React.ReactNode {
        const bodyView = React.Children.only(this.props.children);
        const closing = !MainSplit.isPanelShown(this.props) && this.state.closingPanel;
        const panelView = closing ? this.state.closingPanel : this.props.panel;

        const hasResizer = closing || (!this.props.collapsedRhs && panelView);
        const size = this.loadSidePanelSize();

        let children;
        if (hasResizer) {
            children = (
                <Resizable
                    key={this.props.sizeKey}
                    defaultSize={size}
                    minWidth={320}
                    maxWidth="50%"
                    enable={{
                        top: false,
                        right: false,
                        bottom: false,
                        left: true,
                        topRight: false,
                        bottomRight: false,
                        bottomLeft: false,
                        topLeft: false,
                    }}
                    onResizeStart={this.onResizeStart}
                    onResize={this.onResize}
                    onResizeStop={this.onResizeStop}
                    className="mx_RightPanel_ResizeWrapper"
                    handleClasses={{ left: "mx_ResizeHandle--horizontal" }}
                    data-tg-pane={this.state.paneAnimation}
                    style={
                        isTelegramLayout()
                            ? ({ "--MainSplit-panel-width": `${size.width}px` } as React.CSSProperties)
                            : undefined
                    }
                >
                    {panelView}
                </Resizable>
            );
        }

        return (
            <div className="mx_MainSplit">
                {bodyView}
                {children}
            </div>
        );
    }
}
