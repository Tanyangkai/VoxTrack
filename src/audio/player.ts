export class AudioPlayer {
    private audio: HTMLAudioElement;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private queue: Uint8Array[] = [];
    private isPlaying = false;
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
        this.queue.push(data);
        this.processQueue();
    }

    finish() {
        this.isInputFinished = true;
        this.processQueue();
    }

    async initSource(): Promise<void> {
        return new Promise((resolve) => {
            this.mediaSource = new MediaSource();
            this.audio.src = URL.createObjectURL(this.mediaSource);

            this.mediaSource.addEventListener('sourceopen', () => {
                if (!this.sourceBuffer && this.mediaSource) {
                    this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
                    this.sourceBuffer.addEventListener('updateend', () => {
                        this.processQueue();
                    });
                    this.sourceBuffer.addEventListener('error', (e) => {
                        console.error('[VoxTrack] SourceBuffer Error', e);
                    });
                }
                resolve();
            });
        });
    }

    private processQueue() {
        if (!this.sourceBuffer || this.sourceBuffer.updating) {
            return;
        }

        if (this.queue.length > 0) {
            // Peek instead of shift first, to keep it if append fails
            const chunk = this.queue[0];
            if (chunk) {
                try {
                    this.sourceBuffer.appendBuffer(chunk as any);
                    // Only shift if successful
                    this.queue.shift();
                } catch (e: any) {
                    if (e.name === 'QuotaExceededError') {
                        console.warn('[VoxTrack] Buffer full, cleaning up...');
                        this.cleanupBuffer();
                    } else {
                        console.error('[VoxTrack] Append failed', e);
                        // If it's another error, we might want to discard this chunk to avoid infinite loop
                        this.queue.shift();
                    }
                }
            }
        } else if (this.isInputFinished && this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                console.error('[VoxTrack] EndOfStream failed', e);
            }
        }
    }

    private cleanupBuffer() {
        if (!this.sourceBuffer || this.sourceBuffer.updating) return;

        const currentTime = this.audio.currentTime;
        const buffered = this.sourceBuffer.buffered;
        
        // Keep last 10 seconds behind current time
        const removeEnd = currentTime - 10;

        if (buffered.length > 0 && removeEnd > buffered.start(0)) {
            try {
                // Remove from start of buffer up to safe point
                // Note: remove() triggers 'updateend', which will call processQueue again
                this.sourceBuffer.remove(buffered.start(0), removeEnd);
                console.log(`[VoxTrack] Cleaned buffer up to ${removeEnd.toFixed(2)}s`);
            } catch (e) {
                console.error('[VoxTrack] Buffer cleanup failed', e);
            }
        } else {
            // If we can't remove anything but quota is full, we are stuck.
            // This happens if the user pauses and a massive amount of data comes in for the FUTURE.
            // In this case, we might need to wait for playback to advance.
            console.warn('[VoxTrack] Cannot clean buffer yet (current time too close to start). Waiting...');
            // Try again in 1 second
            setTimeout(() => this.processQueue(), 1000);
        }
    }

    async play(): Promise<void> {
        if (this.isPlaying) return;

        try {
            await this.audio.play();
            this.isPlaying = true;
            console.log('[VoxTrack] Playback started');
        } catch (e) {
            // Auto-play might be blocked until user interaction
            console.warn('[VoxTrack] Playback pending user interaction', e);
        }
    }

    getCurrentTime(): number {
        return this.audio.currentTime;
    }

    pause(): void {
        this.audio.pause();
        this.isPlaying = false;
    }

    stop(): void {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load(); // Force release of MediaSource
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.queue = [];
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) { }
        }
    }

    reset(): void {
        this.stop();
        this.sourceBuffer = null;
        this.mediaSource = null;
        this.isInputFinished = false;
    }
}
