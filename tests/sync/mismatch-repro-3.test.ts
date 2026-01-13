import { TextProcessor } from '../../src/text-processor';

describe('Sync Mismatch Reproduction 3 - Detailed Mapping', () => {
    let processor: TextProcessor;

    beforeEach(() => {
        processor = new TextProcessor();
    });

    const defaultOptions = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'zh-CN'
    };

    it('should map symbols correctly', () => {
        // Use simple string to debug test harness
        const input = "其中 `+` 和 `-`";
        const chunks = processor.process(input, defaultOptions);
        const processedText = chunks[0].text;
        const map = chunks[0].map;
        
        console.log('Input:', input);
        console.log('Processed:', processedText);
        
        // Find the index of the space that replaced '+'
        // Original: "其中 `+` 和 `-`"
        // Indices: 01234567890
        // `+` is at 4.
        // Processed: "其中   和 -"
        // "其中" (0,1) " " (2, from `) " " (3, from +) " " (4, from `)
        // Wait, backticks are replaced by space.
        // `+` is replaced by space.
        // So we have 3 spaces?
        // `TextProcessor` collapses spaces: `ts.replace(/ +/g, ' ');`
        // So we have 1 space.
        
        // "其中 和 -"
        // "其中" (0,1) " " (2) "和" (3)
        // The space at 2 maps to what?
        // It maps to the FIRST space in the sequence of spaces.
        // Sequence: ` ` ` ` ` ` (from ` + `)
        // Original indices: 3 (`), 4 (+), 5 (`)
        // Space at 2 maps to 3.
        
        // So we can't find `+` index directly.
        // But we can verify "和" index.
        // "和" is at 7 in original.
        // In processed: index 3.
        
        const heIndex = processedText.indexOf('和');
        expect(heIndex).not.toBe(-1);
        expect(map[heIndex]).toBe(7);
        
        // And `-` should be preserved?
        // Original: `-` at 9.
        // Processed: `-` at 5.
        const dashIndex = processedText.indexOf('-');
        expect(dashIndex).not.toBe(-1);
        expect(map[dashIndex]).toBe(10);
    });
});