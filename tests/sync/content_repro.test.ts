
import { TextProcessor } from '../../src/text-processor';
import { findWordIndexInDoc } from '../../src/utils/sync-utils';

const FULL_TEXT = `#### [[心理建设]]

当我们开始学习一项新技能的时候，我们的大脑会不由自主地紧张。可这只不过是多年之间在学校里不断受挫的积累效应 —— 学校里别的地方不一定行，可有个地方特别行：给学生制造全方位、无死角、层层递进的挫败感。

可是，你要永远记住两个字：

> 别怕！

用四个字也行：

> 啥也别怕！

六个字也可以：

> 没什么可怕的！

我遇到最多的孱弱之语大抵是这样的：

> 我一个文科生……

哈哈，从某个层面望过去，其实吧，编程既不是文科也不是理科…… 它更像是 “手工课”。你越学就越清楚这个事实，它就好像是你做木工一样，学会使用一个工具，再学会使用另外一个工具，其实总共就没多少工具。然后，你更多做的是各种拼接的工作，至于能做出什么东西，最后完全靠你的想象力……

十来岁的孩子都可以学会的东西，你怕什么？

**别怕**，无论说给自己，还是讲给别人，都是一样的，它可能是人生中最重要的鼓励词。

#### 关于这一部分内容中的代码

${".".repeat(2000)}

2015 年，乔治・布尔诞辰 200 周年，Google 设计了[专门的 Logo](https://www.google.com/doodles/george-booles-200th-birthday) 纪念这位为人类作出巨大贡献的自学奇才。`;

describe('Content Based Reproduction of Highlighting Jump', () => {
    const processor = new TextProcessor();
    const options = {
        filterCode: true,
        filterLinks: true,
        filterMath: true,
        filterFrontmatter: true,
        filterObsidian: true,
        lang: 'zh-CN'
    };

    test('TextProcessor should correctly map ellipses and subsequent text', () => {
        const chunks = processor.process(FULL_TEXT, options);
        // Find the chunk containing the problematic sentence
        const targetSentence = "编程既不是文科也不是理科";

        let foundChunk: any = null;
        let chunkIndex = -1;

        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].text.includes(targetSentence)) {
                foundChunk = chunks[i];
                chunkIndex = i;
                break;
            }
        }

        expect(foundChunk).toBeDefined();

        // Check text content in the processor output
        // "编程既不是文科也不是理科…… 它更像是"
        // Processor might replace "……" with space or similar.
        console.log('Processed Chunk Text:', foundChunk.text);

        // Verify mapping back to original text
        const processedIndex = foundChunk.text.indexOf("它更像是");
        expect(processedIndex).toBeGreaterThan(-1);

        const originalOffset = foundChunk.map[processedIndex];
        const originalTextSegment = FULL_TEXT.substring(originalOffset, originalOffset + 5); // "它更像是" has length 4
        expect(originalTextSegment).toContain("它更像是");
    });

    test('findWordIndexInDoc should not jump to far away matches', () => {
        // Scenario: SyncController tries to find "它更像是"
        // Current offset should be around "编程既不是文科也不是理科……"

        const targetWord = "它更像是";
        const contextStart = FULL_TEXT.indexOf("编程既不是文科也不是理科……");

        // This is where the highlight SHOULD be roughly
        const expectedIndex = FULL_TEXT.indexOf(targetWord, contextStart);

        // Simulate a search window of 500 chars (default in main.ts)
        const params = {
            docText: FULL_TEXT,
            wordToFind: targetWord,
            currentDocOffset: contextStart,
            chunkActualStart: contextStart, // Assuming this is start of chunk or close to it
            searchWindow: 500
        };

        const foundIndex = findWordIndexInDoc(params);

        expect(foundIndex).toBe(expectedIndex);

        // Ensure it didn't find something else far away (though "它更像是" is unique here, let's verify)
        // What if we search for a common word that appears later?
        // In the user report, it jumped to "2015 年". Why?
        // Maybe the TTS returned "2015" or something that matched later? 
        // But let's check "2015" search

        const farAwayWord = "2015";
        const farIndex = findWordIndexInDoc({
            ...params,
            wordToFind: farAwayWord
        });

        // Should NOT find it because it's outside search window (which is 500)
        // "2015" is at the end of the text.
        expect(farIndex).toBe(-1);
    });
});
