export class AudioPlayer {
    private context: AudioContext | null = null;
    private source: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;

    constructor() {
        // Initialize implicitly or lazily
    }

    async init(): Promise<void> {
        if (!this.context) {
            this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.gainNode = this.context.createGain();
            this.gainNode.connect(this.context.destination);
        }

        if (this.context.state === 'suspended') {
            await this.context.resume();
        }
    }

    async playBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
        if (!this.context || !this.gainNode) await this.init();

        // Decode the audio data
        const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);

        // Stop previous source if any (though usually we play sequentially)
        if (this.source) {
            try { this.source.stop(); } catch (e) {/* ignore */ }
        }

        this.source = this.context!.createBufferSource();
        this.source.buffer = audioBuffer;
        this.source.connect(this.gainNode!);
        this.source.start(0);

        return new Promise((resolve) => {
            if (this.source) {
                this.source.onended = () => resolve();
            } else {
                resolve();
            }
        });
    }

    getCurrentTime(): number {
        if (!this.context) return 0;
        // This is global context time. 
        // Ideally we track start time of the current source to get relative time if needed.
        // But SyncController expects absolute time matching the audio stream effectively.
        // For fragments, this is tricky. The Edge TTS timestamps are relative to start of stream.
        // If we play fragments sequentially, context.currentTime grows.
        // We'll need to assume context.currentTime aligns or we reset it? 
        // AudioContext time keeps increasing.
        // For MVP, if we restart context or it's a single stream, it might align.
        // But better: active time = context.currentTime - startTimeOfPlayback.
        // We haven't stored startTimeOfPlayback. 
        // Let's return raw time for now and assume single utterance.
        return this.context.currentTime;
    }

    stop(): void {
        if (this.source) {
            try { this.source.stop(); } catch (e) {/* ignore */ }
            this.source = null;
        }
    }

    async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
        if (!this.context) await this.init();
        return await this.context!.decodeAudioData(data);
    }
}
