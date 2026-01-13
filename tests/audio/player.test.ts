
import { AudioPlayer } from '../../src/audio/player';

// Mock Browser APIs
class MockSourceBuffer {
    public updating: boolean = false;
    public buffered: any = {
        length: 0,
        start: () => 0,
        end: () => 0
    };
    private _data: Uint8Array[] = [];
    private listeners: any = {};

    addEventListener(event: string, callback: any) {
        this.listeners[event] = callback;
    }

    appendBuffer(data: BufferSource) {
        this.updating = true;
        this._data.push(new Uint8Array(data as ArrayBuffer));

        // Update buffered end immediately for simplicity, or delay it?
        // In reality, buffered updates are sync-ish but 'updateend' is async.
        // However, the RACE condition is about the queue not being empty yet
        // when turn.end is processed.

        // Simulate async update
        setTimeout(() => {
            this.updating = false;
            // Update buffered mock
            const totalLen = this._data.reduce((acc, curr) => acc + curr.byteLength, 0);
            // Rough mapping: 1 byte = 0.001s (just for mock)
            const duration = totalLen * 0.001;

            this.buffered = {
                length: 1,
                start: () => 0,
                end: () => duration
            };

            if (this.listeners['updateend']) {
                this.listeners['updateend']();
            }
        }, 50);
    }
}

class MockMediaSource {
    public readyState: string = 'closed'; // start closed
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

    // Helper to simulate open
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

    addEventListener(event: string, callback: any) { }
    play() { return Promise.resolve(); }
    pause() { }
    load() { }
    cloneNode() { return new MockAudio(); }
    replaceWith() { }
    removeAttribute() { }
}

// Global mocks
global.Audio = MockAudio as any;
global.MediaSource = MockMediaSource as any;
global.URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => { }
} as any;

describe('AudioPlayer Race Condition', () => {
    let player: AudioPlayer;
    let mockMediaSource: MockMediaSource;

    beforeEach(() => {
        jest.useFakeTimers();
        player = new AudioPlayer();

        // We need to capture the MediaSource instance created inside AudioPlayer
        // But AudioPlayer creates it internally. We can spy or just rely on global mock.
        // Since we mocked global.MediaSource, we need to inspect the instances.
        // But `new MediaSource()` returns a new instance.
        // Let's monkey-patch the global class to capture instance.
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should show stale buffered end if queried before queue is empty', async () => {
        let capturedMS: MockMediaSource | null = null;
        const OriginalMS = global.MediaSource;
        global.MediaSource = class extends MockMediaSource {
            constructor() {
                super();
                capturedMS = this;
            }
        } as any;

        const initPromise = player.initSource();
        // Trigger sourceopen
        if (capturedMS) (capturedMS as MockMediaSource)._open();
        await initPromise;

        // 1. Add a chunk (simulating silence/audio)
        // 1000 bytes => 1s in our mock logic
        const chunk1 = new Uint8Array(1000);
        player.addChunk(chunk1);

        // 2. Immediately check buffered end (BEFORE updateend fires)
        // Since appendBuffer has a 50ms delay, updating should be true (or queue waiting)
        // and buffered end should NOT effectively reflect the new data yet (depending on mock logic).
        // In our mock, we update buffered inside the timeout.

        const bufferedEndEarly = player.getBufferedEnd();
        expect(bufferedEndEarly).toBe(0); // Should be 0 initially

        // 3. Fast forward time to finish update
        jest.advanceTimersByTime(100);

        // 4. Now check buffered end
        const bufferedEndLate = player.getBufferedEnd();
        expect(bufferedEndLate).toBe(1); // Should be 1s now

        // THIS PROVES THE RACE CONDITION:
        // If main.ts calls getBufferedEnd immediately after sending chunk (but before updateend),
        // it gets 0 instead of 1.

        global.MediaSource = OriginalMS;
    });

    // TDD: This test will FAIL initially if we don't implement waitForQueueEmpty 
    // actually, it just asserts the behavior. 
    // To properly TDD, I should write a test that USES the new method and expects it to wait.

    it('should wait for queue to empty when using waitForQueueEmpty', async () => {
        let capturedMS: MockMediaSource | null = null;
        const OriginalMS = global.MediaSource;
        global.MediaSource = class extends MockMediaSource {
            constructor() {
                super();
                capturedMS = this;
            }
        } as any;

        const initPromise = player.initSource();
        if (capturedMS) (capturedMS as MockMediaSource)._open();
        await initPromise;

        const chunk1 = new Uint8Array(1000); // 1s
        player.addChunk(chunk1);

        // Expectation: waitForQueueEmpty should not resolve immediately
        let resolved = false;

        const waitPromise = player.waitForQueueEmpty().then(() => {
            resolved = true;
        });

        // Should still be false immediately
        expect(resolved).toBe(false);

        // Advance time partialy
        jest.advanceTimersByTime(20);
        expect(resolved).toBe(false);

        // Advance time fully
        jest.advanceTimersByTime(100);
        await Promise.resolve(); // flush promises

        // Now it should be resolved
        // @ts-ignore
        // expect(resolved).toBe(true); // Wait, promises need await. 

        await waitPromise;
        expect(player.getBufferedEnd()).toBe(1);

        global.MediaSource = OriginalMS;
    });
});