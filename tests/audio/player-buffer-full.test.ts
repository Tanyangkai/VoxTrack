
import { AudioPlayer } from '../../src/audio/player';
import { FileLogger } from '../../src/utils/logger';

// Mock Browser APIs
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
            // If we remove 0 to 2, new start is 2.
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

describe('AudioPlayer Buffer Full Recovery', () => {
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

    it('should recover from buffer full state when time advances', async () => {
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
        
        // 1. Simulate Buffer Full
        sb.shouldThrowQuota = true;
        sb.buffered = {
            length: 1,
            start: () => 0,
            end: () => 10
        };
        // Ensure currentTime is 0 so cleanup fails
        mockAudio.currentTime = 0;

        // Spy on FileLogger.warn
        const warnSpy = jest.spyOn(FileLogger, 'warn').mockImplementation(() => Promise.resolve());

        // 2. Add chunk -> Should trigger QuotaExceeded -> cleanupBuffer -> warn
        player.addChunk(new Uint8Array(100));

        // Expect warn to be called: "Buffer full but cannot remove past data."
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Buffer full but cannot remove past data'));
        
        // The queue should still have the chunk (implicit: processQueue failed)
        // We can't access private queue easily, but we can verify that subsequent time update fixes it.

        // 3. Clear the quota error condition (simulate that we CAN append now if we cleanup)
        // Actually, in our logic: 
        // We need to advance time -> trigger cleanup -> free space -> append succeeds.
        // So we keep shouldThrowQuota = true UNTIL cleanup succeeds? 
        // No, SourceBuffer throws Quota if full. If we remove data, it won't throw.
        // So we need to link `shouldThrowQuota` to `buffered.end - buffered.start`?
        // Let's manually manage it.
        
        // 4. Advance time to 5s.
        mockAudio.currentTime = 5;
        
        // Trigger timeupdate.
        // This is the NEW behavior we want to implement.
        // Currently, this does nothing.
        mockAudio._trigger('timeupdate');

        // We expect cleanupBuffer to run: 5 - 2 = 3. Remove 0 to 3.
        // Then processQueue runs.
        
        // To verify this, we need to check if sb.remove was called.
        // We can spy on sb.remove
        const removeSpy = jest.spyOn(sb, 'remove');
        
        // Advance timers to let cleanup async logic (if any) run
        jest.advanceTimersByTime(1000);

        // CURRENTLY: This will fail because we haven't implemented the timeupdate listener logic yet.
        expect(removeSpy).toHaveBeenCalled();
        
        // Also verify that AFTER remove, we tried to append again.
        // If remove succeeds, we set shouldThrowQuota to false (simulating space freed)
        sb.shouldThrowQuota = false; 
        
        // Wait for updateend of remove
        jest.advanceTimersByTime(100);

        // processQueue should have been called and appendBuffer should have succeeded.
        // We can check if updating was true (it sets updating=true then false in 10ms).
        // Or check internal state if possible.
        
        // For now, let's just ensure `remove` was called, which proves we reacted to timeupdate.
    });
});
