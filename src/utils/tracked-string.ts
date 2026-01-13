export class TrackedString {
    text: string;
    map: number[];

    constructor(text: string, map?: number[]) {
        this.text = text;
        if (map) {
            this.map = map;
        } else {
            this.map = new Array<number>(text.length);
            for (let i = 0; i < text.length; i++) this.map[i] = i;
        }
    }

    /**
     * Removes all occurrences matching the pattern.
     */
    remove(pattern: RegExp): void {
        this.replace(pattern, '');
    }

    /**
     * Replaces matches with a single character (e.g. '|' -> '\n').
     * Or a string. All new characters map to the start index of the match.
     */
    replace(pattern: RegExp, replacement: string): void {
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        const regex = new RegExp(pattern.source, flags);
        
        // Find all matches first
        const matches: { index: number; length: number }[] = [];
        let match;
        // Reset lastIndex just in case
        regex.lastIndex = 0;
        
        while ((match = regex.exec(this.text)) !== null) {
            matches.push({ index: match.index, length: match[0].length });
            // Safety check for zero-length matches to avoid infinite loop
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }

        if (matches.length === 0) return;

        let newText = "";
        // Pre-allocate is hard because size changes, but dynamic array is fine in V8
        const newMap: number[] = [];
        let lastCursor = 0;

        for (const m of matches) {
            // 1. Copy content before match
            if (m.index > lastCursor) {
                newText += this.text.substring(lastCursor, m.index);
                // Copy map segment
                for (let i = lastCursor; i < m.index; i++) {
                    newMap.push(this.map[i]!);
                }
            }

            // 2. Append replacement
            if (replacement.length > 0) {
                newText += replacement;
                const originIndex = this.map[m.index] ?? -1;
                for (let i = 0; i < replacement.length; i++) {
                    newMap.push(originIndex);
                }
            }

            lastCursor = m.index + m.length;
        }

        if (lastCursor < this.text.length) {
            newText += this.text.substring(lastCursor);
            for (let i = lastCursor; i < this.text.length; i++) {
                newMap.push(this.map[i]!);
            }
        }

        this.text = newText;
        this.map = newMap;
    }

    /**
     * Designed for patterns like `[Link](url)` where we want to keep "Link" (Group 1).
     * Pattern MUST have exactly one capturing group that is the part we want to keep.
     */
    keepGroup1(pattern: RegExp): void {
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        const regex = new RegExp(pattern.source, flags);
        
        const matches: { index: number; length: number; group1: string; group1Index: number }[] = [];
        regex.lastIndex = 0;

        let match;
        while ((match = regex.exec(this.text)) !== null) {
            // Safety check
            if (match[0].length === 0) {
                regex.lastIndex++;
                continue;
            }

            if (match[1] !== undefined) {
                const fullMatch = match[0];
                const groupText = match[1];
                
                let groupRelIndex = -1;
                if (fullMatch.startsWith('[[')) {
                    // [[link|alias]] or [[link]]
                    if (fullMatch.includes('|')) {
                        groupRelIndex = fullMatch.lastIndexOf(groupText, fullMatch.length - 3);
                    } else {
                        groupRelIndex = 2; // After '[['
                    }
                } else if (fullMatch.startsWith('[')) {
                    // [text](url)
                    groupRelIndex = 1; // After '['
                }
                
                // Fallback if patterns don't match assumptions
                if (groupRelIndex === -1 || fullMatch.substring(groupRelIndex, groupRelIndex + groupText.length) !== groupText) {
                    groupRelIndex = fullMatch.indexOf(groupText);
                }
                
                if (groupRelIndex !== -1) {
                    matches.push({ 
                        index: match.index, 
                        length: fullMatch.length, 
                        group1: groupText, 
                        group1Index: match.index + groupRelIndex 
                    });
                }
            }
        }

        if (matches.length === 0) return;

        let newText = "";
        const newMap: number[] = [];
        let lastCursor = 0;

        for (const m of matches) {
            // 1. Copy content before match
            if (m.index > lastCursor) {
                newText += this.text.substring(lastCursor, m.index);
                for (let i = lastCursor; i < m.index; i++) {
                    newMap.push(this.map[i]!);
                }
            }

            // 2. Append Group 1
            newText += m.group1;
            // Map for group1 comes from the original map at group1Index
            for (let k = 0; k < m.group1.length; k++) {
                newMap.push(this.map[m.group1Index + k]!);
            }

            lastCursor = m.index + m.length;
        }

        // 3. Copy tail
        if (lastCursor < this.text.length) {
            newText += this.text.substring(lastCursor);
            for (let i = lastCursor; i < this.text.length; i++) {
                newMap.push(this.map[i]!);
            }
        }

        this.text = newText;
        this.map = newMap;
    }

    /**
     * Slice the string and map, returning a new TrackedString.
     */
    slice(start: number, end?: number): TrackedString {
        const subText = this.text.slice(start, end);
        const subMap = this.map.slice(start, end);
        return new TrackedString(subText, subMap);
    }

    trim(): void {
        if (typeof this.text !== 'string') {
            this.text = String(this.text || '');
        }
        const startMatch = this.text.match(/\S/);
        const start = startMatch ? startMatch.index! : 0;
        const endMatch = this.text.match(/\s*$/);
        const end = endMatch ? endMatch.index! : this.text.length;
        
        if (start === 0 && end === this.text.length) return; 
        if (start >= end) {
            this.text = "";
            this.map = [];
            return;
        }
        
        this.text = this.text.substring(start, end);
        this.map = this.map.slice(start, end);
    }
    
    get length(): number {
        return this.text.length;
    }
}