/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** What Element Web uses of tweb's animated four-colour chat wallpaper (src/components/chat/gradientRenderer.ts). */
export default class ChatBackgroundGradientRenderer {
    /**
     * A renderer with its canvas, drawn in the given colours.
     * @param colors - the gradient's stops, `#rrggbb`, comma-separated; one colour draws a flat fill.
     */
    public static create(colors?: string): {
        gradientRenderer: ChatBackgroundGradientRenderer;
        canvas: HTMLCanvasElement;
    };
    /** Turns the gradient to its next position, the way Telegram moves it when a message is sent. */
    public toNextPosition(getProgress?: () => number): void;
    public cleanup(): void;
}
