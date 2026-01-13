
import { TextProcessor } from '../../src/text-processor';

describe('Long Document Drift & Mismatch Reproduction', () => {
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

    test('Verification: Map integrity after massive length changes (expansion)', () => {
        // Construct a text where we replace '|' (1 char) with ', ' (2 chars) many times.
        // Input: "|".repeat(1000) + "Magic"
        // Output: ", , ... , Magic"
        // Check if "Magic" map points to 1000.
        
        const count = 1000;
        const input = "|".repeat(count) + "Magic";
        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        const magicIndex = chunk.text.indexOf("Magic");
        expect(magicIndex).not.toBe(-1);
        
        const mapValue = chunk.map[magicIndex];
        expect(mapValue).toBe(count); // Should point to index 1000 in original
    });

    test('Verification: Map integrity after massive length changes (reduction)', () => {
        // Input: "```code```".repeat(100) + "Magic"
        // Output: "Magic" (since code is removed)
        // Check "Magic" map.
        
        const block = "```\ncode\n```\n";
        const count = 100;
        const input = block.repeat(count) + "Magic";
        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        expect(chunk.text.trim()).toBe("Magic");
        const mapValue = chunk.map[chunk.text.indexOf("Magic")];
        
        expect(mapValue).toBe(block.length * count);
    });

    test('Edge Case: Nested/Complex Code Blocks', () => {
        // Markdown allows 4 backticks to wrap 3 backticks.
        // Our regex `/```[\s\S]*?```/` matches the first pair of triple backticks.
        // Input: ```` \n ``` \n inner \n ``` \n ```` \n Magic
        // Regex `/```[\s\S]*?```/` will match:
        // ```` \n ```
        // It consumes the first 3 ticks of the opener, and the first 3 ticks of the nested opener?
        // No. ```` starts with ```. 
        // `[\s\S]*?` matches ` \n `.
        // ```` matches the first 3 ticks of the nested opener.
        
        // Let's trace:
        // Input: "````\n```\ninner\n```\n````\nMagic"
        // Match 1: "```" (at 0) ... "```" (at 5, the nested opener)
        // Removed.
        // Remaining: "`\ninner\n```\n````\nMagic"
        // Match 2: "```" (at 8, nested closer) ... "```" (at 12, outer closer)
        // Removed.
        // Remaining: "`\n``\nMagic"
        
        // This corruption changes the structure, but does it mess up the MAP?
        // `TrackedString` just deletes ranges. The remaining characters should still point to their original locations.
        // So "Magic" should still point to original "Magic".
        
        const input = "````\n```\ninner\n```\n````\nMagic";
        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        const magicIdx = chunk.text.indexOf("Magic");
        expect(magicIdx).not.toBe(-1);
        
        const mapVal = chunk.map[magicIdx];
        const expected = input.indexOf("Magic");
        expect(mapVal).toBe(expected);
        
        console.log('Complex Code Block Output:', chunk.text);
    });

    test('Drift Repro: Emoji and Surrogate Pairs', () => {
        // Emoji like 🏳️‍🌈 are multiple code units.
        // Regex `.` matches only one unit. `[\s\S]` matches all.
        // Our emoji regex removes them.
        
        const input = "Start 🏳️‍🌈 End";
        // 🏳️‍🌈 is \uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08 (approx 6-8 chars depending on composition)
        // "Start " (6) + Emoji + " End" (4)
        
        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        expect(chunk.text).toBe("Start End"); // Emoji removed, double space collapsed to 1
        
        const endIdx = chunk.text.indexOf("End");
        const mapVal = chunk.map[endIdx];
        const expected = input.indexOf("End");
        
        expect(mapVal).toBe(expected);
    });

    test('Drift Repro: Jupyter Notebook style "Magics"', () => {
        // Simulating the log content structure
        const input = `
Some text before.
{
 "cells": [
  {
   "cell_type": "code",
   "source": [
    "%load_ext autoreload\n",
    "%autoreload 2"
   ]
  }
 ]
}
Magic
`;
        // If filterCode is TRUE, does it remove JSON? 
        // No, JSON is just text unless wrapped in ```json
        // But if the user puts code in ``` blocks:
        
        const inputWithCode = `
Text
\
\
json
{\"key\": \"value\" }
\
\
Magic
`;
        const result = processor.process(inputWithCode, defaultOptions);
        const chunk = result[0];
        
        const magicIdx = chunk.text.indexOf("Magic");
        expect(magicIdx).not.toBe(-1);
        expect(chunk.map[magicIdx]).toBe(inputWithCode.indexOf("Magic"));
    });

    test('Drift Repro: Mixed replacements sequence', () => {
        // 1. Remove Frontmatter (large block at start)
        // 2. Remove Code (middle)
        // 3. Replace Links (length change)
        // 4. Replace special chars (length change)
        // 5. Final map check
        
        const input = `---
title: Test
---
Header 1
========

Some text with [Link](http://url) and **Bold**.

\
\
javascript
console.log("Code");
\
\

More text.
Final Word.`;

        const result = processor.process(input, defaultOptions);
        const chunk = result[0];
        
        // "Final"
        const finalIdx = chunk.text.indexOf("Final");
        const mapVal = chunk.map[finalIdx];
        const expected = input.indexOf("Final");
        
        expect(mapVal).toBe(expected);
    });
});
