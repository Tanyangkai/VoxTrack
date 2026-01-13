import { SyncController } from '../../src/sync/controller';

describe('SyncController Session Reset', () => {
    test('resetting controller clears old metadata ensuring clean state for new session', () => {
        const controller = new SyncController();

        // Session 1
        controller.addMetadata([{ 
            offset: 0, 
            duration: 10000000, // 1s
            text: 'OldWord', 
            chunkIndex: 0 
        }]);

        // Verify Session 1
        expect(controller.findActiveMetadata(0.5)?.text).toBe('OldWord');

        // Simulate Stop Playback (Correct behavior)
        controller.reset(); 

        // Session 2
        controller.addMetadata([{ 
            offset: 0, 
            duration: 10000000, // 1s
            text: 'NewWord', 
            chunkIndex: 0 
        }]);

        // Current behavior with BUG: 
        // SyncController now contains BOTH 'OldWord' and 'NewWord' at the same timeframe.
        // We want to assert that this is WRONG (i.e., we expected only 'NewWord').
        // So we assert that we get 'NewWord'. If we get 'OldWord' or mixed behavior, the test fails (which is what we want for TDD).
        
        const active = controller.findActiveMetadata(0.5);
        
        // If the bug exists, this might be 'OldWord' because it was inserted first and sort is stable,
        // or binary search lands on it.
        expect(active?.text).toBe('NewWord');
        
        // Also we can check internal state if we wanted to be sure
        // expect((controller as any).metadata.length).toBe(1);
    });
});
