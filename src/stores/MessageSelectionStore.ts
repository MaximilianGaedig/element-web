/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import EventEmitter from "events";
import { UPDATE_EVENT } from "./AsyncStore";

/**
 * Store for managing message selection in the timeline.
 */
export class MessageSelectionStore extends EventEmitter {
    private static internalInstance = new MessageSelectionStore();

    private selections = new Map<string, Set<string>>(); // roomId -> selectedEventIds
    private lastSelectedIds = new Map<string, string | null>(); // roomId -> lastSelectedId
    private anchorIds = new Map<string, string | null>(); // roomId -> anchorId

    public static get instance(): MessageSelectionStore {
        return MessageSelectionStore.internalInstance;
    }

    public getLastId(roomId: string): string | null {
        return this.lastSelectedIds.get(roomId) ?? null;
    }

    public getAnchorId(roomId: string): string | null {
        return this.anchorIds.get(roomId) ?? null;
    }

    public isSelecting(roomId: string): boolean {
        return this.selections.has(roomId);
    }

    public getSelectedIds(roomId: string): string[] {
        const set = this.selections.get(roomId);
        return set ? Array.from(set) : [];
    }

    public isSelected(roomId: string, eventId: string): boolean {
        return this.selections.get(roomId)?.has(eventId) ?? false;
    }

    public getCount(roomId: string): number {
        return this.selections.get(roomId)?.size ?? 0;
    }

    public enterSelectionMode(roomId: string, initialEventId?: string): void {
        if (!this.selections.has(roomId)) {
            this.selections.set(roomId, new Set());
        }
        const set = this.selections.get(roomId)!;
        if (initialEventId) {
            set.add(initialEventId);
            this.lastSelectedIds.set(roomId, initialEventId);
            this.anchorIds.set(roomId, initialEventId);
        }
        this.emit(UPDATE_EVENT);
    }

    public setAnchorId(roomId: string, eventId: string | null): void {
        this.anchorIds.set(roomId, eventId);
    }

    public exitSelectionMode(roomId: string): void {
        this.selections.delete(roomId);
        this.lastSelectedIds.delete(roomId);
        this.anchorIds.delete(roomId);
        this.emit(UPDATE_EVENT);
    }

    public toggleSelection(roomId: string, eventId: string): void {
        const set = this.selections.get(roomId);
        if (!set) return;

        if (set.has(eventId)) {
            set.delete(eventId);
        } else {
            set.add(eventId);
        }
        this.lastSelectedIds.set(roomId, eventId);
        this.anchorIds.set(roomId, eventId);
        this.emit(UPDATE_EVENT);
    }

    public selectRange(roomId: string, eventIds: string[]): void {
        const set = this.selections.get(roomId);
        if (!set) return;

        for (const id of eventIds) {
            set.add(id);
        }
        this.emit(UPDATE_EVENT);
    }

    public clearSelection(roomId: string): void {
        this.selections.get(roomId)?.clear();
        this.emit(UPDATE_EVENT);
    }
}
