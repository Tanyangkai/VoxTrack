
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
        let processed = text;

        // 1. Structural Filters (Large blocks)
        if (options.filterFrontmatter) {
            processed = this.removeFrontmatter(processed);
        }
        if (options.filterCode) {
            processed = this.removeCodeBlocks(processed);
        }
        if (options.filterMath) {
            processed = this.removeMath(processed);
        }
        if (options.filterObsidian) {
            processed = this.removeObsidianSyntax(processed);
        }

        // 2. Link Processing (Must be before pipe removal)
        if (options.filterLinks) {
            processed = this.simplifyLinks(processed);
        } else {
            // Basic link cleanup even if keeping text
            processed = processed.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            processed = processed.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
            processed = processed.replace(/\[\[([^\]]+)\]\]/g, '$1');
        }

        // 3. Media Removal
        processed = this.removeMedia(processed);
        // Remove Emoji to prevent TTS from reading descriptions (misaligning sync)
        processed = processed.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F0F5}\u{1F200}-\u{1F270}\u{FE0F}]/gu, '');

        // 4. Common Filter (Pipes) - After links
        processed = this.filterCommon(processed);

        // 5. Structure Cleanup (Headers, Quotes, Lists)
        // Remove formatting chars except '=' which is needed for symbols
        processed = processed.replace(/^\s*[-:\s]+\s*$/gm, ''); // Empty list items/dividers
        // Replace formatting chars with space to prevent concatenating words (e.g. A*B -> AB)
        processed = processed.replace(/[*_`~]/g, ' '); 
        processed = processed.replace(/^[#>-]+\s*/gm, ''); // Headers/Quotes

        // 6. Symbol Replacement (Handle >=, <, etc)
        // processed = this.replaceSymbols(processed, options.lang);

        // 7. Final Cleanup (Orphaned =)
        // processed = processed.replace(/=/g, ''); // REMOVED: Breaks >=, <=, etc.
        processed = processed.replace(/\n{3,}/g, '\n\n');

        // Trim first to ensure clean start/end
        const trimmed = processed.trim();
        const map = this.computeSourceMap(text, trimmed);

        return this.chunk(trimmed, map);
    }

    private computeSourceMap(raw: string, processed: string): number[] {
        const map: number[] = new Array(processed.length).fill(-1);
        let rawIdx = 0;

        for (let procIdx = 0; procIdx < processed.length; procIdx++) {
            const procChar = processed[procIdx];
            
            // Potential raw candidates for the current procChar:
            // 1. procChar itself
            // 2. If procChar is '\n', raw could be '|'
            // 3. If procChar is ' ', raw could be '*', '_', '`', '~'
            
            const candidates = [procChar];
            if (procChar === '\n') candidates.push('|');
            if (procChar === ' ') candidates.push('*', '_', '`', '~');
            
            let bestMatchIdx = -1;
            let minDist = Infinity;
            
            for (const cand of candidates) {
                const found = raw.indexOf(cand, rawIdx);
                if (found !== -1 && found < minDist) {
                    minDist = found;
                    bestMatchIdx = found;
                }
            }
            
            if (bestMatchIdx !== -1) {
                map[procIdx] = bestMatchIdx;
                rawIdx = bestMatchIdx + 1;
            }
        }
        return map;
    }

    private removeFrontmatter(text: string): string {
        return text.replace(/^---[\s\S]*?---\n?/, '');
    }

    private removeCodeBlocks(text: string): string {
        return text
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, ''); // Inline code
    }

    private removeMath(text: string): string {
        return text
            .replace(/\$\$[\s\S]*?\$\$/g, '')
            .replace(/\$[^$\n]+\$/g, '');
    }

    private removeObsidianSyntax(text: string): string {
        return text
            .replace(/>\s*\[!.*\][^\n]*\n/g, '') // Callout headers
            .replace(/%%[\s\S]*?%%/g, '') // Comments
            .replace(/<!--[\s\S]*?-->/g, '') // HTML Comments
            .replace(/\^[\w-]+/g, ''); // Block IDs
    }

    private removeMedia(text: string): string {
        return text
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
            .replace(/!\[\[[^\]]*\]\]/g, '');
    }

    private filterCommon(text: string): string {
        return text.replace(/\|/g, '\n');
    }

    private simplifyLinks(text: string): string {
        return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
            .replace(/\[\[([^\]]+)\]\]/g, '$1');
    }

    // private replaceSymbols(text: string, lang: string): string {
    //     const isZh = lang.startsWith('zh');
    //     const map: Record<string, string> = isZh ? {
    //         '<': '小于',
    //         '>': '大于',
    //         '<=': '小于等于',
    //         '>=': '大于等于',
    //         '=': '等于',
    //         '+': '加'
    //     } : {
    //         '<': ' less than ',
    //         '>': ' greater than ',
    //         '<=': ' less than or equal to ',
    //         '>=': ' greater than or equal to ',
    //         '=': ' equals ',
    //         '+': ' plus '
    //     };

    //     let res = text;
    //     const keys = Object.keys(map).sort((a, b) => b.length - a.length);

    //     for (const sym of keys) {
    //         const word = map[sym];
    //         if (word) {
    //             const escapedSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    //             const re = new RegExp(`(?<=\\s|\\d)${escapedSym}(?=\\s|\\d)`, 'g');
    //             res = res.replace(re, word);
    //         }
    //     }

    //     return res;
    // }

    private chunk(text: string, map: number[], maxLen: number = 2500): ProcessedChunk[] {
        if (text.length <= maxLen) return [{ text, map }];

        const chunks: ProcessedChunk[] = [];
        let remaining = text;
        let remainingMap = map;

        while (remaining.length > 0) {
            if (remaining.length <= maxLen) {
                chunks.push({ text: remaining, map: remainingMap });
                break;
            }

            let cut = maxLen;
            const checkWindow = Math.floor(maxLen * 0.2);

            let found = remaining.lastIndexOf('\n\n', cut);
            if (found > cut - checkWindow) {
                cut = found + 2;
            } else {
                found = remaining.lastIndexOf('. ', cut);
                if (found > cut - checkWindow) {
                    cut = found + 2;
                } else {
                    found = remaining.lastIndexOf(', ', cut);
                    if (found > cut - checkWindow) cut = found + 2;
                    else {
                        found = remaining.lastIndexOf(' ', cut);
                        if (found > cut - checkWindow) cut = found + 1;
                    }
                }
            }

            chunks.push({
                text: remaining.substring(0, cut),
                map: remainingMap.slice(0, cut)
            });
            remaining = remaining.substring(cut);
            remainingMap = remainingMap.slice(cut);
        }

        return chunks;
    }
}
