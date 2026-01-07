
class TextProcessor {
    process(text, options) {
        let processed = text;

        if (options.filterFrontmatter) processed = this.removeFrontmatter(processed);
        if (options.filterCode) processed = this.removeCodeBlocks(processed);
        if (options.filterMath) processed = this.removeMath(processed);
        if (options.filterObsidian) processed = this.removeObsidianSyntax(processed);

        if (options.filterLinks) {
            processed = this.simplifyLinks(processed);
        }

        processed = this.removeMedia(processed);
        // Emoji removal
        processed = processed.replace(/[f600-f64ff300-f5fff680-f6fff1e0-f1ff600-6ff700-7bff900-f9fff018-f0f5f200-f270fef0]/gu, '');

        processed = this.filterCommon(processed);

        processed = processed.replace(/^\s*[-:\s]+\s*$/gm, ''); 
        processed = processed.replace(/[*_`~]/g, ''); 
        processed = processed.replace(/^[#>-]+\s*/gm, ''); 

        processed = processed.replace(/\n{3,}/g, '\n\n');

        return [processed.trim()];
    }

    removeFrontmatter(text) { return text.replace(/^---[\s\S]*?---\n?/, ''); }
    removeCodeBlocks(text) { return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, ''); }
    removeMath(text) { return text.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/\$[^\$\n]+\$/g, ''); }
    removeObsidianSyntax(text) { return text.replace(/>\s*\[!.*\].*[\n]*/g, '').replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\^[w-]+/g, ''); }
    removeMedia(text) { return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '').replace(/!\[\[[^\]]*\]\]/g, ''); }
    filterCommon(text) { return text.replace(/\|/g, '\n'); }
    simplifyLinks(text) {
        return text.replace(/\b([^\]]+)\]\([^)]+\)/g,'$1')
            .replace(/\b\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
            .replace(/\b\[\[([^\]]+)\]\]/g, '$1');
    }
}

const processor = new TextProcessor();
const options = {
    filterCode: true,
    filterLinks: true,
    filterMath: true,
    filterFrontmatter: true,
    filterObsidian: true,
    lang: 'zh-CN'
};

const input = `| **维度**   | **🏗️ 造 (Create)**        | **🛠️ 用 (Use)**          | **🏋️ 练 (Practice)**   | **📖 学 (Learn)**            |
| -------- | ------------------------- | ------------------------ | ---------------------- | --------------------------- |
| **本质**   | **从 0 到 1**。构建一个完整的系统或作品。 | **解决实际问题**。将工具投入实战场景。    | **刻意练习**。拆解动作，重复强化。    | **获取信息**。阅读、听课、观察。          |`;

console.log("=== Input Source ===");
console.log(input);

const result = processor.process(input, options);
const processedText = result[0];

console.log("\n=== Processed Text (Sent to TTS) ===");
console.log(processedText);

// Simulate TTS words (splitting by whitespace/punctuation as a rough approximation)
// In reality Edge TTS sends specific words.
const ttsWords = processedText.match(/[一-龥]+|[a-zA-Z0-9]+|[0-9]+/g); 

console.log("\n=== Simulated TTS Words ===");
console.log(ttsWords);

console.log("\n=== Sync Simulation ===");
let currentDocOffset = 0;

if (!ttsWords) {
    console.log("No words found!");
    process.exit(1);
}

for (const word of ttsWords) {
    let foundIndex = input.indexOf(word, currentDocOffset);
    
    // Simple fallback logic from main.ts
    if (foundIndex === -1) {
         // Try case-insensitive
         const lowerDoc = input.toLowerCase();
         const lowerWord = word.toLowerCase();
         foundIndex = lowerDoc.indexOf(lowerWord, currentDocOffset);
    }

    if (foundIndex !== -1) {
        console.log(`✅ Found "${word}" at ${foundIndex} (Offset delta: ${foundIndex - currentDocOffset})`);
        
        // Match length logic
        const matchedStr = input.substring(foundIndex, foundIndex + word.length);
        if (matchedStr !== word) {
             console.log(`   (Matched "${matchedStr}" loosely)`);
        }
        
        currentDocOffset = foundIndex + word.length; // Note: main.ts logic might differ slightly (cleanWord length)
    } else {
        console.log(`❌ Failed to find "${word}" after ${currentDocOffset}`);
    }
}
