
import { TextProcessor } from '../src/text-processor';

describe('Issue Repro: Mismatch and Socket Close', () => {
    const processor = new TextProcessor();
    const options = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'zh-CN'
    };

    test('Markdown Link Processing with Real Class', () => {
        const input = "这是一个链接: https://github.com/dwyl/english-words；以及一个Markdown链接: [English Words](https://github.com/dwyl/english-words)";
        
        const chunks = processor.process(input, options);
        const processedText = chunks.map(c => c.text).join('');

        console.log("Input:", input);
        console.log("Processed:", processedText);

        expect(processedText).not.toContain("https://");
        expect(processedText).toContain(" Link ");
        expect(processedText).toContain("English Words");
    });

    test('URL with parentheses', () => {
        const input = "URL with parens: [Text](https://example.com/foo(bar))";
        const chunks = processor.process(input, options);
        const processedText = chunks.map(c => c.text).join('');

        console.log("Input 2:", input);
        console.log("Processed 2:", processedText);
        
        // Even if regex fails partially, we expect URL to be gone or replaced
        expect(processedText).not.toContain("https://");
    });
    
    test('Raw URL only', () => {
         const input = "Visit https://google.com for more info.";
         const chunks = processor.process(input, options);
         const processedText = chunks.map(c => c.text).join('');
         
         console.log("Input 3:", input);
         console.log("Processed 3:", processedText);
         
         expect(processedText).toBe("Visit Link for more info.");
    });
});
