
import { TextProcessor } from '../src/text-processor';

const text = `1.定义：审美是人类通过感知过滤，对事物呈现出的和谐、秩序或独特性进行价值评价的能力。它不只是看漂亮与否，而是大脑在识别高品质信息。就像舌头能瞬间分辨出美食还是腐肉，审美是精神上的味觉，帮我们从混乱的世界中筛选出那些具有生命力、协调感和深层逻辑的事物。

识别出问题是否值得解决？
识别出问题的解决方案是否足够完美？

2.跨界迁移

逻辑提取：识别事物内部规律与外部表现的高度统一，并将其转化为优选信号的评估机制。

1. 生物演化：雄孔雀开屏。雌孔雀的审美其实是在检测对方的基因健康度，繁复对称的羽毛是无病害、高能量的视觉证明，审美在这里变成了生物生存质量的质检仪。
2. 科学理论：物理学公式。物理学家追求公式美，即用最简单的数学形式描述最复杂的宇宙规律，这种审美本质上是对自然界底层逻辑简约性的敏锐捕捉。
3. 软件工程：代码编写。优秀的程序员追求优雅的代码。这种审美不只是为了视觉整洁，而是通过逻辑的自洽与简洁来降低系统的复杂熵增，审美在这里是对程序可维护性与运行效率的直觉预判。`;

const processor = new TextProcessor();
const chunks = processor.process(text, {
    filterCode: true,
    filterLinks: true,
    filterMath: true,
    filterFrontmatter: true,
    filterObsidian: true,
    lang: 'zh-CN'
});

console.log(`Total Chunks: ${chunks.length}`);

for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n=== Chunk ${i} ===`);
    console.log(`Text Length: ${chunk.text.length}`);
    console.log(`Text Content (Start): ${chunk.text.substring(0, 50)}...`);
    console.log(`Text Content (End): ...${chunk.text.substring(chunk.text.length - 50)}`);
    console.log(`Full Text: ${JSON.stringify(chunk.text)}`);

    // Find where the "missing" text went
    const missingStart = "和谐";
    const missingEnd = "最";

    // Check map continuity around "和谐"
    const startIdx = chunk.text.indexOf(missingStart);
    if (startIdx !== -1) {
        console.log(`FOUND "${missingStart}" at index ${startIdx}`);
        // Print context
        console.log(`Map at ${startIdx} ("${chunk.text[startIdx]}"): ${chunk.map[startIdx]}`);
        console.log(`Map at ${startIdx + 1} ("${chunk.text[startIdx + 1]}"): ${chunk.map[startIdx + 1]}`);

        // Check map for the next 50 chars
        console.log('--- Map Check for next 50 chars ---');
        for (let k = 0; k < 50 && startIdx + k < chunk.text.length; k++) {
            const char = chunk.text[startIdx + k];
            const originalIdx = chunk.map[startIdx + k];
            process.stdout.write(`${char}(${originalIdx}) `);
        }
        console.log('\n-----------------------------------');
    }

    const endIdx = chunk.text.indexOf(missingEnd);
    if (endIdx !== -1) {
        console.log(`FOUND "${missingEnd}" at index ${endIdx}`);
        console.log(`Map at ${endIdx} ("${chunk.text[endIdx]}"): ${chunk.map[endIdx]}`);
    }
}
