export class AudioBufferManager {
    private queue: AudioBuffer[] = [];

    enqueue(buffer: AudioBuffer): void {
        this.queue.push(buffer);
    }

    dequeue(): AudioBuffer | undefined {
        return this.queue.shift();
    }

    clear(): void {
        this.queue = [];
    }

    isEmpty(): boolean {
        return this.queue.length === 0;
    }

    hasItems(): boolean {
        return this.queue.length > 0;
    }
}
