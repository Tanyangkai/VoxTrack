import { AudioPlayer } from '../../src/audio/player';

// Mock MediaSource and SourceBuffer
class MockSourceBuffer extends EventTarget {
    updating = false;
    buffered = {
        length: 0,
        start: (i: number) => 0,
        end: (i: number) => 0
    };
    appendBuffer = jest.fn();
    remove = jest.fn();
    mode = 'segments';
}

class MockMediaSource extends EventTarget {
    readyState = 'closed';
    addSourceBuffer = jest.fn().mockReturnValue(new MockSourceBuffer());
    endOfStream = jest.fn();
}

class MockAudio extends EventTarget {
    src = '';
    playbackRate = 1.0;
    currentTime = 0;
    play = jest.fn().mockResolvedValue(undefined);
    pause = jest.fn();
    removeAttribute = jest.fn();
    load = jest.fn();
    replaceWith = jest.fn();
    cloneNode = jest.fn().mockReturnValue(new EventTarget());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Mock global browser APIs
const g = global as any;
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Global mock
g.Audio = MockAudio;
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Global mock
g.MediaSource = MockMediaSource;
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- Global mock
g.URL = {
    createObjectURL: jest.fn().mockReturnValue('blob:mock'),
    revokeObjectURL: jest.fn()
};

describe('AudioPlayer', () => {
    let player: AudioPlayer;

    beforeEach(() => {
        jest.useFakeTimers();
        player = new AudioPlayer();
    });

    afterEach(() => {
        player.destroy();
        jest.useRealTimers();
    });

    test('should initialize and add chunks to queue', async () => {
        const initPromise = player.initSource();
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        const msInstance = (player as any).mediaSource as MockMediaSource;
        msInstance.readyState = 'open';
        msInstance.dispatchEvent(new Event('sourceopen'));
        
        await initPromise;
        
        const data = new Uint8Array([1, 2, 3]);
        player.addChunk(data);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        const sourceBuffer = (player as any).sourceBuffer as MockSourceBuffer;
        expect(sourceBuffer.appendBuffer).toHaveBeenCalledWith(data);
    });

    test('should retry appending when QuotaExceededError occurs', async () => {
        const initPromise = player.initSource();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        const msInstance = (player as any).mediaSource as MockMediaSource;
        msInstance.readyState = 'open';
        msInstance.dispatchEvent(new Event('sourceopen'));
        await initPromise;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        const sourceBuffer = (player as any).sourceBuffer as MockSourceBuffer;
        
        // Simulate some buffered data
        sourceBuffer.buffered = {
            length: 1,
            start: (i: number) => 0,
            end: (i: number) => 5
        } as unknown as TimeRanges;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        (player as any).audio.currentTime = 12;

        sourceBuffer.appendBuffer.mockImplementationOnce(() => {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
        });

        const data = new Uint8Array([1, 2, 3]);
        player.addChunk(data);

        expect(sourceBuffer.remove).toHaveBeenCalledWith(0, 2); 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Access private
        expect((player as any).queue.length).toBe(1);
    });
});