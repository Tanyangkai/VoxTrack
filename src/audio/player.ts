export class AudioPlayer {
    private audio: HTMLAudioElement;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private objectUrl: string | null = null;
    private queue: Uint8Array[] = [];
    private isPlaying = false;
    private isStopped = false;
    private isInputFinished = false;
    private onCompleteCallback: (() => void) | null = null;

    constructor() {
        this.audio = new Audio();
        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            if (this.onCompleteCallback) this.onCompleteCallback();
        });
    }

    onComplete(callback: () => void) {
        this.onCompleteCallback = callback;
    }

    setPlaybackRate(rate: number): void {
        this.audio.playbackRate = rate;
    }

    addChunk(data: Uint8Array) {
        if (this.isStopped) return;
        this.queue.push(data);
        this.processQueue();
    }

    finish() {
        this.isInputFinished = true;
        this.processQueue();
    }

    initSource(): Promise<void> {
        this.isStopped = false;
        return new Promise((resolve) => {
            this.mediaSource = new MediaSource();
            this.objectUrl = URL.createObjectURL(this.mediaSource);
            this.audio.src = this.objectUrl;

            this.mediaSource.addEventListener('sourceopen', () => {
                if (this.isStopped || !this.mediaSource) return;

                if (!this.sourceBuffer) {
                    try {
                        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
                        this.sourceBuffer.mode = 'sequence'; // Ensure chunks are stitched linearly
                        this.sourceBuffer.addEventListener('updateend', () => {
                            if (!this.isStopped) this.processQueue();
                        });
                        this.sourceBuffer.addEventListener('error', (_e) => {
                            console.error('[VoxTrack] SourceBuffer Error', _e);
                        });
                    } catch (e) {
                        console.error('[VoxTrack] Failed to add SourceBuffer', e);
                    }
                }
                resolve();
            });
        });
    }

    private processQueue() {
        if (this.isStopped || !this.sourceBuffer || this.sourceBuffer.updating || !this.mediaSource || this.mediaSource.readyState !== 'open') {
            return;
        }

        if (this.queue.length > 0) {
            const chunk = this.queue[0];
            if (chunk) {
                try {
                    // Cast to unknown then BufferSource to satisfy TS strictness regarding SharedArrayBuffer
                    this.sourceBuffer.appendBuffer(chunk as unknown as BufferSource);
                    this.queue.shift();
                } catch (e) {
                    if (e instanceof Error && e.name === 'QuotaExceededError') {
                        this.cleanupBuffer(true); // Force cleanup when buffer is full
                    } else if (e instanceof Error && e.name === 'InvalidStateError') {
                        console.debug('[VoxTrack] Append failed due to InvalidState');
                    } else {
                        console.error('[VoxTrack] Append failed', e);
                        this.queue.shift();
                    }
                }
            }
        } else if (this.isInputFinished && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch {
                // Silently fail if stream already ended
            }
        }
    }

    private cleanupBuffer(force = false) {
        if (this.isStopped || !this.sourceBuffer || this.sourceBuffer.updating) return;

        const currentTime = this.audio.currentTime;
        const buffered = this.sourceBuffer.buffered;

        // Strategy: Keep 10 seconds behind current time if possible.
        // If force is true (QuotaExceeded), we must remove something to recover.
        let removeEnd = currentTime - 10;
        
        if (buffered.length > 0) {
            const start = buffered.start(0);
            if (removeEnd < start) {
                removeEnd = currentTime - 2;
            }

            // If still cannot find a range and force is requested
            if (force && removeEnd <= start) {
                removeEnd = currentTime - 0.5; // Desperate removal
            }

            if (removeEnd > start) {
                try {
                    this.sourceBuffer.remove(start, removeEnd);
                } catch (_e) {
                    console.error('[VoxTrack] Buffer cleanup failed', _e);
                    // Schedule a retry if we are stuck
                    setTimeout(() => {
                        if (!this.sourceBuffer?.updating) this.processQueue();
                    }, 1000);
                }
            } else if (force) {
                console.warn('[VoxTrack] Buffer full but cannot remove past data.');
            }
        }
    }

    async play(): Promise<void> {
        if (this.isPlaying || this.isStopped) return;

        try {
            await this.audio.play();
            this.isPlaying = true;
        } catch (e) {
            console.warn('[VoxTrack] Playback pending user interaction', e);
        }
    }

    getBufferedEnd(): number {
        if (this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
            return this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length - 1);
        }
        return 0;
    }

    getCurrentTime(): number {
        return this.audio.currentTime;
    }

    pause(): void {
        this.audio.pause();
        this.isPlaying = false;
    }

    stop(): void {
        this.isStopped = true;
        this.audio.pause();
        this.audio.removeAttribute('src');
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        try {
            this.audio.load(); // Release MediaSource
        } catch { /* ignore */ }
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.queue = [];
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch { /* ignore */ }
        }
    }

    reset(): void {
        this.stop();
        this.sourceBuffer = null;
        this.mediaSource = null;
        this.isInputFinished = false;
    }

    destroy(): void {
        this.stop();
        this.audio.replaceWith(this.audio.cloneNode(true)); // Remove all listeners
        this.onCompleteCallback = null;
    }
}

