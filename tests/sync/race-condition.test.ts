import { SyncController } from '../../src/sync/controller';
import { AudioMetadata } from '../src/api/protocol';

describe('Sync Logic - Chunk Index Race Condition', () => {
    let controller: SyncController;

    beforeEach(() => {
        controller = new SyncController();
    });

    test('should rely on metadata chunkIndex, not global plugin state', () => {
        // Mock two chunks of metadata
        const chunk0: AudioMetadata[] = [
            { offset: 0, duration: 1000, text: "Chunk0", chunkIndex: 0, textOffset: 0, wordLength: 6 }
        ];
        const chunk1: AudioMetadata[] = [
            { offset: 2000, duration: 1000, text: "Chunk1", chunkIndex: 1, textOffset: 0, wordLength: 6 }
        ];

        controller.addMetadata(chunk0);
        controller.addMetadata(chunk1);

        // Simulate reading Chunk 0
        const active = controller.findActiveMetadata(0.00005); // 500 ticks
        expect(active?.chunkIndex).toBe(0);
        
        // Even if we "advance" some global index elsewhere, 
        // the metadata itself must tell us which chunk it belongs to.
    });
});
