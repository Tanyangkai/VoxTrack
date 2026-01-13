import { TextProcessor } from '../src/text-processor';

describe('Slice Map Logic', () => {
    const processor = new TextProcessor();
    const options = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'zh-CN'
    };

    const doc = "前面的内容。\n\n需要朗读的内容。";
    
    test('slicing chunk should preserve map correctness', () => {
        const chunks = processor.process(doc, options);
        
        const cursor = doc.indexOf("需要");
        
        let foundStart = false;
        let textChunks: string[] = [];
        let chunkMaps: number[][] = [];
        
        for (const chunk of chunks) {
            let sliceIndex = -1;
            for (let i = 0; i < chunk.map.length; i++) {
                if (chunk.map[i] >= cursor) {
                    sliceIndex = i;
                    foundStart = true;
                    break;
                }
            }
            
            if (foundStart && sliceIndex !== -1) {
                const text = chunk.text.substring(sliceIndex);
                const map = chunk.map.slice(sliceIndex);
                textChunks.push(text);
                chunkMaps.push(map);
            }
        }
        
        // Verify Slice
        expect(textChunks.length).toBe(1);
        expect(textChunks[0]).toContain("需要朗读的内容");
        expect(textChunks[0]).not.toContain("前面的内容");
        
        // Verify Map
        const firstChar = textChunks[0][0]; // "需"
        const firstMap = chunkMaps[0][0];   // Should point to "需" in doc
        
        expect(firstChar).toBe("需");
        expect(doc[firstMap]).toBe("需");
        expect(firstMap).toBe(cursor);
        
        // Simulate SyncController Lookup
        const textOffset = 0;
        const rawStart = chunkMaps[0][textOffset];
        const absStart = 0 + rawStart; // chunkBaseOffset is 0
        
        expect(absStart).toBe(cursor);
    });
});
