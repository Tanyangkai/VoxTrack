# VoxTrack 🎧

VoxTrack is a high-precision Text-to-Speech (TTS) plugin for Obsidian that tracks your reading progress word-by-word with natural-sounding voices powered by Edge TTS.

![VoxTrack Demo](https://via.placeholder.com/800x400?text=VoxTrack+Demo+GIF+Placeholder) <!-- TODO: Replace with real GIF -->

## ✨ Features

- **Word-Level Tracking**: Real-time highlighting of the exact word being spoken.
- **Natural Voices**: Support for high-quality Microsoft Edge TTS neural voices.
- **Adaptive Buffer Management**: Smoothly handles ultra-long documents without memory issues or crashes.
- **Table Support**: Intelligent handling of Markdown tables for seamless reading.
- **Customizable Experience**:
  - **Playback Speed**: Adjust speed from 0.5x to 3.0x on the fly.
  - **Highlight Modes**: Toggle between Word, Sentence, or no highlighting.
  - **Color Presets**: Choose from Yellow, Green, Blue, Purple, or Red highlighters.
  - **Auto-Scroll**: Automatically follows the speech, with optional cursor movement.

## 🚀 Getting Started

1. Install the plugin via Obsidian Community Plugins (pending) or manually.
2. Open the VoxTrack settings tab to select your preferred **Voice role**.
3. Use the **Play / pause** command (or the ribbon icon) to start listening to your active note.
4. Use **Read from cursor** to start from a specific point.

## 🛠 Installation

### Manual Installation
1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from the [Releases](https://github.com/Tanyangkai/VoxTrack/releases) page.
2. Create a folder named `voxtrack` in your Obsidian vault's `.obsidian/plugins/` directory.
3. Move the downloaded files into that folder.
4. Reload Obsidian and enable VoxTrack in the Community Plugins settings.

## 🏗 Development

### Setup
```bash
npm install
```

### Build
```bash
npm run build
```

### Run Tests
```bash
npm test
```

## 🗺 Roadmap
- [ ] Internationalization (i18n) support (Chinese/English).
- [ ] Multi-engine support (Azure, OpenAI, Local TTS).
- [ ] Export audio to MP3 files.
- [ ] Support for PDF and Canvas views.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue for feature requests.

## 📜 License

This project is licensed under the [0-BSD License](LICENSE).