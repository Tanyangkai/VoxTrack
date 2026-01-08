# VoxTrack 🎧

[![Release](https://img.shields.io/github/v/release/Tanyangkai/VoxTrack?style=flat-square)](https://github.com/Tanyangkai/VoxTrack/releases)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=483699&label=downloads&query=%24%5B%22voxtrack%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=voxtrack)
[![License](https://img.shields.io/github/license/Tanyangkai/VoxTrack?style=flat-square)](LICENSE)

VoxTrack is a high-precision Text-to-Speech (TTS) plugin for Obsidian. It tracks your reading progress **word-by-word** with natural-sounding neural voices, making it perfect for proofreading, language learning, or immersive reading.

> [!TIP]
> **Optimized for English and Chinese (Simplified/Traditional).**

![VoxTrack Demo](demo.gif)

---

## ✨ Features

### 🎯 High-Precision Synchronization
- **Word-Level Tracking**: Real-time highlighting of the exact word being spoken.
- **Bi-lingual Optimization**: Specialized mapping algorithms for English word segmentation and Chinese character-level synchronization.
- **Auto-Scroll**: The editor automatically follows the speech. 
  - *Pro Tip*: Use "Scroll & Move Cursor" mode to ensure Markdown tables in Live Preview stay rendered while reading.

### 🎙 Natural Voices (Edge TTS)
- **Neural Quality**: High-quality voices from Microsoft Edge TTS (Xiaoxiao, Yunxi, Guy, etc.).
- **Real-time Speed Control**: Adjust playback speed from **0.5x to 3.0x** on the fly without waiting for audio re-generation.

### 🧹 Intelligent Content Processing
- **Smart Filtering**: Automatically skips noise like:
  - YAML Frontmatter
  - Code blocks (` ``` `) and inline code (`` ` ``)
  - LaTeX math equations ($...$)
  - Obsidian callouts and comments (`%%...%%`)
- **Seamless Flow**: Cleans up Markdown links (reads the label, skips the URL) and complex Obsidian syntax.
- **Table Specialist**: Intelligently handles Markdown tables, treating rows and columns as natural sentences.

### 🛠 Customizable Experience
- **Highlight Modes**: Toggle between **Word**, **Sentence**, or **None**.
- **Color Presets**: 5 elegant highlighter colors (Yellow, Green, Blue, Purple, Red).
- **Adaptive Buffering**: Handles ultra-long documents smoothly by streaming audio in chunks.

---

## 🚀 Getting Started

1. **Install**: Via Obsidian Community Plugins (search for "VoxTrack") or manual installation.
2. **Configure**: Go to `Settings > VoxTrack` and choose your preferred **Voice role**.
3. **Play**: 
   - Click the **Ribbon icon** (Play Circle) on the left sidebar.
   - Or use the Command Palette (`Cmd/Ctrl + P`) and search for `VoxTrack: Play / pause`.
4. **Read from Cursor**: Right-click anywhere in your note and select `VoxTrack: Read from cursor` to start from that specific point.

---

## 🛠 Installation

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [Releases](https://github.com/Tanyangkai/VoxTrack/releases).
2. Move them into `<vault>/.obsidian/plugins/voxtrack/`.
3. Enable the plugin in Settings.

---

## 🔐 Privacy
- This plugin uses **Microsoft Edge TTS** service.
- **No data is stored** on any servers. Text chunks are sent to the Edge TTS API over an encrypted WebSocket connection solely for synthesis.
- No personal information or vault metadata is ever transmitted.

---

## 🗺 Roadmap
- [x] Internationalization (i18n) support (Chinese/English).
- [ ] Multi-engine support (Azure, OpenAI, Local TTS).
- [ ] Audio Export (Save generated speech as MP3).
- [ ] Support for PDF and Canvas views.
- [ ] Interactive Playback Progress Bar.

---

## 🇨🇳 中文简述 (Chinese Summary)

VoxTrack 是一款专为 Obsidian 打造的高精度**中英文**语音朗读插件。

- **词级同步**：实时追踪并高亮当前正在朗读的单词或字符。
- **自然音质**：集成微软 Edge TTS 神经网络引擎，发音流畅自然。
- **智能过滤**：自动跳过 YAML 元数据、代码块、LaTeX 公式等非正文内容。
- **表格优化**：特别优化了 Markdown 表格的朗读体验，支持自动滚动和光标跟随。
- **全中文界面**：设置与提示信息完全中文化。

---

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request or open an issue.

## 📜 License
This project is licensed under the [0-BSD License](LICENSE).
Copyright (c) 2026 yangkaitan.