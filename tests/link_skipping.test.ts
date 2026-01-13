
import { TextProcessor } from '../src/text-processor';

describe('Link Skipping Bug', () => {
    let processor: TextProcessor;

    beforeEach(() => {
        processor = new TextProcessor();
    });

    test('Should not skip text when link syntax is incomplete/broken across newlines', () => {
        const input = `> * [sphinx.ext.autodoc – Include documentation from docstrings](

## D.6.保存到文件的函数

写好的函数，当然最好保存起来，以便将来随时调用。

def is_prime(n):
    """
    Return a boolean value based upon
    """
`;

        const chunks = processor.process(input, {
            filterCode: false,
            filterLinks: true, // This enables the faulty regex
            filterMath: false,
            filterFrontmatter: false,
            filterObsidian: false,
            lang: 'en'
        });

        const processedText = chunks.map(c => c.text).join(' ');

        // Debug output
        console.log('Processed Text:', processedText);

        // Expectation: The text "保存到文件的函数" (Save function to file) should be present.
        // If the bug exists, this text will be eaten by the regex.
        expect(processedText).toContain('保存到文件的函数');
        // Underscores are replaced by spaces in text processor
        expect(processedText).toContain('is prime');
    });
});
