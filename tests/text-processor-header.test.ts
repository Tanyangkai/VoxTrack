
import { TextProcessor } from '../src/text-processor';

describe('TextProcessor Header Filtering', () => {
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

    it('should remove markdown header symbols (#) from processed text', () => {
        const input = "### 操作符";
        const chunks = processor.process(input, defaultOptions);
        const processedText = chunks[0].text;

        // We expect the '#' symbols to be removed or replaced by space.
        // If TTS reads "Hashtag Hashtag Hashtag", it means they are present.
        // The user says "不能读出声" (should not be read aloud).
        // So we expect "操作符" or " 操作符".
        
        expect(processedText).not.toContain('#');
        expect(processedText.trim()).toBe('操作符');
    });

    it('should handle list markers and blockquotes similarly', () => {
        const input = `
> 引用
- 列表项
`;
        const chunks = processor.process(input, defaultOptions);
        const text = chunks.map(c => c.text).join('');
        
        expect(text).not.toContain('>');
        expect(text).not.toContain('-');
        expect(text).toContain('引用');
        expect(text).toContain('列表项');
    });
});
