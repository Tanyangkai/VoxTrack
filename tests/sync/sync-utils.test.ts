import { findWordIndexInDoc } from '../../src/utils/sync-utils';

describe('SyncUtils - findWordIndexInDoc', () => {
    const docText = "Hello world. This is a long text with multiple words. Hello again at the end.";

    test('finds exact match forward', () => {
        const index = findWordIndexInDoc({
            docText,
            wordToFind: "multiple",
            currentDocOffset: 0,
            chunkActualStart: 0,
            searchWindow: 500
        });
        expect(index).toBe(docText.indexOf("multiple"));
    });

    test('prevents overshoot (forward jump) beyond search window', () => {
        const text = "wordA " + ".".repeat(1000) + " wordTarget";
        const index = findWordIndexInDoc({
            docText: text,
            wordToFind: "wordTarget",
            currentDocOffset: 1, 
            chunkActualStart: 0,
            searchWindow: 500
        });
        expect(index).toBe(-1); // Should not jump 1000+ chars to find wordTarget
    });

    test('prevents backwards jump into previous chunks', () => {
        // chunkActualStart is 50, current position is 60.
        // There is a "wordA" at index 10 (previous chunk) and index 70 (current chunk).
        const text = ".".repeat(10) + "wordA" + ".".repeat(35) + "wordA" + ".".repeat(20);
        // wordA at 10, wordA at 50
        
        const index = findWordIndexInDoc({
            docText: text,
            wordToFind: "wordA",
            currentDocOffset: 55, // We are already past the second one? No, let's say 45
            chunkActualStart: 40,
            searchWindow: 500
        });
        expect(index).toBe(text.lastIndexOf("wordA")); // Should find the one at 50, not the one at 10
    });

    test('overshot recovery works within current chunk', () => {
        const text = "CHUNK_START wordA wordB";
        const index = findWordIndexInDoc({
            docText: text,
            wordToFind: "wordA",
            currentDocOffset: 20, // We accidentally moved past wordA (it's at index 12)
            chunkActualStart: 0,
            searchWindow: 500
        });
        expect(index).toBe(12); // Recovery should find it
    });

    test('fuzzy matching (punctuation) works', () => {
        const text = "Hello, world";
        const index = findWordIndexInDoc({
            docText: text,
            wordToFind: "Hello", // TTS might say "Hello" without comma
            currentDocOffset: 0,
            chunkActualStart: 0,
            searchWindow: 500
        });
        expect(index).toBe(0);
    });
});
