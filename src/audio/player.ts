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
            const chunk = this.queue.shift();
            if (chunk) {
                try {
                    this.sourceBuffer.appendBuffer(chunk as any);
                } catch (e) {
                    console.error('[VoxTrack] Append failed', e);
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
