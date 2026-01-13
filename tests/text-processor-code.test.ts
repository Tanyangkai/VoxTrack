import { TextProcessor } from '../src/text-processor';

describe('TextProcessor - Inline Code Handling', () => {
    let processor: TextProcessor;
    const defaultOptions = {
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

    test('Should preserve inline code but map it correctly', () => {
        // Case from user: `shift + enter`
        // Input: "选中上面的 Cell 之后按快捷键 `shift + enter`。"
        // Note: The processor replaces backticks with spaces.
        // So `shift + enter` becomes  shift + enter .
        // The text content is preserved (minus backticks).
        
        const input = "选中上面的 Cell 之后按快捷键 `shift + enter`。";
        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        // Expected processed text:
        // "选中上面的 Cell 之后按快捷键  shift + enter  。" (spaces might be collapsed)
        // Backticks are replaced by space.
        // " + " is preserved.
        
        console.log('Processed:', chunk.text);
        
        // Check if "shift" is present
        expect(chunk.text).toContain("shift");
        
        // Check map for "shift"
        const shiftIdx = chunk.text.indexOf("shift");
        const mapVal = chunk.map[shiftIdx];
        const expected = input.indexOf("shift");
        
        expect(mapVal).toBe(expected);
    });

    test('Scenario: TTS reads "+" as "plus" (Symbol Expansion)', () => {
        // Input: `shift + enter`
        // Lang: zh-CN -> "shift 加 enter"
        // Lang: en-US -> "shift plus enter"
        
        const input = "`shift + enter`";
        
        // Test Chinese Expansion
        const resCN = processor.process(input, { ...defaultOptions, lang: 'zh-CN' });
        expect(resCN[0].text).toContain("shift 加 enter");
        
        // Check Map: "加" should point to "+"
        const jiaIdx = resCN[0].text.indexOf("加");
        const plusIdx = input.indexOf("+");
        expect(resCN[0].map[jiaIdx]).toBe(plusIdx);

        // Test English Expansion
        const resEN = processor.process(input, { ...defaultOptions, lang: 'en-US' });
        expect(resEN[0].text).toContain("shift plus enter");
    });
});