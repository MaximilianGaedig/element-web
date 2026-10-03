/*
Copyright 2024 New Vector Ltd.
Copyright 2020 Nurjin Jafar
Copyright 2020 Nordeck IT + Consulting GmbH.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
 */
import React, { type FunctionComponent, useEffect, useRef } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import dis from "../../../dispatcher/dispatcher";
import type ICanvasEffect from "../../../effects/ICanvasEffect";
import { CHAT_EFFECTS } from "../../../effects";
import UIStore, { UI_EVENTS } from "../../../stores/UIStore";

interface IProps {
    /** The room's width, read when an effect is played. */
    getRoomWidth: () => number;
}

/** How often a sized canvas checks whether its effects have finished, to give its memory back. */
const RELEASE_CHECK_MS = 1000;

/*
 * The canvas is given a size only while an effect plays. Sized to the room all the time, every room kept
 * open for switching held a full-room canvas (~4 MB each, measured), and its width was read from the
 * room on every render of the room view, which forced the page's style and layout part-way through
 * drawing a chat switch.
 */
const EffectsOverlay: FunctionComponent<IProps> = ({ getRoomWidth }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Read when an effect starts; held in a ref so the listener below is registered once.
    const getRoomWidthRef = useRef(getRoomWidth);
    getRoomWidthRef.current = getRoomWidth;
    const effectsRef = useRef<Map<string, ICanvasEffect>>(new Map<string, ICanvasEffect>());

    const lazyLoadEffectModule = async (name: string): Promise<ICanvasEffect | null> => {
        if (!name) return null;
        let effect: ICanvasEffect | null = effectsRef.current.get(name) || null;
        if (effect === null) {
            const definition = CHAT_EFFECTS.find((e) => e.command === name)!;
            try {
                effect = await definition.getRenderer();
                effectsRef.current.set(name, effect);
            } catch (err) {
                logger.warn(`Unable to run effect module.`, err);
            }
        }
        return effect;
    };

    useEffect(() => {
        let release: ReturnType<typeof setInterval> | undefined;
        const resize = (): void => {
            // Only a canvas in use has a size to keep up to date.
            if (
                release !== undefined &&
                canvasRef.current &&
                canvasRef.current.height !== UIStore.instance.windowHeight
            ) {
                canvasRef.current.height = UIStore.instance.windowHeight;
            }
        };
        const sizeForEffect = (canvas: HTMLCanvasElement): void => {
            canvas.width = getRoomWidthRef.current();
            canvas.height = UIStore.instance.windowHeight;
            clearInterval(release);
            release = setInterval(() => {
                if ([...effectsRef.current.values()].some((effect) => effect.isRunning)) return;
                clearInterval(release);
                release = undefined;
                canvas.width = 0;
                canvas.height = 0;
            }, RELEASE_CHECK_MS);
        };
        const onAction = (payload: { action: string; event?: MatrixEvent }): void => {
            const actionPrefix = "effects.";
            const isOutdated = isEventOutdated(payload.event);
            if (canvasRef.current && payload.action.startsWith(actionPrefix) && !isOutdated) {
                const effect = payload.action.slice(actionPrefix.length);
                void lazyLoadEffectModule(effect).then((module) => {
                    const canvas = canvasRef.current;
                    if (!module || !canvas) return;
                    sizeForEffect(canvas);
                    return module.start(canvas);
                });
            }
        };
        const dispatcherRef = dis.register(onAction);
        UIStore.instance.on(UI_EVENTS.Resize, resize);

        const currentEffects = effectsRef.current; // this is not a react node ref, warning can be safely ignored
        return () => {
            dis.unregister(dispatcherRef);
            UIStore.instance.off(UI_EVENTS.Resize, resize);
            clearInterval(release);
            for (const effect in currentEffects) {
                const effectModule: ICanvasEffect = currentEffects.get(effect)!;
                if (effectModule && effectModule.isRunning) {
                    void effectModule.stop();
                }
            }
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={0}
            height={0}
            style={{
                display: "block",
                zIndex: 999999,
                pointerEvents: "none",
                position: "fixed",
                top: 0,
                right: 0,
            }}
            aria-hidden={true}
        />
    );
};

export default EffectsOverlay;

// 48 hours
// 48h * 60m * 60s * 1000ms
const OUTDATED_EVENT_THRESHOLD = 48 * 60 * 60 * 1000;

/**
 * Return true if the event is older than 48h.
 * @param event
 */
function isEventOutdated(event?: MatrixEvent): boolean {
    if (!event) return false;

    const nowTs = Date.now();
    const eventTs = event.getTs();
    return nowTs - eventTs > OUTDATED_EVENT_THRESHOLD;
}
