import { SyncController } from '../../src/sync/controller';
import { AudioMetadata } from '../../src/api/protocol';

describe('SyncController - Comprehensive Edge Cases', () => {
    let controller: SyncController;

    beforeEach(() => {
        controller = new SyncController();
    });

    test('Overlap Resolution: should always prefer the highest chunk index at a given time', () => {
        controller.addMetadata([
            { offset: 1000, duration: 1000, text: "Chunk0_End", chunkIndex: 0 },
            { offset: 1500, duration: 1000, text: "Chunk1_Start", chunkIndex: 1 },
            { offset: 1800, duration: 1000, text: "Chunk2_Early", chunkIndex: 2 }
        ]);

        // At 1.9ms (19000000 ticks)
        // 1900 is in:
        // C0: 1000-2000
        // C1: 1500-2500
        // C2: 1800-2800
        const active = controller.findActiveMetadata(0.00019);
        expect(active?.chunkIndex).toBe(2);
        expect(active?.text).toBe("Chunk2_Early");
    });

    test('Monotonicity: should reject old chunks even if time jitters significantly', () => {
        controller.addMetadata([
            { offset: 10000000, duration: 10000000, text: "A", chunkIndex: 0 },
            { offset: 20000000, duration: 10000000, text: "B", chunkIndex: 1 }
        ]);

        controller.findActiveMetadata(2.5); // B (Chunk 1)
        
        // Time jitters back to 1.5s -> A (Chunk 0)
        const res = controller.findActiveMetadata(1.5);
        expect(res).toBeNull(); // Should not return A because it would cause a backwards jump to an old chunk
    });

    test('Reset logic: should clear monotonicity tracker', () => {
        controller.addMetadata([{ offset: 1000, duration: 1000, chunkIndex: 5 }]);
        controller.findActiveMetadata(0.00015); // Sets lastChunkIndex to 5
        
        controller.reset();
        
        controller.addMetadata([{ offset: 1000, duration: 1000, chunkIndex: 0 }]);
        const res = controller.findActiveMetadata(0.00015);
        expect(res?.chunkIndex).toBe(0); // Should be allowed now
    });

    test('Stuck time: should return the same advanced candidate consistently', () => {
        controller.addMetadata([
            { offset: 100, duration: 200, text: "A", chunkIndex: 1 },
            { offset: 100, duration: 200, text: "B", chunkIndex: 2 }
        ]);
        
        const first = controller.findActiveMetadata(0.000015); 
        expect(first?.chunkIndex).toBe(2);
        
        const second = controller.findActiveMetadata(0.000015);
        expect(second?.chunkIndex).toBe(2); // Stability check
    });

    test('Out of order metadata addition: should still find correct items via binary search (sorted)', () => {
        // Add out of order
        controller.addMetadata([{ offset: 2000, duration: 100, text: "Later", chunkIndex: 1 }]);
        controller.addMetadata([{ offset: 1000, duration: 100, text: "Earlier", chunkIndex: 0 }]);
        
        const res = controller.findActiveMetadata(0.000105);
        expect(res?.text).toBe("Earlier");
    });
});