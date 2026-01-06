import { Editor, MarkdownView, Plugin, Notice } from 'obsidian';
import { VoxTrackSettings, DEFAULT_SETTINGS, VoxTrackSettingTab } from './settings/setting-tab';
import { AudioPlayer } from './audio/player';
import { SyncController } from './sync/controller';
import { EdgeSocket } from './api/edge-socket';
import { voxTrackExtensions } from './editor/extensions';
import { setActiveRange } from './editor/decorations';

export default class VoxTrackPlugin extends Plugin {
	settings: VoxTrackSettings;
	private player: AudioPlayer;
	private syncController: SyncController;
	private socket: EdgeSocket;
	private isPlaying: boolean = false;
	private activeEditor: Editor | null = null;
	private syncInterval: number | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize subsystems
		this.player = new AudioPlayer();
		this.syncController = new SyncController();
		this.socket = new EdgeSocket();

		this.addSettingTab(new VoxTrackSettingTab(this.app, this));

		// Register Editor Extension
		this.registerEditorExtension(voxTrackExtensions());

		// Status Bar
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('VoxTrack: Ready');

		// Play Command
		this.addCommand({
			id: 'voxtrack-play',
			name: 'Play / Pause',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.togglePlay(editor, statusBarItemEl);
			}
		});

		// Stop Command
		this.addCommand({
			id: 'voxtrack-stop',
			name: 'Stop',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.stopPlayback(statusBarItemEl);
			}
		});
	}

	async onunload() {
		this.stopPlayback();
	}

	private async togglePlay(editor: Editor, statusBar: HTMLElement) {
		if (this.isPlaying) {
			// Pause logic (basically stop for now as resume is complex)
			this.stopPlayback(statusBar);
			return;
		}

		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		if (!lineText.trim()) {
			new Notice('No text to speak at cursor');
			return;
		}

		try {
			statusBar.setText('VoxTrack: Connecting...');
			this.activeEditor = editor;
			this.isPlaying = true;

			// Connect if needed
			await this.socket.connect();

			// Send SSML (Simple wrapper for now)
			const ssml = `<speak version='1.0' xml:lang='en-US'><voice xml:lang='en-US' xml:gender='Female' name='${this.settings.voice}'>${lineText}</voice></speak>`;
			// Note: RequestId generation should ideally be handled inside or passed here. 
			// For simplicity assume socket handles unique ID or we pass a dummy one for this MVP.
			await this.socket.sendSSML(ssml, "req-" + Date.now());

			statusBar.setText('VoxTrack: Playing...');

			// Mocking playback start for MVP structure
			// In real impl, we would listen to audio events and SyncController updates

		} catch (e: any) {
			console.error('[VoxTrack] Playback Error:', e);
			console.log('[VoxTrack] Full Error Object:', JSON.stringify(e, Object.getOwnPropertyNames(e)));

			new Notice(`VoxTrack Error: ${e.message || 'Unknown'}`);
			this.stopPlayback(statusBar);
		}
		this.setupDataHandler(statusBar);
	}

	private setupDataHandler(statusBar: HTMLElement) {
		this.socket.onMessage(async (data) => {
			if (data instanceof Buffer) {
				// Audio Data - convert full buffer to ArrayBuffer
				// Slice is needed if buffer comes from pool, though often it's fresh.
				// For simplicity, typed arrays share buffer.
				const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
				await this.player.playBuffer(arrayBuffer);

			} else if (typeof data === 'string') {
				// Text Metadata
				if (data.includes('Path:audio.metadata')) {
					const jsonStart = data.indexOf('\r\n\r\n');
					if (jsonStart !== -1) {
						try {
							const jsonStr = data.substring(jsonStart + 4);
							const jsonObj = JSON.parse(jsonStr);
							
							// Lazy import to avoid circular dependency issues if any
							const { parseMetadata } = require('./api/protocol');
							const metadata = parseMetadata(jsonObj);
							// now using addMetadata and passing the array
							this.syncController.addMetadata(metadata);
						} catch (e) {
							console.error('[VoxTrack] Failed to parse metadata JSON', e);
						}
					}
				}
			}
		});

		// Start Sync Loop
		const updateLoop = () => {
			if (!this.isPlaying) return;

			const time = this.player.getCurrentTime();
			const msTime = time * 1000;

			const active = this.syncController.findActiveMetadata(time); // Pass seconds!
			if (active && this.activeEditor) {
				const cursor = this.activeEditor.getCursor();
				// Simple line-based offset assumption for MVP
				const lineStart = this.activeEditor.posToOffset({ line: cursor.line, ch: 0 });
				// Use correct properties from AudioMetadata
				const from = lineStart + active.textOffset;
				const to = from + active.wordLength;

				const view = (this.activeEditor as any).cm;
				if (view && view.dispatch) {
					view.dispatch({ effects: setActiveRange.of({ from, to }) });
				}
			}

			this.syncInterval = requestAnimationFrame(updateLoop);
		};
		this.syncInterval = requestAnimationFrame(updateLoop);
	}


	private stopPlayback(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.player.stop();
		this.syncController.reset();

		if (this.activeEditor) {
			// Clear decorations
			// We need to dispatch effect to clear. 
			// Accessing editor's view via the workspace leaf might be needed or assuming editor is cm6
			// For Obsidian API 'editor' wrapper, we might not have direct dispatch access easily without type casting
			// or using the EditorView directly.
			// This part requires access to the underlying CM6 EditorView
			// const view = (this.activeEditor as any).cm as EditorView;
			// if(view) view.dispatch({ effects: setActiveRange.of(null) });
		}

		this.activeEditor = null;
		if (statusBar) statusBar.setText('VoxTrack: Ready');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
