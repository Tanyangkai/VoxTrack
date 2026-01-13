
import VoxTrackPlugin from '../../src/main';
import { AudioPlayer } from '../../src/audio/player';
import { EdgeSocket } from '../../src/api/edge-socket';
import { SyncController } from '../../src/sync/controller';
import { TextProcessor } from '../../src/text-processor';
import { findWordIndexInDoc } from '../../src/utils/sync-utils';

// Mocks
jest.mock('../../src/audio/player');
jest.mock('../../src/api/edge-socket');
jest.mock('../../src/sync/controller');
jest.mock('../../src/text-processor');
jest.mock('../../src/utils/editor-utils', () => ({
    getSelectedText: jest.fn(),
    getFullText: jest.fn().mockReturnValue({ text: 'dummy' }),
    getTextFromCursor: jest.fn()
}));
jest.mock('../../src/settings/setting-tab', () => ({
    DEFAULT_SETTINGS: { highlightMode: 'word' },
    VoxTrackSettingTab: class {}
}));
jest.mock('../../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), initialize: jest.fn() }
}));
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('Duplicate Field Local Search', () => {
    
    // We can test findWordIndexInDoc directly as it contains the core search logic
    // This is more efficient than mocking the whole plugin loop for this specific algorithmic check.

    test('Scenario: Search finds correct duplicate when starting from correct offset', () => {
        // Doc: "Apple Banana Apple Orange"
        // Indices: 01234567890123456789012
        // "Apple"(0), "Banana"(6), "Apple"(13), "Orange"(19)
        
        const doc = "Apple Banana Apple Orange";
        
        // We want to find the SECOND Apple.
        // Assume Map told us it should be around 13.
        const currentDocOffset = 13; 
        
        const idx = findWordIndexInDoc({
            docText: doc,
            wordToFind: "Apple",
            currentDocOffset: currentDocOffset,
            chunkActualStart: 0,
            searchWindow: 50
        });
        
        expect(idx).toBe(13);
    });

    test('Scenario: Search jumps to previous duplicate if offset is lagging (Risk Confirmation)', () => {
        const doc = "Apple Banana Apple Orange";
        // We want to find the SECOND Apple (index 13).
        // BUT assume our offset is lagging (e.g. at 0).
        const laggingOffset = 0;
        
        const idx = findWordIndexInDoc({
            docText: doc,
            wordToFind: "Apple",
            currentDocOffset: laggingOffset,
            chunkActualStart: 0,
            searchWindow: 50
        });
        
        // It finds the FIRST Apple because searching forward from 0
        expect(idx).toBe(0); 
        // This confirms "乱跳" (jumping back) IS possible if offset is wrong.
    });

    test('Scenario: Insertion causes offset mismatch but search handles it if not ambiguous', () => {
        // Original: "Target" at 0.
        // New: "Prefix Target" at 7.
        const doc = "Prefix Target";
        // Map thinks it is at 0.
        
        const idx = findWordIndexInDoc({
            docText: doc,
            wordToFind: "Target",
            currentDocOffset: 0,
            chunkActualStart: 0,
            searchWindow: 50
        });
        
        expect(idx).toBe(7); // Found it!
    });

    test('Scenario: Ambiguous case - Insertion pushes target, creating false match with previous?', () => {
        // Original: "A ... A" (Target is 2nd A)
        // Insert "Prefix" at start.
        // New: "Prefix A ... A"
        // 2nd A is pushed further.
        // Map points to OLD 2nd A location.
        // If "Prefix" + "1st A" length == Old "1st A" -> "2nd A" distance?
        
        // Let's construct:
        // Original: "Apple Banana Apple"
        // Indices:   0     6      13
        // Target: 2nd Apple (13).
        
        // Insert "Pineapple " (10 chars) at start.
        // New: "Pineapple Apple Banana Apple"
        // Indices: 0         10    16     23
        // Real Target (2nd Apple) is now at 23.
        
        // Map still points to 13.
        // Search starts at 13.
        // In New string, what is at 13?
        // "Pineapple Apple B..."
        //            ^ (10)
        // Index 13 is inside "Apple" (the 1st one!).
        // "Apple" starts at 10. ends at 15.
        // doc.indexOf("Apple", 13) ??
        
        // If we start search at 13.
        // The 1st Apple starts at 10. `indexOf` starting at 13 will miss it?
        // Wait, "Apple" at 10.
        // 10: A, 11: p, 12: p, 13: l, 14: e.
        // Search "Apple" from 13 ("le..."). No match.
        // It will skip the 1st Apple.
        
        // It will find the 2nd Apple (at 23).
        // 23 is close to 13 (diff 10).
        // If window is 50.
        // It returns 23.
        // Correct!
        
        const doc = "Pineapple Apple Banana Apple";
        // We look for "Apple". Map says 13.
        const idx = findWordIndexInDoc({
            docText: doc,
            wordToFind: "Apple",
            currentDocOffset: 13,
            chunkActualStart: 0,
            searchWindow: 50
        });
        
        expect(idx).toBe(23); // Finds correct 2nd one.
    });

    test('Scenario: The "Trap" - Insertion pushes 1st duplicate exactly to old 2nd duplicate position', () => {
        // Original: "A B A" (lengths 1, 1, 1). A(0), B(2), A(4).
        // Target: 2nd A (4).
        
        // Insert "XY " (3 chars).
        // New: "XY A B A".
        // A(3), B(5), A(7).
        
        // Map points to 4.
        // Search starts at 4.
        // At 4: Space between A and B. " B A"
        // indexOf("A", 4) -> Finds 7.
        // Correct.
        
        // What if:
        // Original: "A B A"
        // Insert "XYZ " (4 chars).
        // New: "XYZ A B A".
        // A(4), B(6), A(8).
        
        // Map points to 4.
        // Search starts at 4.
        // At 4: "A B A..."
        // It finds "A" at 4.
        // BUT this is the **1st A** (shifted).
        // We wanted the **2nd A**.
        
        // Result: 4.
        // Is this right?
        // We matched "A". It's a valid "A".
        // But semantically it's the wrong one.
        // Highlighting "XYZ [A] B A"
        // Voice is reading the *second* A (conceptually).
        // This is a misalignment.
        
        const doc = "XYZ A B A";
        const idx = findWordIndexInDoc({
            docText: doc,
            wordToFind: "A",
            currentDocOffset: 4, // Old pos of 2nd A
            chunkActualStart: 0,
            searchWindow: 50
        });
        
        expect(idx).toBe(4); // Finds shifted 1st A.
        // This confirms the "Duplicate Trap".
    });
});
