import { TextProcessor } from '../src/text-processor';
import * as fs from 'fs';
import * as path from 'path';

describe('Long Document Verification (500KB+)', () => {
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

    test('Synthesized Heavy Document', () => {
        const patterns = [
            "Normal text sentence with some words. ",
            "**Bold** text and *Italic* text. ",
            "[Link](http://example.com) and [[Internal Link]]. ",
            "Emoji: 🏳️‍🌈 👨‍👩‍👧‍👦 💩. ",
            "Math: $E=mc^2$ and $\\frac{a}{b}$. ",
            "Code block:\n```javascript\nconsole.log('test');\n```\n",
            "Callout:\n> [!INFO]\n> Info content.\n",
            "Table:\n| A | B |\n|---|---|\n| 1 | 2 |\n",
            "Complex URL: https://example.com/foo?bar=1&baz=2. ",
            "Symbols: | * ~ ` _ . "
        ];

        let content = "---\ntitle: Heavy Doc\n---\n";
        const targetSize = 500 * 1024; // 500KB
        
        while (content.length < targetSize) {
            for (const p of patterns) {
                content += p;
            }
            content += "\n\n";
        }

        const marker = "FINALMARKERCHECK";
        content += marker;

        const startTime = Date.now();
        const result = processor.process(content, defaultOptions);
        const duration = Date.now() - startTime;
        
        console.log(`Processed ${content.length} chars in ${duration}ms. Chunks: ${result.length}`);

        // Search for marker in ALL chunks to see where it went
        let foundChunkIndex = -1;
        let foundMarkerIndex = -1;
        for (let i = result.length - 1; i >= 0; i--) {
            const idx = result[i].text.indexOf(marker);
            if (idx !== -1) {
                foundChunkIndex = i;
                foundMarkerIndex = idx;
                break;
            }
        }
        
        if (foundChunkIndex === -1) {
            console.log('Last Chunk Text:', result[result.length - 1].text);
            console.log('Second Last Chunk Text:', result[result.length - 2]?.text);
        } else {
            console.log(`Marker found in chunk ${foundChunkIndex} (Total: ${result.length})`);
        }

        expect(foundChunkIndex).not.toBe(-1);
        
        const targetChunk = result[foundChunkIndex];
        const mappedIndex = targetChunk.map[foundMarkerIndex];
        const expectedIndex = content.indexOf(marker);
        
        expect(mappedIndex).toBe(expectedIndex);
        
        if (result.length > 10) {
            const midChunk = result[Math.floor(result.length / 2)];
            if (midChunk.text.length > 20) {
                const sampleText = midChunk.text.substring(10, 20);
                const sampleMapStart = midChunk.map[10];
                expect(sampleMapStart).toBeGreaterThan(0);
                expect(sampleMapStart).toBeLessThan(content.length);
            }
        }
    });
    
test('Real File: 自学是门手艺.md', () => {
        const cwd = process.cwd();
        console.log('Current Working Directory:', cwd);
        
        const possiblePath = path.resolve(cwd, 'Projects/Personal_projects/自学是门手艺/自学是门手艺.md');
        console.log('Resolved Document Path:', possiblePath);
        
        if (fs.existsSync(possiblePath)) {
            const content = fs.readFileSync(possiblePath, 'utf-8');
            console.log('Successfully read document. Length:', content.length);
            
            const result = processor.process(content, defaultOptions);
            console.log(`Generated ${result.length} chunks for document length ${content.length}`);
            
            const lastChunk = result[result.length - 1];
            const lastText = lastChunk.text.trim();
            if (lastText.length > 5) {
                const tail = lastText.substring(lastText.length - 5);
                const idx = lastText.lastIndexOf(tail);
                const rawIdx = lastChunk.map[idx];
                
                expect(rawIdx).toBeLessThan(content.length);
            }
        } else {
            console.warn('Real file not found, skipping specific test.');
        }
    });
});