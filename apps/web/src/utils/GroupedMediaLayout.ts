/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Grouped media ("album") layout, ported from Telegram Web K:
 *   https://github.com/morethanwords/tweb  src/components/groupedLayout.ts  (GPL-3.0)
 * which in turn is a port of Telegram Desktop's
 *   Telegram/SourceFiles/ui/grouped_layout.cpp  (GPL-3.0 with OpenSSL exception)
 * The arithmetic (including its rounding and the `averageRatio` accumulator starting at 1) is kept
 * identical to the original so that albums are laid out exactly like on Telegram.
 */

export interface MediaSize {
    w: number;
    h: number;
}

export interface GroupedMediaGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GroupedMediaItemLayout {
    geometry: GroupedMediaGeometry;
    /** bit mask of {@link RectPart}: which outer edges of the album this item touches */
    sides: number;
}

export const RectPart = {
    None: 0,
    Top: 1,
    Right: 2,
    Bottom: 4,
    Left: 8,
} as const;

interface Attempt {
    lineCounts: number[];
    heights: number[];
}

function sum(values: number[], initial: number): number {
    return values.reduce((acc, v) => acc + v, initial);
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

/** Port of tweb's `Layouter` (2–4 items use hand-tuned proportion layouts, 5+ the attempt-scoring one). */
export class Layouter {
    private readonly count: number;
    private readonly ratios: number[];
    private readonly proportions: string;
    private readonly averageRatio: number;
    private readonly maxSizeRatio: number;

    public constructor(
        private readonly sizes: MediaSize[],
        private readonly maxWidth: number,
        private readonly minWidth: number,
        private readonly spacing: number,
        private readonly maxHeight = maxWidth,
    ) {
        this.count = sizes.length;
        this.ratios = sizes.map((size) => size.w / size.h);
        this.proportions = this.ratios.map((r) => (r > 1.2 ? "w" : r < 0.8 ? "n" : "q")).join("");
        // sic: Telegram accumulates starting from 1
        this.averageRatio = sum(this.ratios, 1) / this.count;
        this.maxSizeRatio = maxWidth / this.maxHeight;
    }

    public layout(): GroupedMediaItemLayout[] {
        if (!this.count) return [];
        if (this.count === 1) return this.layoutOne();

        if (this.count >= 5 || this.ratios.find((r) => r > 2)) {
            return new ComplexLayouter(
                this.ratios,
                this.averageRatio,
                this.maxWidth,
                this.minWidth,
                this.spacing,
            ).layout();
        }

        if (this.count === 2) return this.layoutTwo();
        if (this.count === 3) return this.layoutThree();
        return this.layoutFour();
    }

    private layoutTwo(): GroupedMediaItemLayout[] {
        if (
            this.proportions === "ww" &&
            this.averageRatio > 1.4 * this.maxSizeRatio &&
            this.ratios[1] - this.ratios[0] < 0.2
        ) {
            return this.layoutTwoTopBottom();
        } else if (this.proportions === "ww" || this.proportions === "qq") {
            return this.layoutTwoLeftRightEqual();
        }
        return this.layoutTwoLeftRight();
    }

    private layoutThree(): GroupedMediaItemLayout[] {
        if (this.proportions[0] === "n") return this.layoutThreeLeftAndOther();
        return this.layoutThreeTopAndOther();
    }

    private layoutFour(): GroupedMediaItemLayout[] {
        if (this.proportions[0] === "w") return this.layoutFourTopAndOther();
        return this.layoutFourLeftAndOther();
    }

    private layoutOne(): GroupedMediaItemLayout[] {
        const width = this.maxWidth;
        const height = (this.sizes[0].h * width) / this.sizes[0].w;
        return [
            {
                geometry: { x: 0, y: 0, width, height },
                sides: RectPart.Left | RectPart.Top | RectPart.Right | RectPart.Bottom,
            },
        ];
    }

    private layoutTwoTopBottom(): GroupedMediaItemLayout[] {
        const width = this.maxWidth;
        const height = Math.round(
            Math.min(width / this.ratios[0], Math.min(width / this.ratios[1], (this.maxHeight - this.spacing) / 2)),
        );
        return [
            { geometry: { x: 0, y: 0, width, height }, sides: RectPart.Left | RectPart.Top | RectPart.Right },
            {
                geometry: { x: 0, y: height + this.spacing, width, height },
                sides: RectPart.Left | RectPart.Bottom | RectPart.Right,
            },
        ];
    }

    private layoutTwoLeftRightEqual(): GroupedMediaItemLayout[] {
        const width = (this.maxWidth - this.spacing) / 2;
        const height = Math.round(
            Math.min(width / this.ratios[0], Math.min(width / this.ratios[1], this.maxHeight * 1)),
        );
        return [
            { geometry: { x: 0, y: 0, width, height }, sides: RectPart.Top | RectPart.Left | RectPart.Bottom },
            {
                geometry: { x: width + this.spacing, y: 0, width, height },
                sides: RectPart.Top | RectPart.Right | RectPart.Bottom,
            },
        ];
    }

    private layoutTwoLeftRight(): GroupedMediaItemLayout[] {
        const minimalWidth = Math.round(this.minWidth * 1.5);
        const secondWidth = Math.min(
            Math.round(
                Math.max(
                    0.4 * (this.maxWidth - this.spacing),
                    (this.maxWidth - this.spacing) / this.ratios[0] / (1 / this.ratios[0] + 1 / this.ratios[1]),
                ),
            ),
            this.maxWidth - this.spacing - minimalWidth,
        );
        const firstWidth = this.maxWidth - secondWidth - this.spacing;
        const height = Math.min(
            this.maxHeight,
            Math.round(Math.min(firstWidth / this.ratios[0], secondWidth / this.ratios[1])),
        );
        return [
            {
                geometry: { x: 0, y: 0, width: firstWidth, height },
                sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
            },
            {
                geometry: { x: firstWidth + this.spacing, y: 0, width: secondWidth, height },
                sides: RectPart.Top | RectPart.Right | RectPart.Bottom,
            },
        ];
    }

    private layoutThreeLeftAndOther(): GroupedMediaItemLayout[] {
        const firstHeight = this.maxHeight;
        const thirdHeight = Math.round(
            Math.min(
                (this.maxHeight - this.spacing) / 2,
                (this.ratios[1] * (this.maxWidth - this.spacing)) / (this.ratios[2] + this.ratios[1]),
            ),
        );
        const secondHeight = firstHeight - thirdHeight - this.spacing;
        const rightWidth = Math.max(
            this.minWidth,
            Math.round(
                Math.min(
                    (this.maxWidth - this.spacing) / 2,
                    Math.min(thirdHeight * this.ratios[2], secondHeight * this.ratios[1]),
                ),
            ),
        );
        const leftWidth = Math.min(Math.round(firstHeight * this.ratios[0]), this.maxWidth - this.spacing - rightWidth);
        return [
            {
                geometry: { x: 0, y: 0, width: leftWidth, height: firstHeight },
                sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
            },
            {
                geometry: { x: leftWidth + this.spacing, y: 0, width: rightWidth, height: secondHeight },
                sides: RectPart.Top | RectPart.Right,
            },
            {
                geometry: {
                    x: leftWidth + this.spacing,
                    y: secondHeight + this.spacing,
                    width: rightWidth,
                    height: thirdHeight,
                },
                sides: RectPart.Bottom | RectPart.Right,
            },
        ];
    }

    private layoutThreeTopAndOther(): GroupedMediaItemLayout[] {
        const firstWidth = this.maxWidth;
        const firstHeight = Math.round(Math.min(firstWidth / this.ratios[0], (this.maxHeight - this.spacing) * 0.66));
        const secondWidth = (this.maxWidth - this.spacing) / 2;
        const secondHeight = Math.min(
            this.maxHeight - firstHeight - this.spacing,
            Math.round(Math.min(secondWidth / this.ratios[1], secondWidth / this.ratios[2])),
        );
        const thirdWidth = firstWidth - secondWidth - this.spacing;
        return [
            {
                geometry: { x: 0, y: 0, width: firstWidth, height: firstHeight },
                sides: RectPart.Left | RectPart.Top | RectPart.Right,
            },
            {
                geometry: { x: 0, y: firstHeight + this.spacing, width: secondWidth, height: secondHeight },
                sides: RectPart.Bottom | RectPart.Left,
            },
            {
                geometry: {
                    x: secondWidth + this.spacing,
                    y: firstHeight + this.spacing,
                    width: thirdWidth,
                    height: secondHeight,
                },
                sides: RectPart.Bottom | RectPart.Right,
            },
        ];
    }

    private layoutFourTopAndOther(): GroupedMediaItemLayout[] {
        const w = this.maxWidth;
        const h0 = Math.round(Math.min(w / this.ratios[0], (this.maxHeight - this.spacing) * 0.66));
        const h = Math.round((this.maxWidth - 2 * this.spacing) / (this.ratios[1] + this.ratios[2] + this.ratios[3]));
        const w0 = Math.max(
            this.minWidth,
            Math.round(Math.min((this.maxWidth - 2 * this.spacing) * 0.4, h * this.ratios[1])),
        );
        const w2 = Math.round(
            Math.max(Math.max(this.minWidth * 1, (this.maxWidth - 2 * this.spacing) * 0.33), h * this.ratios[3]),
        );
        const w1 = w - w0 - w2 - 2 * this.spacing;
        const h1 = Math.min(this.maxHeight - h0 - this.spacing, h);
        return [
            { geometry: { x: 0, y: 0, width: w, height: h0 }, sides: RectPart.Left | RectPart.Top | RectPart.Right },
            {
                geometry: { x: 0, y: h0 + this.spacing, width: w0, height: h1 },
                sides: RectPart.Bottom | RectPart.Left,
            },
            { geometry: { x: w0 + this.spacing, y: h0 + this.spacing, width: w1, height: h1 }, sides: RectPart.Bottom },
            {
                geometry: { x: w0 + this.spacing + w1 + this.spacing, y: h0 + this.spacing, width: w2, height: h1 },
                sides: RectPart.Right | RectPart.Bottom,
            },
        ];
    }

    private layoutFourLeftAndOther(): GroupedMediaItemLayout[] {
        const h = this.maxHeight;
        const w0 = Math.round(Math.min(h * this.ratios[0], (this.maxWidth - this.spacing) * 0.6));
        const w = Math.round(
            (this.maxHeight - 2 * this.spacing) / (1 / this.ratios[1] + 1 / this.ratios[2] + 1 / this.ratios[3]),
        );
        const h0 = Math.round(w / this.ratios[1]);
        const h1 = Math.round(w / this.ratios[2]);
        const h2 = h - h0 - h1 - 2 * this.spacing;
        const w1 = Math.max(this.minWidth, Math.min(this.maxWidth - w0 - this.spacing, w));
        return [
            {
                geometry: { x: 0, y: 0, width: w0, height: h },
                sides: RectPart.Top | RectPart.Left | RectPart.Bottom,
            },
            { geometry: { x: w0 + this.spacing, y: 0, width: w1, height: h0 }, sides: RectPart.Top | RectPart.Right },
            { geometry: { x: w0 + this.spacing, y: h0 + this.spacing, width: w1, height: h1 }, sides: RectPart.Right },
            {
                geometry: { x: w0 + this.spacing, y: h0 + h1 + 2 * this.spacing, width: w1, height: h2 },
                sides: RectPart.Bottom | RectPart.Right,
            },
        ];
    }
}

/** Port of tweb's `ComplexLayouter`: tries every 2/3/4-row split and keeps the one closest to maxHeight. */
class ComplexLayouter {
    private readonly ratios: number[];
    private readonly count: number;

    public constructor(
        ratios: number[],
        private readonly averageRatio: number,
        private readonly maxWidth: number,
        private readonly minWidth: number,
        private readonly spacing: number,
        private readonly maxHeight = (maxWidth * 4) / 3,
    ) {
        const kMaxRatio = 2.75;
        const kMinRatio = 0.6667;
        this.ratios = ratios.map((ratio) =>
            averageRatio > 1.1 ? clamp(ratio, 1, kMaxRatio) : clamp(ratio, kMinRatio, 1),
        );
        this.count = ratios.length;
    }

    public layout(): GroupedMediaItemLayout[] {
        const result = new Array<GroupedMediaItemLayout>(this.count);
        const attempts: Attempt[] = [];
        const multiHeight = (offset: number, count: number): number => {
            const s = sum(this.ratios.slice(offset, offset + count), 0);
            return (this.maxWidth - (count - 1) * this.spacing) / s;
        };
        const pushAttempt = (lineCounts: number[]): void => {
            const heights: number[] = [];
            let offset = 0;
            for (const count of lineCounts) {
                heights.push(multiHeight(offset, count));
                offset += count;
            }
            attempts.push({ lineCounts, heights });
        };

        for (let first = 1; first !== this.count; ++first) {
            const second = this.count - first;
            if (first > 3 || second > 3) continue;
            pushAttempt([first, second]);
        }
        for (let first = 1; first !== this.count - 1; ++first) {
            for (let second = 1; second !== this.count - first; ++second) {
                const third = this.count - first - second;
                if (first > 3 || second > (this.averageRatio < 0.85 ? 4 : 3) || third > 3) continue;
                pushAttempt([first, second, third]);
            }
        }
        for (let first = 1; first !== this.count - 1; ++first) {
            for (let second = 1; second !== this.count - first; ++second) {
                for (let third = 1; third !== this.count - first - second; ++third) {
                    const fourth = this.count - first - second - third;
                    if (first > 3 || second > 3 || third > 3 || fourth > 3) continue;
                    pushAttempt([first, second, third, fourth]);
                }
            }
        }

        let optimalAttempt: Attempt | null = null;
        let optimalDiff = 0;
        for (const attempt of attempts) {
            const { heights, lineCounts: counts } = attempt;
            const lineCount = counts.length;
            const totalHeight = sum(heights, 0) + this.spacing * (lineCount - 1);
            const minLineHeight = Math.min(...heights);
            const bad1 = minLineHeight < this.minWidth ? 1.5 : 1;
            let bad2 = 1;
            for (let line = 1; line !== lineCount; ++line) {
                if (counts[line - 1] > counts[line]) {
                    bad2 = 1.5;
                    break;
                }
            }
            const diff = Math.abs(totalHeight - this.maxHeight) * bad1 * bad2;
            if (!optimalAttempt || diff < optimalDiff) {
                optimalAttempt = attempt;
                optimalDiff = diff;
            }
        }

        const { lineCounts: optimalCounts, heights: optimalHeights } = optimalAttempt!;
        const rowCount = optimalCounts.length;
        let index = 0;
        let y = 0;
        for (let row = 0; row !== rowCount; ++row) {
            const colCount = optimalCounts[row];
            const lineHeight = optimalHeights[row];
            const height = Math.round(lineHeight);
            let x = 0;
            for (let col = 0; col !== colCount; ++col) {
                const sides =
                    RectPart.None |
                    (row === 0 ? RectPart.Top : RectPart.None) |
                    (row === rowCount - 1 ? RectPart.Bottom : RectPart.None) |
                    (col === 0 ? RectPart.Left : RectPart.None) |
                    (col === colCount - 1 ? RectPart.Right : RectPart.None);
                const width = col === colCount - 1 ? this.maxWidth - x : Math.round(this.ratios[index] * lineHeight);
                result[index] = { geometry: { x, y, width, height }, sides };
                x += width + this.spacing;
                ++index;
            }
            y += height + this.spacing;
        }
        return result;
    }
}

/**
 * Album bubble sizing used by Telegram Web K (src/components/wrappers/album.ts + src/helpers/mediaSizes.ts):
 * desktop album width 420px, minimum item width 100px, 1px spacing between items.
 */
export const ALBUM_MAX_WIDTH = 420;
export const ALBUM_MIN_WIDTH = 100;
export const ALBUM_SPACING = 1;

export interface AlbumGridLayout {
    /** overall width/height of the album in px (before CSS scales it down to the available width) */
    width: number;
    height: number;
    items: GroupedMediaItemLayout[];
}

/**
 * Port of tweb's `prepareAlbum` (src/components/prepareAlbum.ts): runs the layouter and derives the
 * container size from the right-most and bottom-most items.
 */
export function layoutAlbum(
    sizes: MediaSize[],
    maxWidth = ALBUM_MAX_WIDTH,
    minWidth = ALBUM_MIN_WIDTH,
    spacing = ALBUM_SPACING,
): AlbumGridLayout {
    const items = new Layouter(sizes, maxWidth, minWidth, spacing).layout();
    if (!items.length) return { width: 0, height: 0, items };
    const widthItem = items.find((item) => item.sides & RectPart.Right)!;
    const heightItem = items.find((item) => item.sides & RectPart.Bottom)!;
    return {
        width: widthItem.geometry.x + widthItem.geometry.width,
        height: heightItem.geometry.y + heightItem.geometry.height,
        items,
    };
}
