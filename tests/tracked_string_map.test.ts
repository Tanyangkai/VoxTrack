
import { TrackedString } from '../src/utils/tracked-string';

describe('TrackedString Mapping Test', () => {
    test('replace URL with Link maintains correct start mapping', () => {
        const url = "https://example.com/very/long/url";
        const input = `Click ${url} here`;
        const ts = new TrackedString(input);
        
        // Original Map:
        // 'C' -> 0
        // 'h' (in https) -> 6
        
        const replacement = " Link ";
        // Pattern from TextProcessor
        ts.replace(/https?:\/\/[^\s,)]+/g, replacement);
        
        console.log("Input:", input);
        console.log("Output:", ts.text);
        
        // Expected Output: "Click  Link  here"
        
        const outputLinkStart = ts.text.indexOf("Link");
        // "Click  Link  here"
        //  01234567
        // 'Link' starts at index 7 (because we replaced with " Link ", so space at 6)
        
        // Let's verify exactly
        // "Click " is 6 chars.
        // Replaced part starts at 6.
        // Replacement is " Link " (6 chars).
        // ts.text should be "Click  Link  here"
        
        expect(ts.text).toContain(" Link ");
        
        // Check Map
        // The characters in " Link " should map to the START of the match (index 6 in input)
        // input[6] is 'h' of https.
        
        const mapAtLink = ts.map[outputLinkStart];
        console.log(`Map at 'L' (index ${outputLinkStart}): ${mapAtLink}`);
        
        expect(mapAtLink).toBe(6);
        
        // Check subsequent chars
        const mapAtHere = ts.map[ts.text.indexOf("here")];
        // "here" starts after URL in input.
        // input: "Click https...url here"
        // "here" index = 6 + url.length + 1 (space)
        const expectedHereIndex = 6 + url.length + 1;
        
        console.log(`Map at 'here': ${mapAtHere}, Expected: ${expectedHereIndex}`);
        expect(mapAtHere).toBe(expectedHereIndex);
    });
});
