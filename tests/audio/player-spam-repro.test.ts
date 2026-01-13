
import { AudioPlayer } from '../../src/audio/player';
import { FileLogger } from '../../src/utils/logger';

// Enhanced Mock Browser APIs for precise timing simulation
class MockSourceBuffer {
    public updating: boolean = false;
    public buffered: any = {
        length: 1,
        start: (i: number) => 0,
        end: (i: number) => 10 // Start with some buffer
    };
    private _data: Uint8Array[] = [];
    private listeners: any = {};
    public shouldThrowQuota: boolean = false;

    addEventListener(event: string, callback: any) {
        this.listeners[event] = callback;
    }

    appendBuffer(data: BufferSource) {
        if (this.shouldThrowQuota) {
            const error = new Error('QuotaExceededError');
            error.name = 'QuotaExceededError';
            throw error;
        }

        this.updating = true;
        this._data.push(new Uint8Array(data as ArrayBuffer));

        setTimeout(() => {
            this.updating = false;
            // Just extend buffer for simplicity
            const currentEnd = this.buffered.end(0);
            this.buffered = {
                length: 1,
                start: () => 0,
                end: () => currentEnd + 1
            };

            if (this.listeners['updateend']) {
                this.listeners['updateend']();
            }
        }, 10);
    }

    remove(start: number, end: number) {
        this.updating = true;
        setTimeout(() => {
            this.updating = false;
            // Mock removal by adjusting start time
            const currentEnd = this.buffered.end(0);
            const currentStart = this.buffered.start(0);
            
            // new start should be max of currentStart and end
            const newStart = Math.max(currentStart, end);
            
            this.buffered = {
                length: 1,
                start: () => newStart,
                end: () => currentEnd
            };

            if (this.listeners['updateend']) {
                this.listeners['updateend']();
            }
        }, 10);
    }
}

class MockMediaSource {
    public readyState: string = 'closed';
    public activeSourceBuffers: any[] = [];
    private listeners: any = {};
    public sourceBuffers: any[] = [];

    addEventListener(event: string, callback: any) {
        this.listeners[event] = callback;
    }

    addSourceBuffer(mime: string) {
        const sb = new MockSourceBuffer();
        this.sourceBuffers.push(sb);
        return sb;
    }

    endOfStream() { }

    _open() {
        this.readyState = 'open';
        if (this.listeners['sourceopen']) {
            this.listeners['sourceopen']();
        }
    }
}

class MockAudio {
    public playbackRate: number = 1;
    public currentTime: number = 0;
    public src: string = '';
    public listeners: any = {};

    constructor() {
        this.listeners = {};
    }

    addEventListener(event: string, callback: any) {
        this.listeners[event] = callback;
    }

    removeEventListener(event: string, callback: any) {
        if (this.listeners[event] === callback) {
            delete this.listeners[event];
        }
    }

    play() { return Promise.resolve(); }
    pause() { }
    load() { }
    cloneNode() { return new MockAudio(); }
    replaceWith() { }
    removeAttribute() { }

    // Helper to trigger events
    _trigger(event: string) {
        if (this.listeners[event]) {
            this.listeners[event]();
        }
    }
}

global.Audio = MockAudio as any;
global.MediaSource = MockMediaSource as any;
global.URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => { }
} as any;

describe('AudioPlayer Rapid Buffer Full Repro', () => {
    let player: AudioPlayer;
    let mockMediaSource: MockMediaSource;
    let mockAudio: MockAudio;

    beforeEach(() => {
        jest.useFakeTimers();
        // Capture audio instance
        const originalAudio = global.Audio;
        global.Audio = class extends MockAudio {
            constructor() {
                super();
                mockAudio = this;
            }
        } as any;
        
        player = new AudioPlayer();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('should NOT spam warnings when buffer is full and cannot clear past data', async () => {
        let capturedMS: MockMediaSource | null = null;
        global.MediaSource = class extends MockMediaSource {
            constructor() {
                super();
                capturedMS = this;
            }
        } as any;

        const initPromise = player.initSource();
        // Wait a tick for constructor to run? No need, it's sync.
        if (!capturedMS) {
            throw new Error('MediaSource not instantiated');
        }
        (capturedMS as MockMediaSource)._open();
        
        await initPromise;

        const sb = (capturedMS as any).sourceBuffers[0] as MockSourceBuffer;
        
        // 1. Simulate Buffer Full early in playback
        sb.shouldThrowQuota = true;
        sb.buffered = {
            length: 1,
            start: () => 0,
            end: () => 10
        };
        // Ensure currentTime is very small so cleanup fails (0.1 < 0.5)
        mockAudio.currentTime = 0.1;

        // Spy on FileLogger.warn
        const warnSpy = jest.spyOn(FileLogger, 'warn').mockImplementation(() => Promise.resolve());

        // 2. Add chunk -> QuotaExceeded -> cleanupBuffer -> fails (returns false) -> sets isBufferFull -> adds timeupdate
        player.addChunk(new Uint8Array(100));

        // Expect ONE warn: "Buffer full but cannot remove past data."
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Buffer full but cannot remove past data'));
        
        // 3. Trigger rapid timeupdates, but still NOT enough to clear buffer
        // currentTime moves slowly: 0.2, 0.3 ... 0.4
        // Logic: handleTimeUpdate calls cleanupBuffer(true).
        // cleanupBuffer: removeEnd = 0.2 - 0.5 = -0.3 <= start(0). 
        // Force cleanup condition: if (force && removeEnd <= start) removeEnd = currentTime - 0.5;
        // removeEnd is still negative/small. 
        // We expect cleanupBuffer to return FALSE and log warning AGAIN if logic is not guarded.
        
        warnSpy.mockClear();

        mockAudio.currentTime = 0.2;
        mockAudio._trigger('timeupdate');
        
        mockAudio.currentTime = 0.3;
        mockAudio._trigger('timeupdate');

        mockAudio.currentTime = 0.4;
        mockAudio._trigger('timeupdate');

        // CURRENT BUG: It logs warning on EVERY failed cleanup attempt inside handleTimeUpdate?
        // Let's see `handleTimeUpdate`:
        // if (this.cleanupBuffer(true)) { ... }
        // cleanupBuffer(true):
        //   ...
        //   } else if (force) {
        //       console.warn('[VoxTrack] Buffer full but cannot remove past data.');
        //   }
        //   return false;
        
        // So yes, every timeupdate call that fails to clean up will Log WARN.
        // With the FIX, we expect NO additional warnings because we suppressed them in handleTimeUpdate
        // and throttled the checks.
        
        expect(warnSpy).toHaveBeenCalledTimes(0); 
    });
});
