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
        const matches: { index: number; length: number }[] = [];
        // Ensure global flag to find all matches if intended, though loop handles it manually if sticky/global used correctly.
        // Safer to construct a global regex if not provided, or use a loop with exec.
        
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        const regex = new RegExp(pattern.source, flags);
        
        let match;
        while ((match = regex.exec(this.text)) !== null) {
            matches.push({ index: match.index, length: match[0].length });
        }

        // Process from end to start to maintain indices
        for (let i = matches.length - 1; i >= 0; i--) {
            const matchItem = matches[i];
            if (!matchItem) continue;
            const { index, length } = matchItem;
            this.text = this.text.slice(0, index) + this.text.slice(index + length);
            this.map.splice(index, length);
        }
    }

    /**
     * Replaces matches with a single character (e.g. '|' -> '\n').
     * If replacement is longer than 1 char, it fills map with the index of the start of match.
     */
    replace(pattern: RegExp, replacement: string): void {
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        const regex = new RegExp(pattern.source, flags);
        
        const matches: { index: number; length: number; matchStr: string }[] = [];
        let match;
        while ((match = regex.exec(this.text)) !== null) {
            matches.push({ index: match.index, length: match[0].length, matchStr: match[0] });
        }

        for (let i = matches.length - 1; i >= 0; i--) {
            const matchItem = matches[i];
            if (!matchItem) continue;
            const { index, length } = matchItem;
            
            // Construct new text
            // Note: replacement might depend on match if we supported that, but here we assume static string
            // However, JS replace supports '$&' etc. We assume simple string for now as per TextProcessor needs.
            
            const head = this.text.slice(0, index);
            const tail = this.text.slice(index + length);
            this.text = head + replacement + tail;

            // Construct new map segment
            // We map all new characters to the start index of the match (or we could distribute them)
            const originIndex = this.map[index]; 
            const newMapSegment = new Array<number>(replacement.length).fill(originIndex);

            // Update map
            this.map.splice(index, length, ...newMapSegment);
        }
    }

    /**
     * Designed for patterns like `[Link](url)` where we want to keep "Link" (Group 1).
     * Pattern MUST have exactly one capturing group that is the part we want to keep.
     */
    keepGroup1(pattern: RegExp): void {
        const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
        const regex = new RegExp(pattern.source, flags);
        
        const matches: { index: number; length: number; group1: string; group1Index: number }[] = [];
        let match;
        while ((match = regex.exec(this.text)) !== null) {
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

        for (let i = matches.length - 1; i >= 0; i--) {
            const matchItem = matches[i];
            if (!matchItem) continue;
            const { index, length, group1, group1Index } = matchItem;
            
            this.text = this.text.slice(0, index) + group1 + this.text.slice(index + length);
            
            // We need to keep the map segment corresponding to group1
            // The map for the whole match is at this.map[index ... index+length]
            // The map for group1 is at this.map[group1Index ... group1Index + group1.length]
            
            const groupMap = this.map.slice(group1Index, group1Index + group1.length);
            this.map.splice(index, length, ...groupMap);
        }
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
