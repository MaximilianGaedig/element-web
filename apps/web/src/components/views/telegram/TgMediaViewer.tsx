/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Full-screen media viewer ported from tweb (src/components/mediaViewer/base.ts, swipeHandler.ts,
 * mediaViewer.scss): the photo morphs out of its bubble (a "mover" animated from the source rect to the
 * centred rect, per-corner radii divided by the scale), prev/next slide the old mover out and bring the
 * new one in, zoom/pan is tweb's (from WebZ) with ctrl/⌘+wheel = touchpad pinch, and a click never zooms.
 * The backdrop is lighter than tweb's rgba(0,0,0,.88): translucent black plus a blur, both fading in
 * with the morph (user request).
 */

import React, { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type MatrixEvent, MsgType, type Room } from "matrix-js-sdk/src/matrix";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    CloseIcon,
    DownloadIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { FileDownloader } from "../../../utils/FileDownloader";
import { formatDate } from "../../../DateUtils";
import { _t } from "../../../languageHandler";
import UIStore from "../../../stores/UIStore";

// tweb base.ts
const ZOOM_INITIAL_VALUE = 1;
const ZOOM_MIN_VALUE = 0.5;
const ZOOM_MAX_VALUE = 4;
const OPEN_TRANSITION_TIME = 200;
const MOVE_TRANSITION_TIME = 350;
const RESERVE_TOP_DESKTOP = 80;
const RESERVE_BOTTOM_DESKTOP = 110;
// tweb swipeHandler.ts: wheel gestures end after 150ms without events.
const WHEEL_RELEASE_MS = 150;

interface Transform {
    x: number;
    y: number;
    scale: number;
}

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function isHandheld(): boolean {
    return document.documentElement.dataset.tgScreen === "mobile";
}

/** tweb helpers/calcImageInBox. */
function calcImageInBox(imageW: number, imageH: number, boxW: number, boxH: number, noZoom = true): Rect {
    let w = boxW;
    let h = boxH;
    if (imageW < boxW && imageH < boxH && noZoom) {
        w = imageW;
        h = imageH;
    } else if (imageW / imageH > boxW / boxH) {
        h = (imageH * boxW) / imageW;
    } else {
        w = (imageW * boxH) / imageH;
        if (w > boxW) {
            h = (h * boxW) / w;
            w = boxW;
        }
    }
    return { left: 0, top: 0, width: Math.round(w), height: Math.round(h) };
}

/** Where the media rests: tweb's mediaBoxSize with the desktop reserves, centred (applyCenterStyles). */
function centredRect(mediaW: number, mediaH: number): Rect {
    const handheld = isHandheld();
    const top = handheld ? 0 : RESERVE_TOP_DESKTOP;
    const bottom = handheld ? 0 : RESERVE_BOTTOM_DESKTOP;
    const boxW = UIStore.instance.windowWidth;
    const boxH = UIStore.instance.windowHeight - top - bottom;
    const fit = calcImageInBox(mediaW, mediaH, boxW, boxH, !handheld);
    return {
        width: fit.width,
        height: fit.height,
        left: (boxW - fit.width) / 2,
        top: top + (boxH - fit.height) / 2,
    };
}

export function isViewerMedia(ev: MatrixEvent): boolean {
    if (ev.isRedacted()) return false;
    const type = ev.getContent().msgtype;
    return type === MsgType.Image || type === MsgType.Video;
}

/** The room's loaded photos and videos, oldest first (the viewer's list). */
export function roomMediaItems(room: Room): MatrixEvent[] {
    return room.getLiveTimeline().getEvents().filter(isViewerMedia);
}

/**
 * The on-screen element showing `event`'s media, if any: an element marked data-tg-media-id (album
 * cells, shared-media thumbnails) or the image inside its timeline tile.
 */
function findSource(event: MatrixEvent, root: HTMLElement | null): HTMLElement | null {
    const id = event.getId();
    if (!id) return null;
    const marked = document.querySelector<HTMLElement>(`[data-tg-media-id="${CSS.escape(id)}"]`);
    if (marked && !root?.contains(marked)) return marked.querySelector<HTMLElement>("img, video") ?? marked;
    const tile = document.querySelector(`.mx_EventTile[data-event-id="${CSS.escape(id)}"]`);
    if (!tile) return null;
    const media = Array.from(tile.querySelectorAll<HTMLElement>("img, video")).filter(
        (el) => !el.closest(".mx_BaseAvatar, .mx_ReadReceiptGroup, .mx_ReactionsRow"),
    );
    return media.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
}

/** Whether `el` is actually visible (not scrolled away, not under the header/composer glass). */
function isVisibleSource(el: HTMLElement, root: HTMLElement | null): boolean {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > UIStore.instance.windowWidth || y > UIStore.instance.windowHeight) return false;
    const cell = el.parentElement ?? el;
    for (const hit of document.elementsFromPoint(x, y)) {
        if (root?.contains(hit)) continue;
        return hit === el || cell.contains(hit) || hit.contains(el);
    }
    return false;
}

function cornerRadii(el: HTMLElement | null): number[] {
    if (!el) return [0, 0, 0, 0];
    // The visible rounding may come from a clipping parent (bubble, album cell).
    for (let node: HTMLElement | null = el, i = 0; node && i < 4; node = node.parentElement, i++) {
        const cs = getComputedStyle(node);
        const radii = [
            cs.borderTopLeftRadius,
            cs.borderTopRightRadius,
            cs.borderBottomRightRadius,
            cs.borderBottomLeftRadius,
        ].map((v) => parseFloat(v) || 0);
        if (radii.some((r) => r > 0)) return radii;
    }
    return [0, 0, 0, 0];
}

function mediaSize(event: MatrixEvent, source: HTMLElement | null): [number, number] {
    const info = event.getContent().info;
    if (info?.w && info?.h) return [info.w, info.h];
    if (source instanceof HTMLImageElement && source.naturalWidth) return [source.naturalWidth, source.naturalHeight];
    if (source instanceof HTMLVideoElement && source.videoWidth) return [source.videoWidth, source.videoHeight];
    if (source) {
        const r = source.getBoundingClientRect();
        if (r.width && r.height) return [r.width, r.height];
    }
    return [16, 9];
}

interface MoverState {
    el: HTMLDivElement;
    event: MatrixEvent;
    rect: Rect;
}

/** The imperative part, like tweb's AppMediaViewerBase: movers, zoom and gestures. */
class ViewerController {
    public root: HTMLDivElement | null = null;
    public movers: HTMLDivElement | null = null;
    private mover: MoverState | null = null;
    private hiddenSource: HTMLElement | null = null;
    private helpers = new Map<MatrixEvent, MediaEventHelper>();

    public transform: Transform = { x: 0, y: 0, scale: ZOOM_INITIAL_VALUE };
    private lastTransform: Transform = { ...this.transform };
    private lastZoomCenter = { x: 0, y: 0 };
    private initialContentRect: DOMRect | null = null;
    private lastDragOffset = { x: 0, y: 0 };
    private lastDragDelta = { x: 0, y: 0 };
    private lastGestureTime = 0;
    private draggingType: "wheel" | "mousemove" | "touchmove" | undefined;
    public ctrlKeyDown = false;
    public ignoreNextClick = false;
    public closing = false;
    public animating = false;

    // wheel state (swipeHandler.ts)
    private wheelZoom = 1;
    private wheelCenter = { x: 0, y: 0 };
    private wheelDrag = { x: 0, y: 0 };
    private wheelTimer: number | undefined;
    private wheelKind: "zoom" | "drag" | undefined;

    public constructor(private onZoomChange: (zoomed: boolean) => void) {}

    public get isZooming(): boolean {
        return this.transform.scale !== ZOOM_INITIAL_VALUE;
    }

    public helper(event: MatrixEvent): MediaEventHelper {
        let h = this.helpers.get(event);
        if (!h) {
            h = new MediaEventHelper(event);
            this.helpers.set(event, h);
        }
        return h;
    }

    public destroy(): void {
        window.clearTimeout(this.wheelTimer);
        this.restoreSource();
        this.helpers.forEach((h) => h.destroy());
    }

    private hideSource(el: HTMLElement | null): void {
        this.restoreSource();
        if (!el) return;
        el.style.visibility = "hidden";
        this.hiddenSource = el;
    }

    private restoreSource(): void {
        if (this.hiddenSource) this.hiddenSource.style.visibility = "";
        this.hiddenSource = null;
    }

    private createMover(event: MatrixEvent, rect: Rect, source: HTMLElement | null): HTMLDivElement {
        const el = document.createElement("div");
        el.className = "mx_TgMediaViewer_mover";
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        const thumb =
            source instanceof HTMLImageElement ? source.currentSrc || source.src : source?.getAttribute("poster");
        if (thumb) img.src = thumb;
        el.append(img);
        this.movers!.append(el);
        void this.loadFull(event, el, img, !thumb);
        return el;
    }

    private async loadFull(
        event: MatrixEvent,
        mover: HTMLDivElement,
        img: HTMLImageElement,
        noThumb: boolean,
    ): Promise<void> {
        const helper = this.helper(event);
        const isVideo = event.getContent().msgtype === MsgType.Video;
        if (noThumb) {
            const thumb = await helper.thumbnailUrl.value.catch(() => null);
            if (thumb && !img.src) img.src = thumb;
        }
        const url = await helper.sourceUrl.value.catch(() => null);
        if (!url || !mover.isConnected) return;
        if (isVideo) {
            // Like tweb: the thumbnail morphs, then the player takes over.
            await this.whenSettled();
            if (!mover.isConnected) return;
            const video = document.createElement("video");
            video.src = url;
            video.controls = true;
            video.autoplay = true;
            video.playsInline = true;
            if (img.src) video.poster = img.src;
            mover.append(video);
            img.remove();
            return;
        }
        const full = new Image();
        full.src = url;
        try {
            await full.decode();
        } catch {
            return;
        }
        if (mover.isConnected) img.src = url;
    }

    private settleResolvers: Array<() => void> = [];
    private whenSettled(): Promise<void> {
        if (!this.animating) return Promise.resolve();
        return new Promise((resolve) => this.settleResolvers.push(resolve));
    }

    private settle(): void {
        this.animating = false;
        const r = this.settleResolvers;
        this.settleResolvers = [];
        r.forEach((f) => f());
    }

    /** tweb setMoverToTarget (opening): from the source's rect and corners to the centred rect. */
    public open(event: MatrixEvent, source: HTMLElement | null): void {
        const [w, h] = mediaSize(event, source);
        const rect = centredRect(w, h);
        const visible = !!source && isVisibleSource(source, this.root);
        const el = this.createMover(event, rect, visible ? source : source);
        this.mover = { el, event, rect };
        this.animating = true;

        if (visible && source) {
            const s = source.getBoundingClientRect();
            const sx = s.width / rect.width;
            const sy = s.height / rect.height;
            const radii = cornerRadii(source);
            el.style.transform = `translate3d(${s.left}px,${s.top}px,0) scale3d(${sx},${sy},1)`;
            el.style.borderRadius = `${radii.map((r) => `${r / sx}px`).join(" ")} / ${radii.map((r) => `${r / sy}px`).join(" ")}`;
            this.hideSource(source);
        } else {
            el.style.transform = `translate3d(${rect.left}px,${rect.top}px,0)`;
            el.style.opacity = "0";
        }
        void el.offsetLeft; // reflow
        el.classList.add("mx_TgMediaViewer_mover_active");
        el.style.transform = `translate3d(${rect.left}px,${rect.top}px,0) scale3d(1,1,1)`;
        el.style.borderRadius = "0px";
        el.style.opacity = "";
        window.setTimeout(() => this.settle(), OPEN_TRANSITION_TIME);
    }

    /** tweb moveTheMover + setMoverToTarget(fromRight): the old one slides out, the new one comes in. */
    public switchTo(event: MatrixEvent, fromRight: 1 | -1): void {
        this.resetZoom(true);
        const old = this.mover;
        if (old) {
            const r = old.el.getBoundingClientRect();
            old.el.classList.remove("mx_TgMediaViewer_mover_active");
            old.el.classList.add("mx_TgMediaViewer_mover_moving");
            const x = fromRight === 1 ? -r.width : UIStore.instance.windowWidth;
            old.el.style.transform = `translate3d(${x}px,${old.rect.top}px,0) scale3d(1,1,1)`;
            const oldEl = old.el;
            window.setTimeout(() => oldEl.remove(), MOVE_TRANSITION_TIME);
        }

        const source = findSource(event, this.root);
        const [w, h] = mediaSize(event, source);
        const rect = centredRect(w, h);
        const el = this.createMover(event, rect, source);
        this.mover = { el, event, rect };
        this.animating = true;
        const startX = fromRight === 1 ? UIStore.instance.windowWidth : -rect.width;
        el.style.transform = `translate3d(${startX}px,${rect.top}px,0) scale3d(1,1,1)`;
        void el.offsetLeft;
        el.classList.add("mx_TgMediaViewer_mover_active");
        el.style.transform = `translate3d(${rect.left}px,${rect.top}px,0) scale3d(1,1,1)`;
        this.hideSource(source && isVisibleSource(source, this.root) ? source : null);
        window.setTimeout(() => this.settle(), OPEN_TRANSITION_TIME);
    }

    /**
     * tweb setMoverToTarget (closing): the zoom/pan transform is transferred onto the mover, then it flies
     * back to the source (found again, it may have scrolled) or fades out where it is.
     */
    public close(onDone: () => void): void {
        if (this.closing) return;
        this.closing = true;
        const current = this.mover;
        if (!current || !this.movers) {
            onDone();
            return;
        }
        const el = current.el;
        const visual = el.getBoundingClientRect();
        this.movers.classList.add("mx_TgMediaViewer_noTransition");
        el.style.transition = "none";
        el.style.transform = `translate3d(${visual.left}px,${visual.top}px,0) scale3d(${visual.width / current.rect.width},${visual.height / current.rect.height},1)`;
        this.movers.style.transform = "";
        void el.offsetLeft;
        el.style.transition = "";
        this.movers.classList.remove("mx_TgMediaViewer_noTransition");
        el.querySelector("video")?.pause();

        const target = findSource(current.event, this.root);
        this.restoreSource();
        const visible = !!target && isVisibleSource(target, this.root);
        if (target) target.style.visibility = "hidden";
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                el.classList.add("mx_TgMediaViewer_mover_active");
                if (visible && target) {
                    const s = target.getBoundingClientRect();
                    const sx = s.width / current.rect.width;
                    const sy = s.height / current.rect.height;
                    const radii = cornerRadii(target);
                    el.style.transform = `translate3d(${s.left}px,${s.top}px,0) scale3d(${sx},${sy},1)`;
                    el.style.borderRadius = `${radii.map((r) => `${r / sx}px`).join(" ")} / ${radii.map((r) => `${r / sy}px`).join(" ")}`;
                } else {
                    el.style.opacity = "0";
                }
                window.setTimeout(() => {
                    if (target) target.style.visibility = "";
                    onDone();
                }, OPEN_TRANSITION_TIME);
            }),
        );
    }

    // ---- zoom (tweb base.ts, "zoom part from WebZ") ----

    private applyMoversTransform(): void {
        const { x, y, scale } = this.transform;
        if (this.movers)
            this.movers.style.transform =
                scale === 1 && !x && !y ? "" : `translate3d(${x}px,${y}px,0) scale3d(${scale},${scale},1)`;
    }

    private setTransform(t: Transform): void {
        this.transform = t;
        if (t.scale === ZOOM_INITIAL_VALUE) {
            this.transform.x = 0;
            this.transform.y = 0;
        }
        this.applyMoversTransform();
        this.onZoomChange(this.isZooming);
    }

    public resetZoom(instant = false): void {
        if (instant) this.movers?.classList.add("mx_TgMediaViewer_noTransition");
        this.setTransform({ x: 0, y: 0, scale: ZOOM_INITIAL_VALUE });
        this.initialContentRect = null;
        if (instant) {
            void this.movers?.offsetLeft;
            this.movers?.classList.remove("mx_TgMediaViewer_noTransition");
        }
    }

    private calculateScaleOffset(x: number, y: number, scale: number): { scaleOffsetX: number; scaleOffsetY: number } {
        return { scaleOffsetX: x - scale * x, scaleOffsetY: y - scale * y };
    }

    private getZoomBoundaries(scale: number): { minX: number; maxX: number; minY: number; maxY: number } {
        const rect = this.initialContentRect;
        if (!rect) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        const w = UIStore.instance.windowWidth;
        const h = UIStore.instance.windowHeight;
        const centerX = (w - w * scale) / 2;
        const centerY = (h - h * scale) / 2;
        return {
            minX: Math.max(-rect.left * scale, centerX),
            maxX: w - rect.right * scale,
            minY: Math.max(-rect.top * scale, centerY),
            maxY: h - rect.bottom * scale,
        };
    }

    private calculateOffsetBoundaries({ x, y, scale }: Transform): [Transform, boolean, boolean] {
        if (!this.initialContentRect) return [{ x, y, scale }, true, true];
        const { minX, maxX, minY, maxY } = this.getZoomBoundaries(scale);
        // tweb clamps with (x, maxX, minX): maxX is the lower bound once zoomed in.
        const lowX = Math.min(maxX, minX);
        const highX = Math.max(maxX, minX);
        const lowY = Math.min(maxY, minY);
        const highY = Math.max(maxY, minY);
        const inX = x >= lowX && x <= highX;
        const inY = y >= lowY && y <= highY;
        return [{ x: clamp(x, lowX, highX), y: clamp(y, lowY, highY), scale }, inX, inY];
    }

    private onZoom(d: {
        zoomAdd?: number;
        zoomFactor?: number;
        initialCenterX: number;
        initialCenterY: number;
        currentCenterX: number;
        currentCenterY: number;
        dragOffsetX: number;
        dragOffsetY: number;
    }): void {
        const zoomMaxBounceValue = ZOOM_MAX_VALUE * 3;
        const scale =
            d.zoomAdd !== undefined
                ? clamp(this.lastTransform.scale + d.zoomAdd, ZOOM_MIN_VALUE, zoomMaxBounceValue)
                : clamp(this.lastTransform.scale * (d.zoomFactor ?? 1), ZOOM_MIN_VALUE, zoomMaxBounceValue);
        const scaleFactor = scale / this.lastTransform.scale;
        const offsetX = Math.abs(Math.min(this.lastTransform.x, 0));
        const offsetY = Math.abs(Math.min(this.lastTransform.y, 0));
        this.lastZoomCenter = { x: d.currentCenterX, y: d.currentCenterY };
        const { scaleOffsetX, scaleOffsetY } = this.calculateScaleOffset(
            offsetX + d.initialCenterX,
            offsetY + d.initialCenterY,
            scaleFactor,
        );
        const [t] = this.calculateOffsetBoundaries({
            x: this.lastTransform.x + scaleOffsetX + d.dragOffsetX,
            y: this.lastTransform.y + scaleOffsetY + d.dragOffsetY,
            scale,
        });
        this.setTransform(t);
    }

    /** tweb onSwipeFirst. */
    public gestureStart(type: "wheel" | "mousemove" | "touchmove", keepTransition = false): void {
        this.lastDragOffset = { x: 0, y: 0 };
        this.lastDragDelta = { x: 0, y: 0 };
        this.lastTransform = { ...this.transform };
        if (!keepTransition) this.movers?.classList.add("mx_TgMediaViewer_noTransition");
        this.draggingType = type;
        this.lastGestureTime = Date.now();
        if (!this.transform.x && !this.transform.y && !this.isZooming && this.mover) {
            this.initialContentRect = this.mover.el.getBoundingClientRect();
        }
    }

    /** tweb onSwipeReset: bounce back into [1, 4] (keeping the zoom centre), with pan inertia. */
    public gestureEnd(): void {
        this.movers?.classList.remove("mx_TgMediaViewer_noTransition");
        const draggingType = this.draggingType;
        if (draggingType === "mousemove" && (this.lastDragOffset.x || this.lastDragOffset.y)) {
            this.ignoreNextClick = true;
        }
        this.draggingType = undefined;
        if (this.closing) return;
        if (this.transform.scale > ZOOM_INITIAL_VALUE) {
            const s1 = Math.min(this.transform.scale, ZOOM_MAX_VALUE);
            const f = s1 / this.transform.scale;
            let x1 = this.transform.x * f + (this.lastZoomCenter.x - f * this.lastZoomCenter.x);
            let y1 = this.transform.y * f + (this.lastZoomCenter.y - f * this.lastZoomCenter.y);
            if (draggingType && draggingType !== "wheel" && this.lastTransform.scale === this.transform.scale) {
                const k = 0.1;
                const elapsed = Math.max(1, Date.now() - this.lastGestureTime);
                const vx = Math.abs(this.lastDragOffset.x) / elapsed;
                const vy = Math.abs(this.lastDragOffset.y) / elapsed;
                x1 -= Math.abs(this.lastDragOffset.x) * vx * k * -this.lastDragDelta.x;
                y1 -= Math.abs(this.lastDragOffset.y) * vy * k * -this.lastDragDelta.y;
            }
            const [t] = this.calculateOffsetBoundaries({ x: x1, y: y1, scale: s1 });
            this.lastTransform = t;
            this.setTransform(t);
        } else if (this.transform.scale < ZOOM_INITIAL_VALUE) {
            this.resetZoom();
        }
    }

    /** tweb adjustPosition (panning a zoomed image). */
    public pan(xDiff: number, yDiff: number): { inX: boolean; inY: boolean } {
        const dx = xDiff - this.lastDragOffset.x;
        const dy = yDiff - this.lastDragOffset.y;
        const [t, inX, inY] = this.calculateOffsetBoundaries({
            x: this.transform.x + dx,
            y: this.transform.y + dy,
            scale: this.transform.scale,
        });
        this.lastDragDelta = { x: dx, y: dy };
        this.lastDragOffset = { x: xDiff, y: yDiff };
        this.lastGestureTime = Date.now();
        this.setTransform(t);
        return { inX, inY };
    }

    public zoomAt(x: number, y: number, scale: number): void {
        if (this.mover && !this.isZooming) this.initialContentRect = this.mover.el.getBoundingClientRect();
        const { scaleOffsetX, scaleOffsetY } = this.calculateScaleOffset(x, y, scale);
        const [t] = this.calculateOffsetBoundaries({ x: scaleOffsetX, y: scaleOffsetY, scale });
        this.setTransform(t);
    }

    public pinch(zoomFactor: number, cx: number, cy: number, startX: number, startY: number): void {
        this.onZoom({
            zoomFactor,
            initialCenterX: startX,
            initialCenterY: startY,
            currentCenterX: cx,
            currentCenterY: cy,
            dragOffsetX: cx - startX,
            dragOffsetY: cy - startY,
        });
    }

    /** swipeHandler handleWheel: ctrl/⌘/shift (and touchpad pinch, which sets ctrlKey) zooms, else pans. */
    public onWheel = (e: WheelEvent): void => {
        if (this.closing) return;
        e.preventDefault();
        const zoom = e.ctrlKey || e.metaKey || e.shiftKey;
        const kind = zoom ? "zoom" : "drag";
        if (this.wheelKind && this.wheelKind !== kind) this.releaseWheel();
        if (!this.wheelKind) {
            if (kind === "drag" && !this.isZooming) return; // tweb: no swipe by wheel when not zoomed
            this.wheelKind = kind;
            // keep the transition for a real mouse wheel (ctrl held on the keyboard), not for pinches
            this.gestureStart("wheel", zoom && this.ctrlKeyDown);
            this.wheelZoom = 1;
            this.wheelCenter = { x: e.clientX, y: e.clientY };
            this.wheelDrag = { x: 0, y: 0 };
        }
        if (kind === "zoom") {
            this.wheelZoom -= clamp(e.deltaY, -25, 25) * 0.01;
            this.onZoom({
                zoomAdd: this.wheelZoom - 1,
                initialCenterX: this.wheelCenter.x,
                initialCenterY: this.wheelCenter.y,
                currentCenterX: e.clientX,
                currentCenterY: e.clientY,
                dragOffsetX: e.clientX - this.wheelCenter.x,
                dragOffsetY: e.clientY - this.wheelCenter.y,
            });
        } else {
            this.wheelDrag.x -= e.deltaX;
            this.wheelDrag.y -= e.deltaY;
            this.pan(this.wheelDrag.x, this.wheelDrag.y);
        }
        window.clearTimeout(this.wheelTimer);
        this.wheelTimer = window.setTimeout(() => this.releaseWheel(), WHEEL_RELEASE_MS);
    };

    private releaseWheel(): void {
        window.clearTimeout(this.wheelTimer);
        if (!this.wheelKind) return;
        this.wheelKind = undefined;
        this.gestureEnd();
    }

    public get currentEvent(): MatrixEvent | undefined {
        return this.mover?.event;
    }
}

interface Props {
    items: MatrixEvent[];
    index: number;
    source: HTMLElement | null;
    onClosed: () => void;
}

function TgMediaViewer({ items, index: startIndex, source, onClosed }: Props): JSX.Element {
    const [index, setIndex] = useState(startIndex);
    const [active, setActive] = useState(false);
    const [zoomed, setZoomed] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const moversRef = useRef<HTMLDivElement>(null);
    const ctl = useRef<ViewerController>(null);
    ctl.current ??= new ViewerController(setZoomed);
    const indexRef = useRef(index);
    indexRef.current = index;

    useLayoutEffect(() => {
        const c = ctl.current!;
        c.root = rootRef.current;
        c.movers = moversRef.current;
        c.open(items[startIndex], source);
        requestAnimationFrame(() => setActive(true));
        return () => c.destroy();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const close = useCallback(() => {
        const c = ctl.current!;
        if (c.closing) return;
        setActive(false);
        c.close(onClosed);
    }, [onClosed]);

    // tweb: "next" is the older media (right arrow / right switcher), "prev" the newer.
    const go = useCallback(
        (older: boolean) => {
            const c = ctl.current!;
            if (c.closing) return;
            const next = indexRef.current + (older ? -1 : 1);
            if (next < 0 || next >= items.length) return;
            setIndex(next);
            c.switchTo(items[next], older ? 1 : -1);
        },
        [items],
    );

    useEffect(() => {
        const c = ctl.current!;
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.ctrlKey || e.metaKey) c.ctrlKeyDown = true;
            if (e.key === "Escape") close();
            else if (e.key === "ArrowRight") go(true);
            else if (e.key === "ArrowLeft") go(false);
            else return;
            e.preventDefault();
            e.stopPropagation();
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey)) c.ctrlKeyDown = false;
        };
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        const root = rootRef.current!;
        root.addEventListener("wheel", c.onWheel, { passive: false });
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            root.removeEventListener("wheel", c.onWheel);
        };
    }, [close, go]);

    // Mouse drag pans a zoomed image (tweb SwipeHandler mousemove).
    const onMouseDown = (e: React.MouseEvent): void => {
        const c = ctl.current!;
        if (e.button !== 0 || !c.isZooming || (e.target as HTMLElement).closest(".mx_TgMediaViewer_chrome")) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        c.gestureStart("mousemove");
        const move = (ev: MouseEvent): void => void c.pan(ev.clientX - startX, ev.clientY - startY);
        const up = (): void => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            c.gestureEnd();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    // Touch: pinch zooms, one finger pans when zoomed or swipes (tweb onSwipe: 20% / 125px → prev/next/close).
    const touch = useRef<{
        x: number;
        y: number;
        dist: number;
        cx: number;
        cy: number;
        pinch: boolean;
        lastTap: number;
        moved: boolean;
    }>({ x: 0, y: 0, dist: 0, cx: 0, cy: 0, pinch: false, lastTap: 0, moved: false });
    const onTouchStart = (e: React.TouchEvent): void => {
        const c = ctl.current!;
        if ((e.target as HTMLElement).closest(".mx_TgMediaViewer_chrome, video")) return;
        const t = touch.current;
        if (e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            t.pinch = true;
            t.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            t.cx = (a.clientX + b.clientX) / 2;
            t.cy = (a.clientY + b.clientY) / 2;
            c.gestureStart("touchmove");
        } else if (e.touches.length === 1) {
            t.pinch = false;
            t.moved = false;
            t.x = e.touches[0].clientX;
            t.y = e.touches[0].clientY;
            c.gestureStart("touchmove");
        }
    };
    const onTouchMove = (e: React.TouchEvent): void => {
        const c = ctl.current!;
        const t = touch.current;
        if (t.pinch && e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            c.pinch(dist / t.dist, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, t.cx, t.cy);
            return;
        }
        if (e.touches.length !== 1) return;
        t.moved = true;
        const xDiff = e.touches[0].clientX - t.x;
        const yDiff = e.touches[0].clientY - t.y;
        if (c.isZooming) {
            c.pan(xDiff, yDiff);
            return;
        }
        if (Math.abs(xDiff) / UIStore.instance.windowWidth > 0.2 || Math.abs(xDiff) > 125) {
            t.x = Number.NaN;
            go(xDiff < 0);
        } else if (Math.abs(yDiff) / UIStore.instance.windowHeight > 0.2 || Math.abs(yDiff) > 125) {
            t.x = Number.NaN;
            close();
        }
    };
    const onTouchEnd = (e: React.TouchEvent): void => {
        const c = ctl.current!;
        const t = touch.current;
        c.gestureEnd();
        if (e.touches.length) return;
        // tweb onDoubleClick: a double tap zooms to 3x at the tap, or back out.
        if (!t.pinch && !t.moved && e.changedTouches.length === 1) {
            const now = Date.now();
            if (now - t.lastTap < 300) {
                const p = e.changedTouches[0];
                if (c.isZooming) c.resetZoom();
                else c.zoomAt(p.clientX, p.clientY, ZOOM_INITIAL_VALUE + 2);
                t.lastTap = 0;
                c.ignoreNextClick = true;
            } else {
                t.lastTap = now;
            }
        }
        t.pinch = false;
    };

    // tweb onClick: clicking closes the viewer (never zooms); not while zoomed or right after a drag.
    const onClick = (e: React.MouseEvent): void => {
        const c = ctl.current!;
        if (c.ignoreNextClick) {
            c.ignoreNextClick = false;
            return;
        }
        if ((e.target as HTMLElement).closest(".mx_TgMediaViewer_chrome, video")) return;
        if (c.isZooming) return;
        close();
    };

    const event = items[index];
    const download = async (): Promise<void> => {
        const helper = ctl.current!.helper(event);
        const blob = await helper.sourceBlob.value;
        await new FileDownloader().download({ blob, name: helper.fileName });
    };
    const sender = event.sender?.name ?? event.getSender();

    // Keyboard: Esc and the arrows are handled on window (above); clicks here are pointer shortcuts.
    return (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
            ref={rootRef}
            className={`mx_TgMediaViewer${active ? " mx_TgMediaViewer_active" : ""}${zoomed ? " mx_TgMediaViewer_zoomed" : ""}`}
            role="dialog"
            aria-modal="true"
            onClick={onClick}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
        >
            <div className="mx_TgMediaViewer_backdrop" />
            <div ref={moversRef} className="mx_TgMediaViewer_movers" />
            <div className="mx_TgMediaViewer_chrome mx_TgMediaViewer_topbar">
                <div className="mx_TgMediaViewer_author">
                    <div className="mx_TgMediaViewer_name">{sender}</div>
                    <div className="mx_TgMediaViewer_date">{formatDate(new Date(event.getTs()))}</div>
                </div>
                <div className="mx_TgMediaViewer_buttons">
                    <button type="button" aria-label={_t("action|download")} onClick={() => void download()}>
                        <DownloadIcon />
                    </button>
                    <button type="button" aria-label={_t("action|close")} onClick={close}>
                        <CloseIcon />
                    </button>
                </div>
            </div>
            {index < items.length - 1 && (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                    className="mx_TgMediaViewer_chrome mx_TgMediaViewer_switcher mx_TgMediaViewer_switcher_left"
                    onClick={() => go(false)}
                >
                    <ChevronLeftIcon className="mx_TgMediaViewer_sibling" />
                </div>
            )}
            {index > 0 && (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                    className="mx_TgMediaViewer_chrome mx_TgMediaViewer_switcher mx_TgMediaViewer_switcher_right"
                    onClick={() => go(true)}
                >
                    <ChevronRightIcon className="mx_TgMediaViewer_sibling" />
                </div>
            )}
        </div>
    );
}

/**
 * Opens the viewer on `items[index]`, morphing out of `source` (the element showing it, if on screen).
 * `items` are oldest first; see {@link roomMediaItems}.
 */
export function openTgMediaViewer(items: MatrixEvent[], index: number, source: HTMLElement | null): void {
    if (!items.length) return;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onClosed = (): void => {
        root.unmount();
        container.remove();
    };
    root.render(
        <TgMediaViewer items={items} index={clamp(index, 0, items.length - 1)} source={source} onClosed={onClosed} />,
    );
}

/** Opens `event` in the viewer with the rest of the room's loaded media to page through. */
export function openRoomMedia(room: Room | null | undefined, event: MatrixEvent, source: HTMLElement | null): void {
    const items = room ? roomMediaItems(room) : [];
    let index = items.indexOf(event);
    if (index < 0) {
        items.splice(0, items.length, event);
        index = 0;
    }
    openTgMediaViewer(items, index, source);
}
