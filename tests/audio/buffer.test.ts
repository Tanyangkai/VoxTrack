import { AudioBufferManager } from '../../src/audio/buffer';

describe('AudioBufferManager', () => {
    let bufferManager: AudioBufferManager;

    beforeEach(() => {
        bufferManager = new AudioBufferManager();
    });

    test('should start empty', () => {
        expect(bufferManager.isEmpty()).toBe(true);
        expect(bufferManager.hasItems()).toBe(false);
    });

    test('enqueue should add items', () => {
        const mockBuffer = {} as AudioBuffer; // Simple mock
        bufferManager.enqueue(mockBuffer);
        expect(bufferManager.isEmpty()).toBe(false);
        expect(bufferManager.hasItems()).toBe(true);
    });

    test('dequeue should remove and return items in order', () => {
        const mockBuffer1 = { duration: 1 } as AudioBuffer;
        const mockBuffer2 = { duration: 2 } as AudioBuffer;

        bufferManager.enqueue(mockBuffer1);
        bufferManager.enqueue(mockBuffer2);

        expect(bufferManager.dequeue()).toBe(mockBuffer1);
        expect(bufferManager.dequeue()).toBe(mockBuffer2);
        expect(bufferManager.isEmpty()).toBe(true);
    });

    test('clear should empty the queue', () => {
        const mockBuffer = {} as AudioBuffer;
        bufferManager.enqueue(mockBuffer);
        bufferManager.clear();
        expect(bufferManager.isEmpty()).toBe(true);
    });
});
