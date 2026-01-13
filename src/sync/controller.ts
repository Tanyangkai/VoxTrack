import { AudioMetadata } from '../api/protocol';
import { FileLogger } from '../utils/logger';

export class SyncController {
    private metadata: AudioMetadata[] = [];
    private lastChunkIndex: number = -1;

    addMetadata(items: AudioMetadata[]): void {
        this.metadata.push(...items);
        // Sort by offset to ensure binary search works
        this.metadata.sort((a, b) => a.offset - b.offset);
    }

    findActiveMetadata(currentTimeInSeconds: number): AudioMetadata | null {
        if (this.metadata.length === 0) return null;

        const currentTicks = currentTimeInSeconds * 10000000;
        // FileLogger.debug('Sync: Seek', { t: currentTimeInSeconds, ticks: currentTicks });

        let left = 0;
        let right = this.metadata.length - 1;
        let foundIdx = -1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const item = this.metadata[mid];
            if (!item) {
                // Should not happen if metadata is dense, but satisfy TS
                left++;
                continue;
            }
            const end = item.offset + item.duration;

            if (currentTicks >= item.offset && currentTicks < end) {
                foundIdx = mid;
                break;
            }

            if (currentTicks < item.offset) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        if (foundIdx === -1) return null;

        // Collect all potential matches that cover this timestamp (due to overlaps)
        const candidates: AudioMetadata[] = [];

        // Scan backwards from foundIdx
        for (let i = foundIdx; i >= 0; i--) {
            const m = this.metadata[i];
            if (!m) continue;
            if (currentTicks < m.offset) continue; // Not there yet
            if (currentTicks >= m.offset && currentTicks < m.offset + m.duration) {
                candidates.push(m);
            }
            // Optimization: stop if we are way before the timestamp
            if (currentTicks - m.offset > 10000000) break;
        }

        // Scan forwards from foundIdx
        for (let i = foundIdx + 1; i < this.metadata.length; i++) {
            const m = this.metadata[i];
            if (!m) break;
            if (m.offset > currentTicks) break; // Past the timestamp
            if (currentTicks >= m.offset && currentTicks < m.offset + m.duration) {
                candidates.push(m);
            }
        }

        if (candidates.length === 0) return null;

        // Filter candidates:
        // 1. Prefer current chunk (lastChunkIndex) if it's still valid
        // 2. Otherwise, prefer highest chunkIndex >= lastChunkIndex

        let best: AudioMetadata | null = null;

        // First pass: try to find a candidate in the same chunk we are already in
        if (this.lastChunkIndex !== -1) {
            for (const c of candidates) {
                if (c.chunkIndex === this.lastChunkIndex) {
                    best = c;
                    break;
                }
            }
        }

        // Second pass: if not found in current chunk, find the best forward candidate
        if (!best) {
            for (const c of candidates) {
                const cIdx = c.chunkIndex ?? 0;
                if (cIdx >= this.lastChunkIndex) {
                    if (!best || cIdx > (best.chunkIndex ?? 0)) {
                        best = c;
                    }
                }
            }
        }

        if (best) {
            if (best.chunkIndex !== this.lastChunkIndex) {
                // FileLogger.debug('Sync: Chunk Change', { from: this.lastChunkIndex, to: best.chunkIndex, text: best.text });
            }
            this.lastChunkIndex = best.chunkIndex ?? this.lastChunkIndex;
        } else {
            // FileLogger.debug('Sync: No Best Candidate', { candidates: candidates.length });
        }

        return best;
    }

    reset(): void {
        this.metadata = [];
        this.lastChunkIndex = -1;
    }

    getLastEndTime(): number {
        if (this.metadata.length === 0) return 0;
        const last = this.metadata[this.metadata.length - 1];
        if (!last) return 0;
        return last.offset + last.duration;
    }

    removeChunk(chunkIndex: number): void {
        this.metadata = this.metadata.filter(m => m.chunkIndex !== chunkIndex);
    }

    findMetadataByTextOffset(textOffset: number, chunkIndex: number): AudioMetadata | null {
        let best: AudioMetadata | null = null;
        
        for (const item of this.metadata) {
            if (item.chunkIndex !== chunkIndex) continue;
            if (item.textOffset === undefined) continue;
            
            // Find the closest metadata that starts before or at the target offset
            if (item.textOffset <= textOffset) {
                if (!best || (best.textOffset !== undefined && item.textOffset > best.textOffset)) {
                    best = item;
                }
            }
        }
        return best;
    }

    findClosestMetadata(currentTimeInSeconds: number): AudioMetadata | null {
        if (this.metadata.length === 0) return null;
        const currentTicks = currentTimeInSeconds * 10000000;
        
        // Binary search for insertion point
        let left = 0;
        let right = this.metadata.length - 1;
        let bestIdx = -1;

        // Find the latest item that starts before currentTicks
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midItem = this.metadata[mid];
            if (midItem && midItem.offset <= currentTicks) {
                bestIdx = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        if (bestIdx !== -1) {
            return this.metadata[bestIdx] || null;
        }
        return null; // Should usually not happen if time > 0 and metadata exists
    }
}
