import { FileLogger } from '../utils/logger';

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
    private isBufferFull = false;
    private lastCleanupAttemptTime = -1;
    private pendingSeekTime: number | null = null;

    private playbackRate = 1.0;

    constructor() {
        this.audio = new Audio();
        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            if (this.onCompleteCallback) this.onCompleteCallback();
        });
    }

    private handleTimeUpdate = () => {
        if (!this.isBufferFull) return;
        
        // Throttling: Check more frequently (every 0.2s) to clear buffer ASAP when stuck
        if (Math.abs(this.audio.currentTime - this.lastCleanupAttemptTime) < 0.2) {
            return;
        }
        
        this.lastCleanupAttemptTime = this.audio.currentTime;

        // Pass true to suppress warning because we expect it might fail repeatedly until time advances enough
        if (this.cleanupBuffer(true, true)) {
             // Success
             this.isBufferFull = false;
             this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
             this.processQueue();
        }
    };

    onComplete(callback: () => void) {
        this.onCompleteCallback = callback;
    }

    setPendingSeek(time: number) {
        this.pendingSeekTime = time;
    }

    private checkPendingSeek() {
        if (this.pendingSeekTime !== null && this.sourceBuffer && !this.sourceBuffer.updating) {
            const buffered = this.sourceBuffer.buffered;
            for (let i = 0; i < buffered.length; i++) {
                const start = buffered.start(i);
                const end = buffered.end(i);
                // Check if the seek target is within a buffered range (with slight tolerance)
                if (this.pendingSeekTime >= start && this.pendingSeekTime < end) {
                    void FileLogger.debug(`[VoxTrack] Executing pending seek to ${this.pendingSeekTime} (Buffer: ${start}-${end})`);
                    this.audio.currentTime = this.pendingSeekTime;
                    this.pendingSeekTime = null;
                    // If player state is logically 'playing', resume playback now that we've seeked
                    if (this.isPlaying) {
                         void this.play();
                    }
                    return;
                }
            }
        }
    }

    setPlaybackRate(rate: number): void {
        this.playbackRate = rate;
        this.audio.playbackRate = rate;
    }

    waitForQueueEmpty(timeoutMs = 5000): Promise<void> {
        return new Promise((resolve) => {
            const check = () => {
                const isUpdating = this.sourceBuffer?.updating ?? false;
                if (this.queue.length === 0 && !isUpdating) {
                    resolve();
                } else {
                    // Poll or wait for event?
                    // Since we processQueue on updateend, we can just poll for safety or hook into processQueue.
                    // But polling is safer against missed events in complex state.
                    // Let's us a simple polling with backoff or just re-check.
                    // Actually, let's just use a one-off listener if updating, but valid check involves queue too.
                    setTimeout(check, 50);
                }
            };
            check();

            // Timeout safety
            setTimeout(() => resolve(), timeoutMs);
        });
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

                // Re-apply playback rate because source reset might have cleared it
                this.audio.playbackRate = this.playbackRate;

                if (!this.sourceBuffer) {
                    try {
                        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
                        this.sourceBuffer.mode = 'sequence'; // Ensure chunks are stitched linearly
                        this.sourceBuffer.addEventListener('updateend', () => {
                            if (!this.isStopped) this.processQueue();
                        });
                        this.sourceBuffer.addEventListener('error', (_e) => {
                            void FileLogger.error('[VoxTrack] SourceBuffer Error', _e);
                        });
                    } catch (e) {
                        void FileLogger.error('[VoxTrack] Failed to add SourceBuffer', e);
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

        this.checkPendingSeek();

        // If buffer is full and we are waiting for time update, do not attempt to append
        if (this.isBufferFull) return;

        if (this.queue.length > 0) {
            const chunk = this.queue[0];
            if (chunk) {
                try {
                    // Cast to unknown then BufferSource to satisfy TS strictness regarding SharedArrayBuffer
                    this.sourceBuffer.appendBuffer(chunk as unknown as BufferSource);
                    this.queue.shift();
                } catch (e) {
                    if (e instanceof Error && e.name === 'QuotaExceededError') {
                        // Attempt to clean up buffer to free space.
                        // If cleanup succeeds (returns true), 'updateend' event from remove() will trigger processQueue again.
                        // We should NOT recursive call processQueue here.
                        if (!this.cleanupBuffer(true)) {
                             // Failed to cleanup immediately (e.g. no past data)
                             if (!this.isBufferFull) {
                                 this.isBufferFull = true;
                                 this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
                             }
                             // Stop processing until space is freed via handleTimeUpdate
                        }
                    } else if (e instanceof Error && e.name === 'InvalidStateError') {
                        void FileLogger.debug('[VoxTrack] Append failed due to InvalidState');
                    } else {
                        void FileLogger.error('[VoxTrack] Append failed', e);
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

    private cleanupBuffer(force = false, suppressWarning = false): boolean {
        if (this.isStopped || !this.sourceBuffer || this.sourceBuffer.updating) return false;

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
                    return true;
                } catch (_e) {
                    void FileLogger.error('[VoxTrack] Buffer cleanup failed', _e);
                    // Schedule a retry if we are stuck
                    setTimeout(() => {
                        if (!this.sourceBuffer?.updating) this.processQueue();
                    }, 1000);
                    return false;
                }
            } else if (force && !suppressWarning) {
                void FileLogger.warn('[VoxTrack] Buffer full but cannot remove past data.');
            }
        }
        return false;
    }

    async play(): Promise<void> {
        if (this.isStopped) return;

        // Mark intent to play
        this.isPlaying = true;

        // If pending seek, defer actual playback until seek is complete
        if (this.pendingSeekTime !== null) {
            return;
        }

        try {
            await this.audio.play();
        } catch (e) {
            void FileLogger.warn('[VoxTrack] Playback pending user interaction', e);
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
        this.isBufferFull = false;
        this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
        
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

    clearFutureBuffer(): void {
        this.queue = []; // Clear pending chunks
        if (this.sourceBuffer && !this.sourceBuffer.updating && this.mediaSource?.readyState === 'open') {
            try {
                const currentTime = this.audio.currentTime;
                // Leave a tiny buffer (0.1s) to avoid stalling immediately if possible
                const end = this.sourceBuffer.buffered.length > 0 ? this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length - 1) : 0;
                if (end > currentTime + 0.1) {
                    this.sourceBuffer.remove(currentTime + 0.1, end);
                }
            } catch (e) {
                void FileLogger.warn('[VoxTrack] Failed to clear future buffer', e);
            }
        }
        // Do NOT reset isInputFinished here blindly, it depends on context, but usually for retry we want to keep stream open.
    }

    async restartAt(time: number): Promise<void> {
        // Full reset to ensure clean state
        this.reset();
        this.pendingSeekTime = null;
        await this.initSource();
        
        // Align buffer and playhead to the chunk start time
        if (this.sourceBuffer) {
            this.sourceBuffer.timestampOffset = time;
        }
        this.audio.currentTime = time;
        this.isStopped = false; // Ensure not stopped
    }

    destroy(): void {
        this.stop();
        this.audio.replaceWith(this.audio.cloneNode(true)); // Remove all listeners
        this.onCompleteCallback = null;
    }
}

