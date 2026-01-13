
import { TextProcessor } from '../src/text-processor';

describe('TextProcessor Table Handling', () => {
    let processor: TextProcessor;

    beforeEach(() => {
        processor = new TextProcessor();
    });

    test('should handle markdown tables without creating excessive punctuation', () => {
        const tableText = `
| Column 1 | Column 2 | Column 3 |
| :--- | :--- | :--- |
| Value 1 | Value 2 | Value 3 |
| Short | Data | Here |
`;

        // Current implementation produces something like:
        // ,  Column 1 ,  Column 2 ,  Column 3 , 
        // ,  Value 1 ,  Value 2 ,  Value 3 , 
        // ,  Short ,  Data ,  Here , 

        // We want to avoid excessive commas that might confuse TTS or mapping

        const chunks = processor.process(tableText, {
            filterCode: false,
            filterLinks: false,
            filterMath: false,
            filterFrontmatter: false,
            filterObsidian: false,
            lang: 'zh-CN'
        });

        // Debug output to see what is actually produced
        console.log('Processed Table Text:', chunks[0].text);

        // Expectation: The text should not be riddled with commas for every cell boundary
        // We prefer spaces or single commas

        const processedText = chunks[0].text;

        // Assert that we don't have double commas or comma-space-comma sequences
        expect(processedText).not.toMatch(/, ,/);
        expect(processedText).not.toMatch(/,  ,/);

        // Assert that we have reasonable content
        expect(processedText).toContain('Value 1');
        expect(processedText).toContain('Value 2');
    });

    test('should handle empty table cells gracefully', () => {
        const text = `| A | | B |`;
        const chunks = processor.process(text, {
            filterCode: false,
            filterLinks: false,
            filterMath: false,
            filterFrontmatter: false,
            filterObsidian: false,
            lang: 'zh-CN'
        });

        console.log('Processed Empty Cells:', chunks[0].text);

        // Should not produce ", , , "
        expect(chunks[0].text).not.toMatch(/,(\s*),/);
    });
});
