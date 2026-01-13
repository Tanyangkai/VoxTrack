import { SyncController } from '../../src/sync/controller';
import { AudioMetadata } from '../../src/api/protocol';

describe('SyncController', () => {
    let controller: SyncController;
    const mockMetadata: AudioMetadata[] = [
        { offset: 0, duration: 10000000, text: "Hello", textOffset: 0, wordLength: 5 }, // 0 - 1s (in 100ns units)
        { offset: 10000000, duration: 10000000, text: "World", textOffset: 6, wordLength: 5 } // 1s - 2s
    ];

    beforeEach(() => {
        controller = new SyncController();
        controller.addMetadata(mockMetadata);
    });

    test('findActiveMetadata should return correct metadata for timestamp', () => {
        // Test within first word
        const result1 = controller.findActiveMetadata(0.5); // 0.5s
        expect(result1).not.toBeNull();
        expect(result1?.text).toBe("Hello");

        // Test boundary
        const result2 = controller.findActiveMetadata(1.1); // 1.1s
        expect(result2).not.toBeNull();
        expect(result2?.text).toBe("World");
    });

    test('findActiveMetadata should return null for out of range', () => {
        const result = controller.findActiveMetadata(5.0);
        expect(result).toBeNull();
    });

    test('reset should clear state', () => {
        controller.reset();
        const result = controller.findActiveMetadata(0.5);
        expect(result).toBeNull();
    });

    test('removeChunk should only remove items for specific chunk', () => {
        controller.addMetadata([
            { offset: 20000000, duration: 10000000, text: "Chunk1Word", chunkIndex: 1, wordLength: 10 }
        ]);
        
        // Before removal: has both
        expect(controller.findActiveMetadata(0.5)?.text).toBe("Hello");
        expect(controller.findActiveMetadata(2.5)?.text).toBe("Chunk1Word");

        // Remove Chunk 0
        controller.removeChunk(0);

        // After removal: Chunk 0 is gone, Chunk 1 remains
        expect(controller.findActiveMetadata(0.5)).toBeNull();
        expect(controller.findActiveMetadata(2.5)?.text).toBe("Chunk1Word");
    });
});
