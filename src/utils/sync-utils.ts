export interface SyncSearchParams {
    docText: string;
    wordToFind: string;
    currentDocOffset: number;
    chunkActualStart: number;
    searchWindow: number;
}

/**
 * Robustly find the index of a word in the document given various fallback strategies.
 */
export function findWordIndexInDoc(params: SyncSearchParams): number {
    const { docText, wordToFind, currentDocOffset, chunkActualStart, searchWindow } = params;
    let foundIndex = -1;

    // Strategy 1: Direct search (forward)
    const forwardSearchStart = Math.max(currentDocOffset, chunkActualStart);
    const directIdx = docText.indexOf(wordToFind, forwardSearchStart);
    if (directIdx !== -1 && (directIdx - forwardSearchStart) < searchWindow) {
        return directIdx;
    }

    // Strategy 2: Case-insensitive search (forward)
    const lowerDoc = docText.toLowerCase();
    const lowerWord = wordToFind.toLowerCase();
    const ciIdx = lowerDoc.indexOf(lowerWord, forwardSearchStart);
    if (ciIdx !== -1 && (ciIdx - forwardSearchStart) < searchWindow) {
        return ciIdx;
    }

    // Strategy 3: Fuzzy search (strip punctuation)
    const cleanWord = wordToFind.replace(/[.,;!?。，；！？、]/g, '');
    if (cleanWord.length > 0 && cleanWord !== wordToFind) {
        const fuzzyIdx = docText.indexOf(cleanWord, forwardSearchStart);
        if (fuzzyIdx !== -1 && (fuzzyIdx - forwardSearchStart) < searchWindow) {
            return fuzzyIdx;
        }
        // Try case-insensitive fuzzy
        const fuzzyCiIdx = lowerDoc.indexOf(cleanWord.toLowerCase(), forwardSearchStart);
        if (fuzzyCiIdx !== -1 && (fuzzyCiIdx - forwardSearchStart) < searchWindow) {
            return fuzzyCiIdx;
        }
    }

    // Strategy 4: Overshot Recovery (search backward within the current chunk)
    if (currentDocOffset > chunkActualStart) {
        const recoveryIdx = docText.indexOf(wordToFind, chunkActualStart);
        if (recoveryIdx !== -1 && recoveryIdx < currentDocOffset) {
            return recoveryIdx;
        }
        
        // Fuzzy recovery
        if (cleanWord.length > 0) {
            const fuzzyRecoveryIdx = docText.indexOf(cleanWord, chunkActualStart);
            if (fuzzyRecoveryIdx !== -1 && fuzzyRecoveryIdx < currentDocOffset) {
                return fuzzyRecoveryIdx;
            }
        }
    }

    return -1;
}

/**
 * Finds the index of pattern in text, allowing for optional whitespace between characters in pattern.
 */
export function fuzzyIndexOf(text: string, pattern: string, fromIndex: number): number {
    if (!pattern) return -1;
    // Escape regex special characters
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow whitespace between chars
    const regexSource = escaped.split('').join('\\s*');
    const regex = new RegExp(regexSource, 'g');
    regex.lastIndex = fromIndex;
    const match = regex.exec(text);
    return match ? match.index : -1;
}
