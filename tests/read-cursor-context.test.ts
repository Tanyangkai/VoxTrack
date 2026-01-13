import { TextProcessor } from '../src/text-processor';

describe('Read From Cursor Context Logic', () => {
    const processor = new TextProcessor();
    const options = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'en-US'
    };

    const doc = "Start\n```js\nconst x = 1;\n```\nEnd";
    // Code block is roughly from index 6 to 27.
    
    test('Old logic: fails to filter code when starting from inside', () => {
        const cursor = 15; // Inside code block
        const partialText = doc.substring(cursor); // "x = 1;\n```\nEnd"
        
        const chunks = processor.process(partialText, options);
        // Because "```" is missing at start, it won't match regex.
        // It will contain "x = 1;" -> "x equals 1;" (Symbol replaced by text)
        expect(chunks[0].text).toContain("x equals 1");
    });

    test('New logic: finds correct start point using full text map', () => {
        // 1. Process full text
        const chunks = processor.process(doc, options);
        const chunk = chunks[0];
        
        // Should have filtered code completely
        expect(chunk.text).not.toContain("const");
        
        // 2. Find start point for cursor at 15
        const cursor = 15;
        let startIndex = -1;
        
        // Simple linear search for demo
        for(let i=0; i<chunk.map.length; i++) {
            if (chunk.map[i] >= cursor) {
                startIndex = i;
                break;
            }
        }
        
        // Should point to "End" part.
        const textFromCursor = chunk.text.substring(startIndex);
        expect(textFromCursor.trim()).toBe("End");
    });
});

