export class AudioPlayer {
    private audio: HTMLAudioElement;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
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

    async initSource(): Promise<void> {
        this.isStopped = false;
        return new Promise((resolve) => {
            this.mediaSource = new MediaSource();
            this.audio.src = URL.createObjectURL(this.mediaSource);

            this.mediaSource.addEventListener('sourceopen', () => {
                if (this.isStopped || !this.mediaSource) return;
                
                if (!this.sourceBuffer) {
                    this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
                    this.sourceBuffer.addEventListener('updateend', () => {
                        if (!this.isStopped) this.processQueue();
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
        if (this.isStopped || !this.sourceBuffer || this.sourceBuffer.updating || !this.mediaSource || this.mediaSource.readyState !== 'open') {
            return;
        }

        if (this.queue.length > 0) {
            const chunk = this.queue[0];
            if (chunk) {
                try {
                    this.sourceBuffer.appendBuffer(chunk as any);
                    this.queue.shift();
                } catch (e: any) {
                    if (e.name === 'QuotaExceededError') {
                        // Log only once per minute to reduce noise
                        this.cleanupBuffer();
                    } else if (e.name === 'InvalidStateError') {
                        // SourceBuffer was detached, ignore this task
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
            } catch (e) {
                console.error('[VoxTrack] EndOfStream failed', e);
            }
        }
    }

    private cleanupBuffer() {
        if (this.isStopped || !this.sourceBuffer || this.sourceBuffer.updating) return;

        const currentTime = this.audio.currentTime;
        const buffered = this.sourceBuffer.buffered;
        
        // Strategy: Keep 10 seconds behind current time if possible, 
        // but if we are really stuck, allow cleaning up to 2 seconds behind.
        let removeEnd = currentTime - 10;
        if (buffered.length > 0 && removeEnd < buffered.start(0)) {
            removeEnd = currentTime - 2;
        }

        if (buffered.length > 0 && removeEnd > buffered.start(0)) {
            try {
                this.sourceBuffer.remove(buffered.start(0), removeEnd);
            } catch (e) {
                console.error('[VoxTrack] Buffer cleanup failed', e);
            }
        } else {
            // Memory threshold warning: If queue grows too large (> 100MB roughly)
            const estimatedQueueSize = this.queue.length * 32000; // Average chunk size
            if (estimatedQueueSize > 100 * 1024 * 1024) {
                console.warn('[VoxTrack] Audio RAM queue is getting large. Playback might be too slow.');
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
        try {
            this.audio.load(); // Release MediaSource
        } catch (e) {}
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

