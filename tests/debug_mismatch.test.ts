
import { TextProcessor } from '../src/text-processor';
import { fuzzyIndexOf } from '../src/utils/sync-utils';

describe('Debug Mismatch Logic', () => {
    test('Map correctness for list and bold (middle of doc)', () => {
        const processor = new TextProcessor();
        const input = "Start\n\n- **风格**";
        // Start: 0-4
        // \n\n: 5-6
        // -: 7
        //  : 8
        // *: 9
        // *: 10
        // 风: 11
        // 格: 12
        
        const chunks = processor.process(input, {
            filterCode: true,
            filterLinks: true,
            filterMath: true,
            filterFrontmatter: true,
            filterObsidian: true,
            lang: 'zh-CN'
        });
        
        const chunk = chunks[0];
        console.log(`Processed Text: '${chunk.text}'`);
        
        // Find "风格"
        const search = "风格";
        const idx = chunk.text.indexOf(search);
        console.log(`'风格' found at ${idx}`);
        
        // Iterate map around "风格"
        // We expect some spaces before it
        for (let i = Math.max(0, idx - 5); i < Math.min(chunk.text.length, idx + 5); i++) {
             console.log(`Index ${i}: char '${chunk.text[i]}' -> map ${chunk.map[i]}`);
        }
    });
});
