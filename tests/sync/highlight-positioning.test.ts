import { TextProcessor } from '../../src/text-processor';
import { AudioMetadata } from '../../src/api/protocol';

describe('Highlight Positioning Integration', () => {
    let processor: TextProcessor;
    const defaultOptions = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'en-US'
    };

    beforeEach(() => {
        processor = new TextProcessor();
    });

    /**
     * Simulates the logic in main.ts to find the absolute position in the document
     * based on the metadata returned by TTS and the chunk maps from TextProcessor.
     */
    function findPositionInDoc(
        docText: string, 
        startOffset: number, 
        metadata: AudioMetadata, 
        chunkMap: number[], 
        chunkBaseOffset: number
    ): { from: number, to: number } | null {
        
        // Logic matched to main.ts FIX
        const currentMap = chunkMap;
        let foundIndex = -1;
        
        if (currentMap && metadata.textOffset !== undefined) {
            const startIdxInProcessed = metadata.textOffset;
            
            if (startIdxInProcessed < currentMap.length) {
                const rawStart = currentMap[startIdxInProcessed];
                if (rawStart !== undefined && rawStart !== -1) {
                    const absStart = chunkBaseOffset + rawStart;
                    foundIndex = absStart;
                }
            }
        }

        if (foundIndex !== -1) {
            let matchLen = metadata.wordLength;
            
            if (currentMap && metadata.textOffset !== undefined) {
                const startIdxInProcessed = metadata.textOffset;
                const endIdxInProcessed = metadata.textOffset + metadata.wordLength - 1; // Inclusive last char

                if (startIdxInProcessed < currentMap.length && endIdxInProcessed < currentMap.length) {
                    const rawStart = currentMap[startIdxInProcessed];
                    const rawEnd = currentMap[endIdxInProcessed];
                    
                    if (rawStart !== undefined && rawEnd !== undefined) {
                        const calculatedLen = (rawEnd - rawStart) + 1;
                        if (calculatedLen > 0) {
                            matchLen = calculatedLen;
                        }
                    }
                }
            }
            return { from: foundIndex, to: foundIndex + matchLen };
        }
        
        return null;
    }

    test('FAILING CASE: XML Escaping shifts offsets', () => {
        // 1. Original Text with special char
        const originalText = "Me & You";
        const startOffset = 0;

        // 2. Process Text (Now includes escaping!)
        const chunks = processor.process(originalText, defaultOptions);
        const chunk = chunks[0];
        const processedText = chunk.text; 
        const map = chunk.map;

        // Verify Processor output is now Escaped
        expect(processedText).toBe("Me &amp; You");
        // Verify Map: "Me " (3) + "&amp;" (5) + " You" (4)
        // Original: "Me & You" (8)
        // Map should distribute indices correctly.
        // &amp; (5 chars) should all point to index of & (3).
        expect(map[3]).toBe(3); // &
        expect(map[4]).toBe(3); // a
        expect(map[5]).toBe(3); // m
        expect(map[6]).toBe(3); // p
        expect(map[7]).toBe(3); // ;
        expect(map[8]).toBe(4); // space after &

        // 4. Send to TTS (No manual escape in main.ts anymore, but simulate what TTS receives)
        // TTS receives processedText ("Me &amp; You")
        
        // 5. Simulate TTS Metadata return
        // TTS receives "Me &amp; You".
        // It reads "You".
        // "Me " is 3 chars.
        // "&amp;" is 5 chars.
        // " " is 1 char.
        // "You" starts at index: 3 + 5 + 1 = 9.
        
        const metadata: AudioMetadata = {
            offset: 10000000,
            duration: 5000000,
            text: "You",
            textOffset: 9, // Offset in "Me &amp; You"
            wordLength: 3
        };

        // 6. Attempt to map back
        const pos = findPositionInDoc(originalText, startOffset, metadata, map, 0);
        
        expect(pos).not.toBeNull(); 
        if(pos) {
             expect(originalText.substring(pos.from, pos.to)).toBe("You");
             expect(pos.from).toBe(5); // "Me & " is length 5.
        }
    });

    test('Markdown Link stripping shifts offsets', () => {
        const originalText = "Click [here](http://example.com) to go.";
        const chunks = processor.process(originalText, defaultOptions);
        const chunk = chunks[0];
        
        // Processed: "Click here to go."
        // "Click " (6) + "here" (4) + " to go." (7) = 17 chars
        
        // TTS receives "Click here to go."
        // Reads "here"
        // Offset: 6
        
        const metadata: AudioMetadata = {
            offset: 5000000,
            duration: 2000000,
            text: "here",
            textOffset: 6,
            wordLength: 4
        };

        const pos = findPositionInDoc(originalText, 0, metadata, chunk.map, 0);
        
        expect(pos).not.toBeNull();
        if(pos) {
            // New logic should calculate length correctly based on map[end] - map[start] + 1
            // map[6] ('h') -> 7 ('[here' start at 7? No 'Click ' is 0-5, '[' is 6. 'h' is 7.)
            // map[9] ('e') -> 10.
            // Len = 10 - 7 + 1 = 4.
            // Pos from 7, len 4 -> "here".
            
            expect(originalText.substring(pos.from, pos.to)).toBe("here");
            expect(pos.from).toBe(7);
        }
    });
});