import { AudioMetadata } from '../api/protocol';

export class SyncController {
    private metadata: AudioMetadata[] = [];

    addMetadata(items: AudioMetadata[]): void {
        this.metadata.push(...items);
        // Sort just in case order is mixed? Usually sorted by time.
        // this.metadata.sort((a, b) => a.offset - b.offset); 
    }

    findActiveMetadata(currentTimeInSeconds: number): AudioMetadata | null {
        if (this.metadata.length === 0) return null;

        // Convert seconds to 100ns units to match Edge TTS format
        const currentTicks = currentTimeInSeconds * 10000000;

        let left = 0;
        let right = this.metadata.length - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const item = this.metadata[mid];
            if (!item) break; // Should not happen

            const end = item.offset + item.duration;

            if (currentTicks >= item.offset && currentTicks < end) {
                return item;
            }

            if (currentTicks < item.offset) {
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }

        return null;
    }

    reset(): void {
        this.metadata = [];
    }

    getLastEndTime(): number {
        if (this.metadata.length === 0) return 0;
        const last = this.metadata[this.metadata.length - 1];
        if (!last) return 0;
        return last.offset + last.duration;
    }
}
