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
        expect(result[0]).toContain('less than');
        expect(result[0]).toContain('greater than or equal to');
    });

    test('replaces symbols in Chinese', () => {
        const input = '3 < 5';
        const result = processor.process(input, { ...defaultOptions, lang: 'zh-CN' });
        expect(result[0]).toContain('小于');
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
});
