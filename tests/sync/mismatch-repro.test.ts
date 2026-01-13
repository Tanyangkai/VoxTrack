
import { TextProcessor } from '../../src/text-processor';
import { TrackedString } from '../../src/utils/tracked-string';

describe('Sync Mismatch Reproduction', () => {
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

    it('should correctly map indices for text with markdown symbols', () => {
        // Use double escaping for backticks inside template literal
        const input = `
#### 数值操作符

针对数字进行计算的操作符有加减乘除商余幂：\`+\`、\`-\`、\`*\`、\`/\`、\`//\`、\`%\`、\`**\`。

其中 \`+\` 和 \`-\` 可以对单个值进行操作，\`-3\`；其它的操作符需要有两个值才能操作。
`.trim();

        // 1. Process text
        const chunks = processor.process(input, defaultOptions);
        const processedText = chunks.map(c => c.text).join('');
        const processedMap = chunks[0].map; // Assuming single chunk for short text

        // console.log('Original Length:', input.length);
        // console.log('Processed Length:', processedText.length);
        // console.log('Processed Text:', processedText);

        // 2. Simulate finding specific words that failed in logs
        // Log mismatch: expected "+", found "："
        // In original text: `...余幂：`+`、...`
        // `+` is at index 45 (approx). `：` is at 44.
        
        // Let's check where "/" maps to (since + is now filtered).
        const targetWord = "/";
        const processedIndex = processedText.indexOf(targetWord);
        
        expect(processedIndex).not.toBe(-1);
        
        const originalIndex = processedMap[processedIndex];
        const originalChar = input[originalIndex];
        
        // console.log(`Mapped '/' at ${processedIndex} to original index ${originalIndex}, char: '${originalChar}'`);
        
        expect(originalChar).toBe('/');

        // 3. Simulate "其中"
        // Log mismatch: expected "其中", found "、`"
        const targetWord2 = "其中";
        const pIndex2 = processedText.indexOf(targetWord2);
        expect(pIndex2).not.toBe(-1);
        
        const oIndex2 = processedMap[pIndex2];
        // console.log(`Mapped '其中' at ${pIndex2} to original index ${oIndex2}, char: '${input.substring(oIndex2, oIndex2+2)}'`);
        
        expect(input.substring(oIndex2, oIndex2+2)).toBe("其中");
    });
});
