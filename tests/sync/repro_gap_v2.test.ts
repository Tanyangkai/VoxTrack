
import { TextProcessor } from '../../src/text-processor';

describe('TextProcessor Gap Reproduction', () => {
    test('should not skip text between Line 791 and 851', () => {
        const processor = new TextProcessor();
        // Construct the text from "自学是门手艺.md" Lines 791-860 approx
        // I'm using a simplified version but keeping the structure and key phrases
        const text = `
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

所有的代码，都可以在选中代码单元格（Code Cell）之后，按快捷键 \`⇧ ⏎\` 或 \`^ ⏎\` 执行，查看结果。

少量执行结果太长的代码，其输出被设置成了 “Scrolled”，是可以通过触摸板或鼠标滑轮上下滑动的。

为了避免大量使用 \`print()\` 才能看到输出结果，在很多的代码单元格中，开头插入了以下代码：

\`\`\`python
from IPython.core.interactiveshell import InteractiveShell
InteractiveShell.ast_node_interactivity = "all"
\`\`\`

你可以暂时忽略它们的意义和工作原理。注意：有时，你需要在执行第二次的时候，才能看到全部输出结果。

另外，有少量代码示例，为了让读者每次执行的时候看到不同的结果，使用了随机函数，为其中的变量赋值，比如：

\`\`\`python
import random
r = random.randrange(1, 1000)
\`\`\`

同样，你可以暂时忽略它们的意义和工作原理；只需要知道因为有它们在，所以每次执行那个单元格中的代码会有不同的结果就可以了。

如果你不是直接在网站上浏览这本 “书”、或者不是在阅读印刷版，而是在本地自己搭建 Jupyterlab 环境使用，那么请参阅附录《[Jupyterlab 的安装与配置](T.jupyter-installation-and-setup.md)》。

> **注意**：尤其需要仔细看看《[Jupyterlab 的安装与配置](T.jupyter-installation-and-setup.md)》的《关于 Jupyter lab themes》这一小节 —— 否则，阅读体验会有很大差别。

另外，如果你使用的是 [nteract](https://nteract.io) 桌面版 App 浏览 \`.ipynb\` 文件，那么有些使用了 \`input()\` 函数的代码是无法在 nteract 中执行的。


## E.1.入口

“速成”，对绝大多数人[[1]](#fn1)来说，在绝大多数情况下，是不大可能的。

编程如此，自学编程更是如此。有时，遇到复杂度高一点的知识，连快速入门都不一定是很容易的事情。

所以，这一章的名称，特意从 “_入门_” 改成了 “**入口**” —— 它的作用是给你 “指一个入口”，至于你能否从那个入口进去，是你自己的事了……
`;

        const chunks = processor.process(text, {
            filterCode: true,
            filterLinks: true,
            filterMath: true,
            filterFrontmatter: true,
            filterObsidian: true,
            lang: 'zh-CN'
        });

        console.log(`Input Length: ${text.length}`);
        console.log(`Number of chunks: ${chunks.length}`);

        const resultText = chunks.map(c => c.text).join('');
        console.log(`Output Length (concatenated): ${resultText.length}`);

        // Verify key phrases exist in the output
        expect(resultText).toContain('给学生制造全方位');
        expect(resultText).toContain('别怕');
        expect(resultText).toContain('手工课');
        // Code should be removed
        expect(resultText).not.toContain('import random');
        // Text after gap
        expect(resultText).toContain('指一个入口');

        // Detailed Chunk Analysis
        for (let i = 0; i < chunks.length; i++) {
            console.log(`Chunk ${i} length: ${chunks[i].text.length}`);
            console.log(`Chunk ${i} start text: ${chunks[i].text.substring(0, 20)}...`);
            console.log(`Chunk ${i} end text: ...${chunks[i].text.substring(chunks[i].text.length - 20)}`);
        }
    });
});
