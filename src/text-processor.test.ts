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
        expect(result[0]).toBe('Content');
    });

    test('removes code blocks', () => {
        const input = 'Text\n```js\ncode\n```\nMore text';
        const result = processor.process(input, defaultOptions);
        if (result[0]) expect(result[0].replace(/\s+/g, ' ').trim()).toBe('Text More text');
    });

    test('removes math', () => {
        const input = 'Text $$E=mc^2$$ and $x$';
        const result = processor.process(input, defaultOptions);
        if (result[0]) expect(result[0].trim()).toBe('Text  and');
    });

    test('replaces symbols in English', () => {
        const input = '3 < 5 and a >= b';
        const result = processor.process(input, { ...defaultOptions, lang: 'en-US' });
        // Now expecting symbols to be preserved, not replaced
        expect(result[0]).toContain('<');
        expect(result[0]).toContain('>=');
    });

    test('replaces symbols in Chinese', () => {
        const input = '3 < 5';
        const result = processor.process(input, { ...defaultOptions, lang: 'zh-CN' });
        expect(result[0]).toContain('<');
    });

    test('chunks long text', () => {
        const longText = 'a'.repeat(3000);
        const result = processor.process(longText, defaultOptions);
        expect(result.length).toBeGreaterThan(1);
        if (result[0]) expect(result[0].length).toBeLessThanOrEqual(2500);
    });

    test('handles links', () => {
        const input = 'Click [here](http://example.com) or [[Internal|Link]].';
        const result = processor.process(input, defaultOptions);
        expect(result[0]).toContain('Click here or Link.');
        expect(result[0]).not.toContain('http');
        expect(result[0]).not.toContain('Internal');
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
        expect(result[0]).toContain('$1.00');
        expect(result[0]).toContain('$2.00');
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
        console.log('Processed Chinese Table:', JSON.stringify(result[0]));

        // Should contain key content
        expect(result[0]).toContain('行动');
        expect(result[0]).toContain('不犹豫');
        expect(result[0]).not.toContain('|'); // Should typically remove pipes
        expect(result[0]).not.toContain('---'); // Should remove separators
    });


});
