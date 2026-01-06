import { Editor, MarkdownView, Plugin, Notice } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { VoxTrackSettings, DEFAULT_SETTINGS, VoxTrackSettingTab } from './settings/setting-tab';
import { AudioPlayer } from './audio/player';
import { SyncController } from './sync/controller';
import { EdgeSocket } from './api/edge-socket';
import { voxTrackExtensions } from './editor/extensions';
import { setActiveRange } from './editor/decorations';
import { parseMetadata } from './api/protocol';

export default class VoxTrackPlugin extends Plugin {
	settings: VoxTrackSettings;
	private player: AudioPlayer;
	private syncController: SyncController;
	private socket: EdgeSocket;
	private isPlaying: boolean = false;
	private isTransferFinished: boolean = false;
	private hasShownReceivingNotice: boolean = false;
	private activeEditor: Editor | null = null;
	private syncInterval: number | null = null;
	private baseOffset: number = 0;
	private textChunks: string[] = [];
	private currentChunkIndex: number = 0;
	private chunkOffsets: number[] = [];

	public async onload(): Promise<void> {
		await this.loadSettings();

		this.player = new AudioPlayer();
		this.syncController = new SyncController();
		this.socket = new EdgeSocket();

		this.addSettingTab(new VoxTrackSettingTab(this.app, this));
		this.registerEditorExtension(voxTrackExtensions());

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('VoxTrack: Ready');

		this.player.onComplete(() => {
			this.handlePlaybackFinished(statusBarItemEl);
		});

		this.addCommand({
			id: 'voxtrack-play',
			name: 'Play / pause',
			editorCallback: (editor: Editor) => {
				void this.togglePlay(editor, statusBarItemEl);
			}
		});

		this.addCommand({
			id: 'voxtrack-stop',
			name: 'Stop',
			editorCallback: () => {
				this.stopPlayback(statusBarItemEl);
			}
		});
	}

	public async onunload(): Promise<void> {
		this.stopPlayback();
	}

	private setupDataHandler(statusBar: HTMLElement) {
		this.socket.onMessage(async (data) => {
			let buffer: Uint8Array;
			if (typeof data === 'string') {
				buffer = new TextEncoder().encode(data);
			} else if (data instanceof Uint8Array) {
				buffer = data;
			} else {
				buffer = new Uint8Array(data as ArrayBuffer);
			}

			if (buffer.length > 2 && buffer[0] === 0x00) {
				const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
				const headerLength = view.getInt16(0, false);
				const audioData = buffer.subarray(headerLength + 2);
				if (audioData.length > 0) {
					if (!this.hasShownReceivingNotice && this.player.getCurrentTime() === 0) {
						new Notice('VoxTrack: Receiving audio...');
						this.hasShownReceivingNotice = true;
					}
					this.player.addChunk(new Uint8Array(audioData));
					void this.player.play().catch(() => {}); 
				}
			} else {
				const text = new TextDecoder('utf-8').decode(buffer);
				console.debug('[VoxTrack] Received text:', text);
				if (text.includes('Path:audio.metadata')) {
					const jsonStart = text.indexOf('\r\n\r\n');
					if (jsonStart !== -1) {
						try {
							const jsonStr = text.substring(jsonStart + 4);
							const jsonObj = JSON.parse(jsonStr);
							const metadata = parseMetadata(jsonObj);
							if (metadata.length > 0) {
								this.syncController.addMetadata(metadata);
							}
						} catch (e) {
							console.warn('[VoxTrack] Metadata parse error', e);
						}
					}
				} else if (text.includes('Path:turn.end')) {
					void this.processNextChunk(statusBar);
				}
			}
		});

		this.socket.onClose(() => {
			if (this.isPlaying) {
				if (this.isTransferFinished) {
					console.debug('[VoxTrack] Socket closed normally after transfer');
				} else {
					console.warn('[VoxTrack] Socket closed unexpectedly');
					new Notice('VoxTrack: Connection lost. Stopping playback.');
					this.stopPlayback(statusBar);
				}
			}
		});

		let lastActive: any = null;
		let currentDocOffset = 0;

		const updateLoop = () => {
			if (!this.isPlaying) return;

			const time = this.player.getCurrentTime();
			const active = this.syncController.findActiveMetadata(time);
			
			if (active && active !== lastActive && this.activeEditor) {
				if (lastActive === null || active.offset < lastActive.offset) {
					currentDocOffset = this.baseOffset;
				}
				lastActive = active;
				
				const docText = this.activeEditor.getValue();
				const wordToFind = active.text;
				let foundIndex = docText.indexOf(wordToFind, currentDocOffset);
				
				if (foundIndex !== -1) {
					const from = foundIndex;
					const to = from + wordToFind.length;
					currentDocOffset = to;

					const view = (this.activeEditor as any).cm || (this.activeEditor as any).editor?.cm || (this.activeEditor as any).view;
					if (view && view.dispatch) {
						view.dispatch({
							effects: setActiveRange.of({ from, to }),
							scrollIntoView: this.settings.autoScroll
						});
					}
				}
			}

			this.syncInterval = requestAnimationFrame(updateLoop);
		};
		this.syncInterval = requestAnimationFrame(updateLoop);
	}

	private async processNextChunk(statusBar: HTMLElement) {
		this.currentChunkIndex++;
		if (this.currentChunkIndex < this.textChunks.length) {
			const nextText = this.textChunks[this.currentChunkIndex];
			if (!nextText) return;

			this.baseOffset = this.chunkOffsets[this.currentChunkIndex] || 0;
			
			const voice = this.settings.voice || 'zh-CN-XiaoxiaoNeural';
			const rate = this.settings.rate || '+0%';
			const pitch = this.settings.pitch || '+0Hz';
			const volume = this.settings.volume || '+0%';
			const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';

			const filteredText = this.filterMarkdown(nextText);
			if (!filteredText.trim()) {
				console.debug('[VoxTrack] Chunk is empty after filtering, skipping');
				void this.processNextChunk(statusBar);
				return;
			}
			const escapedText = filteredText.replace(/[<>&"']/g, (c) => {
				switch (c) {
					case '<': return '&lt;';
					case '>': return '&gt;';
					case '&': return '&amp;';
					case '"': return '&quot;';
					case "'": return '&apos;';
					default: return c;
				}
			});

			const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapedText}</prosody></voice></speak>`;

			console.debug(`[VoxTrack] Sending Chunk ${this.currentChunkIndex + 1}/${this.textChunks.length}: ${escapedText.substring(0, 50)}...`);
			await this.socket.sendSSML(ssml, uuidv4().replace(/-/g, ''));
		} else {
			console.debug('[VoxTrack] All chunks completed');
			this.isTransferFinished = true;
			this.player.finish();
			this.socket.close();
		}
	}

	private filterMarkdown(text: string): string {
		return text
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/%%[\s\S]*?%%/g, '')
			.replace(/```[\s\S]*?```/g, '')
			.replace(/!\[([^\]]*)(\([^)]*\))/g, '')
			.replace(/!\[\[([^\]]*)\]\]/g, '')
			.replace(/\*\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\*\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
			.replace(/\*\[\[([^\]]*)\]\]/g, '$1')
			.replace(/\|/g, ' ')
			.replace(/^\s*[-:\s]+\s*$/gm, '')
			.replace(/[*_`~=]/g, '')
			.replace(/^[#>-]+\s*/gm, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	private async togglePlay(editor: Editor, statusBar: HTMLElement) {
		if (this.isPlaying) {
			this.stopPlayback(statusBar);
			return;
		}

		let rawText = editor.getSelection();
		let startOffset = 0;
		if (rawText) {
			startOffset = editor.posToOffset(editor.getCursor('from'));
		} else {
			rawText = editor.getValue();
			startOffset = 0;
		}

		if (!rawText.trim()) {
			new Notice('No text to speak');
			return;
		}

		if (startOffset === 0) {
			rawText = rawText.replace(/^\s*-{3}[\s\S]*?-{3}\n?/, '');
		}

		this.textChunks = [];
		this.chunkOffsets = [];
		this.currentChunkIndex = 0;

		const CHUNK_SIZE = 1000;
		let currentPos = 0;
		while (currentPos < rawText.length) {
			let endPos = currentPos + CHUNK_SIZE;
			if (endPos < rawText.length) {
				const lastNewline = rawText.lastIndexOf('\n', endPos);
				if (lastNewline > currentPos + (CHUNK_SIZE / 2)) {
					endPos = lastNewline;
				} else {
					const lastPeriod = rawText.lastIndexOf('. ', endPos);
					if (lastPeriod > currentPos + (CHUNK_SIZE / 2)) {
						endPos = lastPeriod + 1;
					}
				}
			}
			const chunk = rawText.substring(currentPos, endPos);
			this.textChunks.push(chunk);
			this.chunkOffsets.push(startOffset + currentPos);
			currentPos = endPos;
		}

		try {
			this.player.reset();
			await this.player.initSource();
			
			if (statusBar) statusBar.setText('VoxTrack: Connecting...');
			this.activeEditor = editor;
			this.isPlaying = true;
			this.isTransferFinished = false;
			this.hasShownReceivingNotice = false;
			this.baseOffset = this.chunkOffsets[0] || 0;

			this.setupDataHandler(statusBar);
			await this.socket.connect();

			const firstChunk = this.textChunks[0];
			if (!firstChunk) return;

			const voice = this.settings.voice || 'zh-CN-XiaoxiaoNeural';
			const rate = this.settings.rate || '+0%';
			const pitch = this.settings.pitch || '+0Hz';
			const volume = this.settings.volume || '+0%';
			
			const filteredText = this.filterMarkdown(firstChunk);
			if (!filteredText.trim()) {
				console.debug('[VoxTrack] First chunk is empty, trying next');
				void this.processNextChunk(statusBar);
				return;
			}
			const escapedText = filteredText.replace(/[<>&"']/g, (c) => {
				switch (c) {
					case '<': return '&lt;';
					case '>': return '&gt;';
					case '&': return '&amp;';
					case '"': return '&quot;';
					case "'": return '&apos;';
					default: return c;
				}
			});

			const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';
			const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapedText}</prosody></voice></speak>`;

			console.debug(`[VoxTrack] Sending Chunk 1/${this.textChunks.length}: ${escapedText.substring(0, 50)}...`);
			await this.socket.sendSSML(ssml, uuidv4().replace(/-/g, ''));
			if (statusBar) statusBar.setText('VoxTrack: Playing...');

		} catch (e: any) {
			console.error('[VoxTrack] Playback Error:', e);
			new Notice(`VoxTrack Error: ${e.message || 'Unknown'}`);
			this.stopPlayback(statusBar);
		}
	}

	private stopPlayback(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isTransferFinished = false;
		if (this.syncInterval) cancelAnimationFrame(this.syncInterval);
		this.player.stop();
		this.syncController.reset();

		if (this.activeEditor) {
			const view = (this.activeEditor as any).cm || (this.activeEditor as any).editor?.cm || (this.activeEditor as any).view;
			if (view && view.dispatch) {
				view.dispatch({ effects: setActiveRange.of(null) });
			}
		}

		this.activeEditor = null;
		this.textChunks = [];
		this.currentChunkIndex = 0;
		if (statusBar) statusBar.setText('VoxTrack: Ready');
	}

	private handlePlaybackFinished(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isTransferFinished = false;
		if (this.syncInterval) cancelAnimationFrame(this.syncInterval);
		this.syncController.reset();

		if (this.activeEditor) {
			const view = (this.activeEditor as any).cm || (this.activeEditor as any).editor?.cm || (this.activeEditor as any).view;
			if (view && view.dispatch) {
				view.dispatch({ effects: setActiveRange.of(null) });
			}
		}

		this.activeEditor = null;
		this.textChunks = [];
		this.currentChunkIndex = 0;
		if (statusBar) statusBar.setText('VoxTrack: Ready');
	}

	public async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
