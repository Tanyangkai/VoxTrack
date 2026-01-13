import { SyncController } from '../../src/sync/controller';
import { AudioMetadata } from '../src/api/protocol';

describe('Sync Logic - Chunk Overlap and Early Transition', () => {
    let controller: SyncController;

    beforeEach(() => {
        controller = new SyncController();
    });

    test('should NOT transition to next chunk if current chunk has more upcoming metadata', () => {
        // Mock Chunk 0 (0s - 10s)
        const chunk0: AudioMetadata[] = [
            { offset: 0, duration: 50000000, text: "Start0", chunkIndex: 0, textOffset: 0, wordLength: 6 },
            { offset: 50000000, duration: 50000000, text: "End0", chunkIndex: 0, textOffset: 10, wordLength: 4 }
        ];
        
        // Mock Chunk 1 starting too early due to wrong offset (mapped to 8s instead of 10s)
        const chunk1: AudioMetadata[] = [
            { offset: 80000000, duration: 20000000, text: "Start1", chunkIndex: 1, textOffset: 0, wordLength: 6 }
        ];

        controller.addMetadata(chunk0);
        controller.addMetadata(chunk1);

        // 1. Establish progress in Chunk 0
        controller.findActiveMetadata(1.0); // Should be Chunk 0

        // 2. At 9s, Chunk 0 is still valid ("End0" covers 5s-10s)
        // Even though Chunk 1 starts at 8s, we should prefer staying in Chunk 0.
        const active = controller.findActiveMetadata(9.0);
        
        // EXPECTATION: It should still be in Chunk 0 because we haven't reached the end of Chunk 0's items.
        // Current implementation prefers highest chunkIndex, which is wrong if chunks overlap erroneously.
        expect(active?.chunkIndex).toBe(0);
        expect(active?.text).toBe("End0");
    });
});
