/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type MatrixEvent,
    MatrixEventEvent,
    type Relations,
    RelationsEvent,
    TypedEventEmitter,
} from "matrix-js-sdk/src/matrix";

import { type GetRelationsForEvent } from "../components/views/rooms/EventTile";

type EventHandlerMap = {
    [RelationsEvent.Add]: (event: MatrixEvent) => void;
    [RelationsEvent.Remove]: (event: MatrixEvent) => void;
    [RelationsEvent.Redaction]: (event: MatrixEvent) => void;
};

const REL_TYPE = "m.annotation";
const EVENT_TYPE = "m.reaction";

/**
 * A read-only, `Relations`-shaped view over the reactions of several events (the items of a media album).
 *
 * It implements the subset of the `Relations` API used by the reactions row, the reaction picker and the
 * message context menu (`getRelations`, `getSortedAnnotationsByKey`, `getAnnotationsBySender` and the
 * Add/Remove/Redaction events), so it can be handed to an EventTile in place of the anchor's own relations.
 *
 * Toggling a reaction the user already sent on any item redacts that reaction (wherever it lives);
 * new reactions are sent to the tile's event (the album anchor).
 */
export class AggregatedRelations extends TypedEventEmitter<RelationsEvent, EventHandlerMap> {
    private items: MatrixEvent[] = [];
    private readonly attached = new Map<MatrixEvent, Relations>();
    private readonly waiting = new Map<MatrixEvent, (relType: string, eventType: string) => void>();

    public constructor(private getBase: GetRelationsForEvent) {
        super();
    }

    /** Updates the set of events whose reactions are aggregated. Emits a change if it differs. */
    public setItems(items: MatrixEvent[], getBase: GetRelationsForEvent = this.getBase): void {
        const baseChanged = getBase !== this.getBase;
        this.getBase = getBase;
        const same = !baseChanged && items.length === this.items.length && items.every((ev, i) => ev === this.items[i]);
        if (same) return;

        const next = new Set(items);
        for (const ev of this.items) {
            if (baseChanged || !next.has(ev)) this.detach(ev);
        }
        this.items = [...items];
        for (const ev of this.items) this.attach(ev);
        this.emitChange();
    }

    public getItems(): readonly MatrixEvent[] {
        return this.items;
    }

    /** Stops listening to all underlying relations. */
    public destroy(): void {
        for (const ev of [...this.attached.keys(), ...this.waiting.keys()]) this.detach(ev);
        this.items = [];
        this.removeAllListeners();
    }

    private readonly onUnderlyingChange = (event: MatrixEvent): void => {
        this.emit(RelationsEvent.Add, event);
    };

    private emitChange(): void {
        if (this.items[0]) this.emit(RelationsEvent.Add, this.items[0]);
    }

    private attach(ev: MatrixEvent): void {
        if (this.attached.has(ev) || this.waiting.has(ev)) return;
        const id = ev.getId();
        const relations = id ? this.getBase(id, REL_TYPE, EVENT_TYPE) : undefined;
        if (relations) {
            relations.on(RelationsEvent.Add, this.onUnderlyingChange);
            relations.on(RelationsEvent.Remove, this.onUnderlyingChange);
            relations.on(RelationsEvent.Redaction, this.onUnderlyingChange);
            this.attached.set(ev, relations);
            return;
        }
        // No reactions yet: wait until the timeline set creates the container for this event.
        const onCreated = (relType: string, eventType: string): void => {
            if (relType !== REL_TYPE || eventType !== EVENT_TYPE) return;
            ev.off(MatrixEventEvent.RelationsCreated, onCreated);
            this.waiting.delete(ev);
            this.attach(ev);
            this.emitChange();
        };
        ev.on(MatrixEventEvent.RelationsCreated, onCreated);
        this.waiting.set(ev, onCreated);
    }

    private detach(ev: MatrixEvent): void {
        const relations = this.attached.get(ev);
        if (relations) {
            relations.off(RelationsEvent.Add, this.onUnderlyingChange);
            relations.off(RelationsEvent.Remove, this.onUnderlyingChange);
            relations.off(RelationsEvent.Redaction, this.onUnderlyingChange);
            this.attached.delete(ev);
        }
        const onCreated = this.waiting.get(ev);
        if (onCreated) {
            ev.off(MatrixEventEvent.RelationsCreated, onCreated);
            this.waiting.delete(ev);
        }
    }

    private underlying(): Relations[] {
        return this.items.map((ev) => this.attached.get(ev)).filter((r): r is Relations => !!r);
    }

    public getRelations(): MatrixEvent[] {
        return this.underlying().flatMap((r) => r.getRelations());
    }

    /** Same shape as `Relations#getSortedAnnotationsByKey`: keys ordered by descending number of reactions. */
    public getSortedAnnotationsByKey(): [string, Set<MatrixEvent>][] | null {
        const byKey = new Map<string, Set<MatrixEvent>>();
        for (const relations of this.underlying()) {
            for (const [key, events] of relations.getSortedAnnotationsByKey() ?? []) {
                const merged = byKey.get(key) ?? new Set<MatrixEvent>();
                events.forEach((e) => merged.add(e));
                byKey.set(key, merged);
            }
        }
        if (byKey.size === 0) return null;
        return [...byKey.entries()].sort((a, b) => b[1].size - a[1].size);
    }

    public getAnnotationsBySender(): Record<string, Set<MatrixEvent>> | null {
        const bySender: Record<string, Set<MatrixEvent>> = {};
        let any = false;
        for (const relations of this.underlying()) {
            for (const [sender, events] of Object.entries(relations.getAnnotationsBySender() ?? {})) {
                const merged = (bySender[sender] ??= new Set<MatrixEvent>());
                events.forEach((e) => merged.add(e));
                any = true;
            }
        }
        return any ? bySender : null;
    }

    /** Typed as `Relations` for consumers that only use the aggregated read API. */
    public asRelations(): Relations {
        return this as unknown as Relations;
    }
}
