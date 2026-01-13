import { TextProcessor } from './text-processor';

describe('TextProcessor', () => {
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

    test('removes frontmatter', () => {
        const input = `---
title: Test
---
Content`;
        const result = processor.process(input, defaultOptions);
        expect(result[0]?.text).toBe('Content');
    });

    test('removes code blocks', () => {
        const input = 'Text\n```js\ncode\n```\nMore text';
        const result = processor.process(input, defaultOptions);
        if (result[0]) expect(result[0].text.replace(/\s+/g, ' ').trim()).toBe('Text More text');
    });

    test('removes math', () => {
        const input = 'Text $$E=mc^2$$ and $x$';
        const result = processor.process(input, defaultOptions);
        if (result[0]) expect(result[0].text.trim()).toBe('Text and');
    });

    test('replaces symbols in English', () => {
        const input = '3 < 5 and a >= b';
        const result = processor.process(input, { ...defaultOptions, lang: 'en-US' });
        // Symbols should be replaced by space to avoid TTS reading them as words
        expect(result[0]?.text).not.toContain('<');
        expect(result[0]?.text).not.toContain('>=');
        expect(result[0]?.text).toContain('3 less than 5 and a greater than equals b');
    });

    test('replaces symbols in Chinese', () => {
        const input = '3 < 5';
        const result = processor.process(input, { ...defaultOptions, lang: 'zh-CN' });
        expect(result[0]?.text).not.toContain('<');
        expect(result[0]?.text).toBe('3 小于 5');
    });

    test('chunks long text', () => {
        const longText = 'a'.repeat(3000);
        const result = processor.process(longText, defaultOptions);
        expect(result.length).toBeGreaterThan(1);
        if (result[0]) expect(result[0].text.length).toBeLessThanOrEqual(2500);
    });

    test('handles links', () => {
        const input = 'Click [here](http://example.com) or [[Internal|Link]].';
        const result = processor.process(input, defaultOptions);
        expect(result[0]?.text).toContain('Click here or Link.');
        expect(result[0]?.text).not.toContain('http');
        expect(result[0]?.text).not.toContain('Internal');
    });

    test('does not mistake currency in tables for math', () => {
        const input = `
| Item | Price |
| :--- | :---- |
| Apple | $1.00 |
| Banana | $2.00 |
`;
        const result = processor.process(input, defaultOptions);
        // Expect prices to be preserved
        expect(result[0]?.text).toContain('$1.00');
        expect(result[0]?.text).toContain('$2.00');
    });

    test('correctly processes complex Chinese tables', () => {
        const input = `@[.obsidian/plugins/voxtrack]  关键词：**敢、快、狠、成、久、深**

| 维度       | 典型表现                |
| -------- | ------------------- |
| **行动**   | 不犹豫，想到就做，执行速度远超常人   |
| **意志**   | 目标明确，抗打击，有狠劲，持续推进   |
| **风险承担** | 敢于冒风险，越阻越上，不怕失败     |
| **能量输出** | 情绪强烈、存在感高，常有压迫性或冲击力 |
| **突破常规** | 不按正常流程来，走非常规路线也敢走   |
一流人才：
·有强烈好奇心。`;

        const result = processor.process(input, defaultOptions);
        // console.log('Processed Chinese Table:', JSON.stringify(result[0]?.text));

        // Should contain key content
        expect(result[0]?.text).toContain('行动');
        expect(result[0]?.text).toContain('不犹豫');
        expect(result[0]?.text).not.toContain('|'); // Should typically remove pipes
        expect(result[0]?.text).not.toContain('---'); // Should remove separators
    });

    test('removes emojis', () => {

        const input = 'Start 🏗️ End';

        const result = processor.process(input, defaultOptions);

        expect(result[0]?.text).toBe('Start End');

    });



    test('repro: LaTeX formula mapping', () => {

        const input = '你持有的 $H_{\text{自命不凡}}$ 是一个错误算法。';

        const result = processor.process(input, defaultOptions);

        const chunk = result[0]!;

        // "是一个" should be mapped to the correct position

        const index = chunk.text.indexOf('是一个');

        expect(index).not.toBe(-1);



        const originalPos = chunk.map[index];



        const expectedPos = input.indexOf('是一个');



        expect(originalPos).toBe(expectedPos);






        // Check the word after the formula



        const textAfter = chunk.text.substring(index, index + 3);



        expect(textAfter).toBe('是一个');



        if (originalPos !== undefined) {
            expect(input.substring(originalPos, originalPos + 3)).toBe('是一个');
        }
    });

    test('handles special characters and maintains map integrity', () => {
        const input = "> Quotation with & and | symbols.";
        const result = processor.process(input, { ...defaultOptions, filterObsidian: true });
        const chunk = result[0]!;

        // Check "Quotation"
        const qIdx = chunk.text.indexOf("Quotation");
        expect(qIdx).not.toBe(-1);
        // Original: "> Quotation..."
        // Processed: " Quotation..." (Header replaced by space)
        expect(chunk.map[qIdx]).toBe(2);

        // Check "&"
        const ampIdx = chunk.text.indexOf("&");
        expect(ampIdx).not.toBe(-1);
        expect(chunk.map[ampIdx]).toBe(17);

        // Check "|" -> should become ", "
        const commaIdx = chunk.text.indexOf(", ");
        expect(commaIdx).not.toBe(-1);
        expect(chunk.map[commaIdx]).toBe(23);
    });

    test('chunked text maps are relative to original input', () => {
        // Default maxLen is 300. 
        // We provide 300 'a's so it splits exactly at 300 (hard cut if no sentence boundary found in window).
        // Then 'b's should form the second chunk.
        const longText = 'a'.repeat(300) + 'b'.repeat(100);
        const result = processor.process(longText, defaultOptions);

        expect(result.length).toBeGreaterThan(1);

        // First chunk
        const firstChunk = result[0];
        const secondChunk = result[1];

        if (!firstChunk || !secondChunk) {
            throw new Error("Expected 2 chunks");
        }

        expect(firstChunk.text.startsWith('a')).toBe(true);
        expect(firstChunk.map[0]).toBe(0);

        // Second chunk should be bbb...
        // Original text index of start of second chunk
        // 'a' * 1500 (length 1500)
        // then ' ' (length 1)
        // then 'b'
        // So 'b' starts at 1501

        expect(secondChunk.text.startsWith('b')).toBe(true);

        const expectedIndex = longText.indexOf('b');
        expect(secondChunk.map[0]).toBe(expectedIndex);
    });

    test('debug: deep inspection of mapping', () => {
        const input = `
# Debug Heading
This is a test paragraph with **bold** text and a [link](http://example.com).
It also has some chinese: 这里是中文测试，包含符号。

> Blockquote with *italics* inside.
`;

        const result = processor.process(input, defaultOptions);

        result.forEach((chunk, chunkIdx) => {
        // console.log(`\n--- Chunk ${chunkIdx} ---`);
        // console.log('Text:', chunk.text);
        expect(chunk.text.length).toBeLessThanOrEqual(300);

            // Log a sample of the map for verification
            let mappingOutput = '';
            for (let i = 0; i < chunk.text.length; i++) {
                const char = chunk.text[i];
                const originalIdx = chunk.map[i];
                // Ensure safe access and log relevant mapping
                if (char && char.trim().length > 0) {
                    const originalChar = (originalIdx !== undefined) ? (input[originalIdx] || '?') : '?';
                    mappingOutput += `'${char}'->${originalIdx} (${originalChar})\n`;
                }
            }
            // console.log(mappingOutput); // Uncommented to see full mapping

            // Check for monotonicity in map (indices should generally increase)
            let lastIdx = -1;
            for (let i = 0; i < chunk.map.length; i++) {
                const currentIdx = chunk.map[i];
                if (currentIdx !== undefined) {
                    if (currentIdx < lastIdx) {
                        console.warn(`Mapping regression at generated index ${i} ('${chunk.text[i]}'): ${currentIdx} < ${lastIdx}`);
                    }
                    lastIdx = currentIdx;
                }
            }
        });

        // Basic sanity checks
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]?.text).toContain('Debug Heading');
        expect(result[0]?.text).toContain('bold text');
        expect(result[0]?.text).toContain('中文测试');
    });

});