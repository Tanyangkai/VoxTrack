# VoxTrack

![Status](https://img.shields.io/badge/Status-Stable-success)
![Version](https://img.shields.io/badge/Version-1.0.0-blue)

**VoxTrack** is a high-precision Text-to-Speech (TTS) plugin for Obsidian that offers a true-to-life reading experience. By integrating Microsoft Edge's natural voices and a custom synchronization engine, VoxTrack allows you to listen to your notes while visually tracking the reading progress word-by-word or sentence-by-sentence.

## ✨ Features

- **Natural Voices**: Support for high-quality, neural network-based voices from Microsoft Edge TTS (e.g., "Xiaoxiao", "Yunxi").
- **Precision Tracking**: Real-time visual highlighting of the currently spoken word or sentence, ensuring you never lose your place.
- **Seamless Integration**: Uses CodeMirror decorations to render highlights without modifying your Markdown source code.
- **Smart Control**: 
    - Click any line gutter to jump play.
    - Auto-scroll to keep the active text in view.
    - Global hotkeys for Play/Pause/Stop.

## 🚀 Usage

### Starting Playback
1.  **Select text** or place your cursor anywhere in the note you want to read.
2.  Open the **Command Palette** (`Cmd/Ctrl + P`) and run `VoxTrack: Play/Pause`.
3.  Or, click the **VoxTrack** icon in the status bar.

### Controls
- **Play/Pause**: `Space` (when focus is on the player) or use the command `VoxTrack: Play/Pause`.
- **Stop**: `Esc` or use the command `VoxTrack: Stop`.
- **Global Shortcuts**: You can assign custom hotkeys to these commands in Obsidian Settings > Hotkeys.

## ⚙️ Settings

Go to **Settings > VoxTrack** to customize your experience:

- **Voice**: Select your preferred language and voice role.
- **Speed & Pitch**: Adjust the reading speed and pitch.
- **Highlight Mode**: Choose between `Word` (default), `Sentence`, or `None`.
- **Auto Scroll**: Toggle automatic scrolling to the active line.

## 🛠️ Development

If you want to build VoxTrack from source or contribute:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/voxtrack.git
    cd voxtrack
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Run in dev mode**:
    ```bash
    npm run dev
    ```
    This will compile the plugin and watch for changes.
4.  **Install to Obsidian**:
    Symlink or copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/voxtrack/` directory.

## 📄 License

This project is licensed under the **0-BSD** License.
