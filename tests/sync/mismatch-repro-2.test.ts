
import { TextProcessor } from '../../src/text-processor';

describe('Sync Mismatch Reproduction 2', () => {
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

    it('should reproduce the mismatch from logs', () => {
        // Exact input snippet from the user's report
        const input = `
#### 数值操作符

针对数字进行计算的操作符有加减乘除商余幂：\`+\`、\`-\`、\`*\`、\`/\`、\`//\`、\`%\`、\`**\`。

其中 \`+\` 和 \`-\` 可以对单个值进行操作，\`-3\`；其它的操作符需要有两个值才能操作。
`.trim();

        const chunks = processor.process(input, defaultOptions);
        const processedText = chunks.map(c => c.text).join('');
        const processedMap = chunks[0].map;

        // Log analysis from user:
        // Expected: "+", Found: "："
        // Expected: "其中", Found: "、`"
        
        // This implies that the processedText might be missing some characters OR
        // the map is pointing to the WRONG indices in the original text.
        
        // Let's debug what the processed text looks like around "+"
        // The logs suggest that when we search for "+", we find an index in processedText,
        // but when we map that index back to input using processedMap, we get "："
        
        // Let's find "+" in processedText
        const pIndex = processedText.indexOf("+");
        if (pIndex !== -1) {
            const oIndex = processedMap[pIndex];
            // console.log(`Processed text around +: "${processedText.substring(pIndex-2, pIndex+3)}"`);
            // console.log(`Original text at mapped index ${oIndex}: "${input.substring(oIndex, oIndex+1)}"`);
            // console.log(`Original text context: "${input.substring(oIndex-2, oIndex+3)}"`);
            
            // If the bug exists, this might be true:
            // expect(input[oIndex]).toBe('：'); 
        }
        
        // However, the previous test PASSED, meaning my manual mapping check was correct.
        // So why did the log say mismatch?
        
        // Maybe findWordIndexInDoc is doing something different than simple mapping?
        // The log comes from `findWordIndexInDoc` falling back or map lookup failing?
        // The log "Sync: Text Mismatch" comes from:
        // const foundText = docText.substring(from, to);
        // if (normFound !== normExpected) ...
        
        // Wait! The log says `chunk: 7`. This implies it's a long document and this snippet is just chunk 7.
        // My test uses a short string as a single chunk.
        // Maybe the offset calculation across chunks is wrong?
        // Or maybe `TrackedString.replace` logic for markdown symbols is buggy? 
        
        // Let's specifically look at `TextProcessor` logic for `replace(/[*_`~]/g, ' ')`.
        // It replaces backticks with spaces.
        // So `+` becomes ` + ` (with spaces around it if backticks were replaced).
        // BUT wait! I previously removed the line `ts.remove(/`[^`\n]+`/);` to fix the code block issue.
        // Now inline code is KEPT. 
        
        // Let's see current TextProcessor logic.
        // ts.replace(/[*_`~]/g, ' '); // Line 105 in src/text-processor.ts
        
        // If `+` becomes ` + ` (spaces replaced backticks), the text is ` + `.
        // `+` is at index 1 in the processed segment.
        // Original: `+`
        // Index 0 (backtick) -> replaced by space
        // Index 1 (+) -> kept?
        // Index 2 (backtick) -> replaced by space
        
        // If TextProcessor.replace is 1-to-1 (char for char replacement or char for string),
        // let's check `replace` implementation in `tracked-string.ts`.
        // It says: "Replaces matches with a single character... If replacement is longer... fills map with start index".
        
        // Here we replace `[` * _ ` ~ `]` (single char) with `' '` (single char).
        // So it's 1-to-1.
        // So `+` at index 1 maps to `+` at index 1.
        // So processed text should correspond exactly. 
        
        // However, `findWordIndexInDoc` uses the `map` to find the start.
        // If the TTS reads "+", we search "+" in processed text.
        // We find "+" at index 1.
        // Map[1] should point to original index of "+".
        
        // Let's verify `replace` logic.
    });
});
