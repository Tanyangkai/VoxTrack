import { TrackedString } from './utils/tracked-string';

export interface TextProcessorOptions {
    filterCode: boolean;
    filterLinks: boolean;
    filterMath: boolean;
    filterFrontmatter: boolean;
    filterObsidian: boolean;
    lang: string;
}

export interface ProcessedChunk {
    text: string;
    map: number[];
}

export class TextProcessor {
    constructor() { }

    public process(text: string, options: TextProcessorOptions): ProcessedChunk[] {
        // Initialize TrackedString with original text and 1-to-1 map
        const ts = new TrackedString(text);

        // 1. Structural Filters (Large blocks) - Pure Removal
        if (options.filterFrontmatter) {
            ts.remove(/^---[\s\S]*?---\n?/);
        }
        if (options.filterCode) {
            ts.remove(/```[\s\S]*?```/);
            ts.remove(/`[^`\n]+`/);
        }
        if (options.filterMath) {
            ts.replace(/\$\$[\s\S]*?\$\$/g, ' ');
            ts.replace(/\$((?:\\\$|[^$\n])+?)\$/g, ' ');
        }
        if (options.filterObsidian) {
            ts.remove(/>\s*\[!.*\][^\n]*\n/); // Callout headers
            ts.remove(/%%[\s\S]*?%%/); // Comments
            ts.remove(/<!--[\s\S]*?-->/); // HTML Comments
            ts.remove(/<[a-zA-Z/][^>]*>/); // Generic HTML tags (like <br>, <div>)
            ts.remove(/\^[\w-]+/); // Block IDs
        }

        // 2. Link Processing
        if (options.filterLinks) {
            // [text](url) -> text (Group 1)
            ts.keepGroup1(/\[([^\]]+)\]\([^)]+\)/);
            // [[link|text]] -> text (Group 1 is what we want)
            ts.keepGroup1(/\[\[[^\]|]+\|([^\]]+)\]\]/);
            // [[link]] -> link (Group 1)
            ts.keepGroup1(/\[\[([^\]]+)\]\]/);
        } else {
            // Basic link cleanup even if keeping text
            ts.keepGroup1(/\[([^\]]+)\]\([^)]+\)/);
            ts.keepGroup1(/\[\[[^\]|]+\|([^\]]+)\]\]/);
            ts.keepGroup1(/\[\[([^\]]+)\]\]/);
        }

        // 3. Media Removal
        ts.remove(/!\[([^\]]*)\]\([^)]*\)/);
        ts.remove(/!\[\[[^\]]*\]\]/);

        // Remove Emoji
        // eslint-disable-next-line no-misleading-character-class -- Emoji ranges are complex and valid here
        ts.remove(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F0F5}\u{1F200}-\u{1F270}\u{FE0F}]/u);

        // 4. Structure Cleanup
        // Specifically remove table separator rows before replacing pipes
        ts.replace(/^\s*[|:-\s]+\s*$/gm, '');

        // 5. Common Filter (Pipes) - 1-to-1 Replacement
        // Use comma to encourage continuous reading rather than newlines
        ts.replace(/\|/g, ', ');

        // Formatting chars: * _ ` ~ -> space
        ts.replace(/[*_`~]/g, ' ');

        // Headers/Quotes/List markers
        ts.replace(/^\s*[#>-]+\s*/gm, ' ');

        // Collapse multiple spaces to single space (helps with segmentation)
        ts.replace(/ +/g, ' ');

        // 7. Final Cleanup
        ts.replace(/\n{3,}/g, '\n\n');

        // Trim
        ts.trim();

        return this.chunk(ts);
    }

    private chunk(ts: TrackedString, maxLen: number = 2500): ProcessedChunk[] {
        if (ts.length <= maxLen) return [{ text: ts.text, map: ts.map }];

        const chunks: ProcessedChunk[] = [];
        let remaining = ts;

        while (remaining.length > 0) {
            if (remaining.length <= maxLen) {
                chunks.push({ text: remaining.text, map: remaining.map });
                break;
            }

            let cut = maxLen;
            const checkWindow = Math.floor(maxLen * 0.2);
            const textStr = remaining.text;

            let found = textStr.lastIndexOf('\n\n', cut);
            if (found > cut - checkWindow) {
                cut = found + 2;
            } else {
                found = textStr.lastIndexOf('. ', cut);
                if (found > cut - checkWindow) {
                    cut = found + 2;
                } else {
                    // Chinese sentence boundaries
                    found = -1;
                    const punts = ['。', '！', '？', '；', '：'];
                    for (const p of punts) {
                        const idx = textStr.lastIndexOf(p, cut);
                        if (idx > found) found = idx;
                    }

                    if (found > cut - checkWindow) {
                        cut = found + 1;
                    } else {
                        found = textStr.lastIndexOf(', ', cut);
                        if (found > cut - checkWindow) cut = found + 2;
                        else {
                            // Chinese comma
                            found = textStr.lastIndexOf('，', cut);
                            if (found > cut - checkWindow) cut = found + 1;
                            else {
                                found = textStr.lastIndexOf(' ', cut);
                                if (found > cut - checkWindow) cut = found + 1;
                            }
                        }
                    }
                }
            }

            chunks.push({
                text: remaining.text.substring(0, cut),
                map: remaining.map.slice(0, cut)
            });
            remaining = remaining.slice(cut);
        }

        return chunks;
    }
}