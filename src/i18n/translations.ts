
import { moment } from "obsidian";

const translations = {
    en: {
        // Status Bar & Notices
        "Status: Ready": "VoxTrack: Ready",
        "Status: Connecting": "VoxTrack: Connecting...",
        "Status: Receiving": "VoxTrack: Receiving audio...",
        "Status: Playing": "VoxTrack: Playing...",
        "Status: Paused": "VoxTrack: Paused",
        "Notice: No editor": "VoxTrack: No active Markdown editor found.",
        "Notice: No text": "No text to speak",
        "Notice: Filtered": "No speakable text found after filtering",
        "Notice: Connection lost": "VoxTrack: Connection lost. Stopping playback.",
        "Notice: Send Error": "VoxTrack: Failed to send text to TTS service",

        // Commands
        "Command: Play/pause": "Play / pause",
        "Command: Read from cursor": "Read from cursor",
        "Command: Stop": "Stop",

        // Settings - Voice Options
        "Voice options": "Voice options",
        "Voice role": "Voice role",
        "Voice role desc": "Select a voice for text-to-speech",
        "Playback speed": "Playback speed",
        "Playback speed desc": "Audio playback multiplier (0.5x - 3.0x). Does not require re-generation.",

        // Settings - Text Filters
        "Text filters": "Text filters",
        "Filter frontmatter": "Filter frontmatter",
        "Filter frontmatter desc": "Skip YAML frontmatter at the beginning of the note",
        "Filter code blocks": "Filter code blocks",
        "Filter code blocks desc": "Skip code blocks and inline code",
        "Filter links": "Filter links",
        "Filter links desc": "Read link caption only, skip URL",
        "Filter math": "Filter math",
        "Filter math desc": "Skip LaTeX math equations",
        "Filter Obsidian": "Filter Obsidian syntax",
        "Filter Obsidian desc": "Skip callouts, comments, and other metadata",

        // Settings - Interaction
        "Interaction": "Interaction",
        "Auto scroll mode": "Auto scroll mode",
        "Auto scroll mode desc": "How the editor should follow the speech",
        "Auto scroll: Off": "Off",
        "Auto scroll: Center": "Scroll only (Keep cursor)",
        "Auto scroll: Cursor": "Scroll & Move Cursor (Recommended for LP Tables)",
        "Highlight mode": "Highlight mode",
        "Highlight mode desc": "Visual tracking granularity",
        "Highlight mode: Word": "Word level",
        "Highlight mode: Sentence": "Sentence level",
        "Highlight mode: None": "None",
        "Highlight color": "Highlight color",
        "Highlight color desc": "Color of the active word being read",
        "Color: Yellow": "Yellow",
        "Color: Green": "Green",
        "Color: Blue": "Blue",
        "Color: Purple": "Purple",
        "Color: Red": "Red",
        "Color: Default": "System Default",
    },
    zh: {
        // 状态栏 & 通知
        "Status: Ready": "VoxTrack: 就绪",
        "Status: Connecting": "VoxTrack: 正在连接...",
        "Status: Receiving": "VoxTrack: 正在接收音频...",
        "Status: Playing": "VoxTrack: 正在播放...",
        "Status: Paused": "VoxTrack: 已暂停",
        "Notice: No editor": "VoxTrack: 未找到活动的编辑器。",
        "Notice: No text": "没有可朗读的文本",
        "Notice: Filtered": "过滤后未找到可朗读文本",
        "Notice: Connection lost": "VoxTrack: 连接丢失，停止播放。",
        "Notice: Send Error": "VoxTrack: 发送文本至 TTS 服务失败",

        // 命令
        "Command: Play/pause": "播放 / 暂停",
        "Command: Read from cursor": "从光标处朗读",
        "Command: Stop": "停止",

        // 设置 - 语音选项
        "Voice options": "语音设置",
        "Voice role": "语音角色",
        "Voice role desc": "选择文本转语音的角色",
        "Playback speed": "播放倍速",
        "Playback speed desc": "音频播放倍率 (0.5x - 3.0x)，实时生效无需重新生成。",

        // 设置 - 文本过滤
        "Text filters": "内容过滤",
        "Filter frontmatter": "过滤 Frontmatter",
        "Filter frontmatter desc": "跳过笔记开头的 YAML 元数据",
        "Filter code blocks": "过滤代码块",
        "Filter code blocks desc": "跳过代码块和行内代码",
        "Filter links": "过滤链接",
        "Filter links desc": "只朗读链接描述，跳过 URL 地址",
        "Filter math": "过滤数学公式",
        "Filter math desc": "跳过 LaTeX 数学公式",
        "Filter Obsidian": "过滤 Obsidian 语法",
        "Filter Obsidian desc": "跳过 Callouts、注释和其他元数据",

        // 设置 - 交互
        "Interaction": "交互与外观",
        "Auto scroll mode": "自动滚动模式",
        "Auto scroll mode desc": "编辑器如何跟随朗读进度",
        "Auto scroll: Off": "关闭",
        "Auto scroll: Center": "仅滚动 (保持光标位置)",
        "Auto scroll: Cursor": "滚动并移动光标 (推荐表格使用)",
        "Highlight mode": "高亮模式",
        "Highlight mode desc": "视觉追踪的粒度",
        "Highlight mode: Word": "词级",
        "Highlight mode: Sentence": "句级",
        "Highlight mode: None": "关闭",
        "Highlight color": "高亮颜色",
        "Highlight color desc": "当前正在朗读内容的颜色",
        "Color: Yellow": "黄色",
        "Color: Green": "绿色",
        "Color: Blue": "蓝色",
        "Color: Purple": "紫色",
        "Color: Red": "红色",
        "Color: Default": "系统默认",
    }
};

export const t = (key: keyof typeof translations.en): string => {
    const lang = moment.locale();
    if (lang === "zh-cn" || lang === "zh") {
        return translations.zh[key] || translations.en[key];
    }
    return translations.en[key];
};
