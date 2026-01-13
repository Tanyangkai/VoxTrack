import { TextProcessor } from '../src/text-processor';

describe('TextProcessor - Over-greedy HTML Filtering', () => {
    let processor: TextProcessor;
    const options = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'zh-CN'
    };

    beforeEach(() => {
        processor = new TextProcessor();
    });

    test('should not swallow text when a lone < is present', () => {
        const input = "Standard text. 3 < 5 is true. More standard text. <div>Real tag</div> End.";
        const result = processor.process(input, options);
        const text = result[0]!.text;
        
        expect(text).toContain("3 小于 5"); // Symbols < replaced by text
        expect(text).not.toContain("<div>"); // Should still remove real tags
        expect(text).toContain("More standard text");
    });
});
