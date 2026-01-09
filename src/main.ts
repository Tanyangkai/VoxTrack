import { Editor, MarkdownView, Plugin, Notice, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { TransactionSpec } from '@codemirror/state';
import { v4 as uuidv4 } from 'uuid';
import { VoxTrackSettings, DEFAULT_SETTINGS, VoxTrackSettingTab } from './settings/setting-tab';
import { AudioPlayer } from './audio/player';
import { SyncController } from './sync/controller';
import { EdgeSocket } from './api/edge-socket';
import { voxTrackExtensions } from './editor/extensions';
import { setActiveRange } from './editor/decorations';
import { parseMetadata, EdgeResponse, AudioMetadata } from './api/protocol';
import { TextProcessor } from './text-processor';
import { getSelectedText, getTextFromCursor, getFullText } from './utils/editor-utils';
import { t } from './i18n/translations';

interface SafeEditor extends Editor {
	cm?: EditorView;
	editor?: { cm?: EditorView };
	view?: EditorView;
}

export default class VoxTrackPlugin extends Plugin {
	settings: VoxTrackSettings;
	private player: AudioPlayer;
	private syncController: SyncController;
	private socket: EdgeSocket;
	private textProcessor: TextProcessor;
	private isPlaying: boolean = false;
	private isPaused: boolean = false;
	private activeMode: 'auto' | 'cursor' | null = null;
	private isTransferFinished: boolean = false;
	private hasShownReceivingNotice: boolean = false;
	private activeEditor: Editor | null = null;
	private syncInterval: number | null = null;
	private baseOffset: number = 0;
	private textChunks: string[] = [];
	private chunkMaps: number[][] = [];
	private currentChunkIndex: number = 0;
	private chunkOffsets: number[] = [];
	private audioTimeOffset: number = 0;
	private chunkScanOffset: number = 0;
	private lastHighlightFrom: number = -1;
	private lastHighlightTo: number = -1;

	// Status Bar Elements
	private statusBarItemEl: HTMLElement;
	private statusBarTextEl: HTMLElement;
	private statusBarPlayBtn: HTMLElement;
	private statusBarStopBtn: HTMLElement;
	private statusBarLocateBtn: HTMLElement;

	private receivingChunkIndex: number = 0;

	public async onload(): Promise<void> {
		await this.loadSettings();
		this.applyHighlightColor();

		this.player = new AudioPlayer();
		this.syncController = new SyncController();
		this.socket = new EdgeSocket();
		this.textProcessor = new TextProcessor();

		this.addSettingTab(new VoxTrackSettingTab(this.app, this));
		this.registerEditorExtension(voxTrackExtensions());

		// Status Bar Initialization
		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.addClass('voxtrack-status-bar');

		this.statusBarTextEl = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-text', text: t("Status: Ready") });

		// Play/Pause Button
		this.statusBarPlayBtn = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-btn', attr: { 'aria-label': t("Command: Play/pause") } });
		setIcon(this.statusBarPlayBtn, 'play');
		this.statusBarPlayBtn.onclick = () => {
			if (this.isPlaying && this.activeEditor) {
				// If playing, just toggle
				void this.togglePlay(this.activeEditor, 'auto', this.statusBarItemEl).catch(console.error);
			} else {
				// If not playing, find active view
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl).catch(console.error);
				} else {
					new Notice(t("Notice: No editor"));
				}
			}
		};

		// Stop Button
		this.statusBarStopBtn = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-btn', attr: { 'aria-label': t("Command: Stop") } });
		setIcon(this.statusBarStopBtn, 'square');
		this.statusBarStopBtn.onclick = () => {
			if (this.isPlaying) {
				this.stopPlayback(this.statusBarItemEl);
			}
		};

		// Locate Button
		this.statusBarLocateBtn = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-btn', attr: { 'aria-label': t("Tooltip: Locate") } });
		setIcon(this.statusBarLocateBtn, 'locate');
		this.statusBarLocateBtn.onclick = () => {
			if (this.isPlaying) {
				this.scrollToActive();
			}
		};


		// Ribbon Icon
		this.addRibbonIcon('play-circle', 'VoxTrack: ' + t("Command: Play/pause"), (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl).catch(console.error);
			} else {
				// Try to stop if no active editor but maybe global playing? 
				// For now just match command logic which requires editor usually, 
				// but stop can be global.
				if (this.isPlaying) {
					this.stopPlayback(this.statusBarItemEl);
				}
			}
		});

		this.player.onComplete(() => {
			this.handlePlaybackFinished(this.statusBarItemEl);
		});

		this.addCommand({
			id: 'play',
			name: t("Command: Play/pause"),
			editorCallback: (editor: Editor) => {
				void (async () => {
					try {
						await this.togglePlay(editor, 'auto', this.statusBarItemEl);
					} catch (e) {
						console.error(e);
					}
				})();
			}
		});

		this.addCommand({
			id: 'read-from-cursor',
			name: t("Command: Read from cursor"),
			editorCallback: (editor: Editor) => {
				void (async () => {
					try {
						await this.togglePlay(editor, 'cursor', this.statusBarItemEl);
					} catch (e) {
						console.error(e);
					}
				})();
			}
		});

		this.addCommand({
			id: 'stop',
			name: t("Command: Stop"),
			editorCallback: () => {
				this.stopPlayback(this.statusBarItemEl);
			}
		});

		// Context Menu
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('VoxTrack: ' + t("Command: Read from cursor"))
						.setIcon('play-circle')
						.onClick(() => {
							void this.togglePlay(editor, 'cursor', this.statusBarItemEl);
						});
				});
			})
		);
	}

	public onunload(): void {
		this.stopPlayback();
		if (this.player) {
			this.player.destroy();
		}
		if (this.statusBarItemEl) {
			this.statusBarItemEl.remove();
		}
	}

	private setupDataHandler(statusBar: HTMLElement) {
		this.socket.onMessage((data) => {
			void (async () => {
				await Promise.resolve(); // Ensure async function has an await expression
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
							new Notice(t("Status: Receiving"));
							this.hasShownReceivingNotice = true;
						}
						this.player.addChunk(new Uint8Array(audioData));

						// Only auto-play if we are logically "playing" and NOT "paused"
						if (this.isPlaying && !this.isPaused) {
							await this.player.play().catch(() => { });
						}
					}
				} else {
					const text = new TextDecoder('utf-8').decode(buffer);
					if (text.includes('Path:audio.metadata')) {
						const jsonStart = text.indexOf('\r\n\r\n');
						if (jsonStart !== -1) {
							try {
								const jsonStr = text.substring(jsonStart + 4);
								const jsonObj = JSON.parse(jsonStr) as unknown as EdgeResponse;
								const metadata = parseMetadata(jsonObj);
								if (metadata.length > 0) {
									const targetChunkIndex = this.receivingChunkIndex;
									const currentChunkText = this.textChunks[targetChunkIndex] || '';

									for (const m of metadata) {
										if (this.audioTimeOffset > 0) {
											m.offset += this.audioTimeOffset;
										}
										m.chunkIndex = targetChunkIndex;

										// NEW: Aggressively filter out SSML tags and fragments that Edge TTS erroneously returns
										const rawText = m.text.toLowerCase();
										if (/[<>]/.test(rawText) ||
											/^(prosody|voice|speak|speak|audio|mstts|phoneme|break|emphasis|say-as|sub|p|s|v|i|ce|od|os|pr|r)$/.test(rawText) ||
											/^(gt|lt|amp|quot|apos|nbsp|;)$/.test(rawText) ||
											/^&[a-z]+;?$/.test(rawText) ||
											/^[/\\]/.test(rawText)) {
											continue;
										}

										// Auto-correct Text Offset
										if (currentChunkText) {
											const searchText = this.unescapeHtml(m.text);

											// Limit search window to prevent jumping to distant matches (noise reduction)
											const searchWindow = 300;
											let found = currentChunkText.indexOf(searchText, this.chunkScanOffset);

											if (found !== -1 && found > this.chunkScanOffset + searchWindow) {
												found = -1;
											}

											if (found === -1) {
												const cleanSearch = searchText.replace(/[.,;!?。，；！？、]/g, '');
												if (cleanSearch.length > 0) {
													found = currentChunkText.indexOf(cleanSearch, this.chunkScanOffset);
													if (found !== -1 && found > this.chunkScanOffset + searchWindow) {
														found = -1;
													}
												}
											}

											if (found !== -1) {
												// Ignore suspicious single-letter jumps (likely TTS garbage tokens)
												const isSingleLetter = searchText.length === 1 && /[a-zA-Z]/.test(searchText);
												if (isSingleLetter && found > this.chunkScanOffset + 20) {
													// Skip this token
												} else {
													const expanded = this.expandWordSelection(currentChunkText, found, searchText.length);
													m.textOffset = expanded.start;
													m.wordLength = expanded.length;
													m.text = currentChunkText.substring(expanded.start, expanded.start + expanded.length);
													this.chunkScanOffset = found + 1;
												}
											}
										}
									}
									this.syncController.addMetadata(metadata);
								}
							} catch (e) {
								console.warn('[VoxTrack] Metadata parse error', e);
							}
						}
					} else if (text.includes('Path:turn.end')) {
						this.audioTimeOffset = this.player.getBufferedEnd();
						this.receivingChunkIndex++;
						await this.processNextChunk(statusBar);
					}
				}
			})();
		});

		this.socket.onClose(() => {
			if (this.isPlaying) {
				if (this.isTransferFinished) {
					// No log
				} else {
					console.warn('[VoxTrack] Socket closed unexpectedly');
					new Notice(t("Notice: Connection lost"));
					this.stopPlayback(statusBar);
				}
			}
		});

		let lastActive: AudioMetadata | null = null;
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
				let foundIndex = -1;

				// 1. Try Precise Map Lookup
				// Use the chunkIndex stored in metadata to find the correct map
				const mapIndex = active.chunkIndex !== undefined ? active.chunkIndex : this.currentChunkIndex;
				const currentMap = this.chunkMaps[mapIndex];
				const chunkBaseOffset = this.chunkOffsets[mapIndex] || 0;

				if (currentMap && active.textOffset !== undefined) {
					// active.textOffset is index in the processed chunk
					// active.wordLength is length in processed chunk

					const startIdxInProcessed = active.textOffset;
					const endIdxInProcessed = active.textOffset + active.wordLength;

					if (startIdxInProcessed < currentMap.length) {
						const rawStart = currentMap[startIdxInProcessed];

						if (endIdxInProcessed < currentMap.length) {
							// Check if end index is valid, though unused for start pos
							const val = currentMap[endIdxInProcessed];
							if (val !== undefined) {
								// rawEnd = val; 
							}
						}

						if (rawStart !== undefined && rawStart !== -1) {
							const absStart = chunkBaseOffset + rawStart;
							foundIndex = absStart;
						}
					}
				}

				// Fallback 1: Direct search
				if (foundIndex === -1) {
					foundIndex = docText.indexOf(wordToFind, currentDocOffset);
				}

				// Fallback 2: Case-insensitive search
				if (foundIndex === -1) {
					const lowerDoc = docText.toLowerCase();
					const lowerWord = lowerDoc.indexOf(wordToFind.toLowerCase(), currentDocOffset);
					if (lowerWord !== -1) {
						foundIndex = lowerWord;
					}
				}

				// Fallback 3: Fuzzy search (strip punctuation from wordToFind)
				// TTS sometimes adds punctuation like commas or periods that aren't in source
				if (foundIndex === -1) {
					const cleanWord = wordToFind.replace(/[.,;!?。，；！？、]/g, '');
					if (cleanWord.length > 0 && cleanWord !== wordToFind) {
						foundIndex = docText.indexOf(cleanWord, currentDocOffset);
						// Try case-insensitive specific clean word
						if (foundIndex === -1) {
							const fuzzyIdx = docText.toLowerCase().indexOf(cleanWord.toLowerCase(), currentDocOffset);
							if (fuzzyIdx !== -1) {
								foundIndex = fuzzyIdx;
							}
						}
					}
				}

				// Fallback 4: Overshot Recovery
				// If we can't find it forward, check if we skipped it (foundIndex would be < currentDocOffset but > baseOffset)
				if (foundIndex === -1 && currentDocOffset > chunkBaseOffset) {
					// Try searching from baseOffset to see if it's behind us
					const recoveryIndex = docText.indexOf(wordToFind, chunkBaseOffset);
					if (recoveryIndex !== -1 && recoveryIndex < currentDocOffset) {
						foundIndex = recoveryIndex;
					} else {
						// Try fuzzy recovery
						const cleanWord = wordToFind.replace(/[.,;!?。，；！？、]/g, '');
						if (cleanWord.length > 0) {
							const fuzzyRecoveryIndex = docText.indexOf(cleanWord, chunkBaseOffset);
							if (fuzzyRecoveryIndex !== -1 && fuzzyRecoveryIndex < currentDocOffset) {
								foundIndex = fuzzyRecoveryIndex;
							}
						}
					}
				}

				if (foundIndex !== -1) {
					const from = foundIndex;

					// Determine Length
					// If we used map, we might know the exact length in raw text
					// But we only got 'from'.
					// Let's recalculate 'to'.

					let matchLen = wordToFind.length;

					// Use map to find 'to' if possible
					if (currentMap && active.textOffset !== undefined) {
						const endIdxInProcessed = active.textOffset + active.wordLength;
						if (endIdxInProcessed < currentMap.length) {
							const rawEnd = currentMap[endIdxInProcessed];
							if (rawEnd !== undefined && rawEnd !== -1) {
								const absEnd = chunkBaseOffset + rawEnd;
								if (absEnd > from) {
									matchLen = absEnd - from;
								}
							}
						}
					}

					// Fallback length calculation
					if (docText.substring(from, from + matchLen) !== wordToFind) {
						const cleanWord = wordToFind.replace(/[.,;!?。，；！？、]/g, '');
						if (docText.substring(from, from + cleanWord.length) === cleanWord) {
							matchLen = cleanWord.length;
						}
					}

					const to = from + matchLen;
					currentDocOffset = to;

					let highlightFrom = from;
					let highlightTo = to;

					if (this.settings.highlightMode === 'sentence') {
						// Expand to sentence boundaries WITHOUT creating large substrings
						// Look backward for sentence start
						const terminators = ['.', '!', '?', '。', '！', '？', '\n'];
						let lastTerminator = -1;
						for (const t of terminators) {
							const idx = docText.lastIndexOf(t, from - 1);
							if (idx > lastTerminator) lastTerminator = idx;
						}
						highlightFrom = lastTerminator === -1 ? 0 : lastTerminator + 1;

						// Look forward for sentence end
						let nextTerminator = -1;
						for (const t of terminators) {
							const idx = docText.indexOf(t, to);
							if (idx !== -1 && (nextTerminator === -1 || idx < nextTerminator)) {
								nextTerminator = idx;
							}
						}
						highlightTo = nextTerminator === -1 ? docText.length : nextTerminator + 1;

						// Basic trimming logic without large substring creation
						while (highlightFrom < highlightTo && /\s/.test(docText[highlightFrom] || '')) {
							highlightFrom++;
						}
						while (highlightTo > highlightFrom && /\s/.test(docText[highlightTo - 1] || '')) {
							highlightTo--;
						}
					}

					// Dirty Check: Only dispatch if range changed OR it's the first time
					if (highlightFrom === this.lastHighlightFrom && highlightTo === this.lastHighlightTo) {
						// Range hasn't changed, but we might still need to scroll if the first word changed?
						// Usually if range hasn't changed, it means we are in the same word (or same sentence).
						// So we can skip.
					} else {
						this.lastHighlightFrom = highlightFrom;
						this.lastHighlightTo = highlightTo;

						const safeEditor = this.activeEditor as unknown as SafeEditor;
						const view = safeEditor.cm || safeEditor.editor?.cm || safeEditor.view;
						if (view && view.dispatch) {
							let safeTo = highlightTo;
							if (safeTo <= highlightFrom) {
								if (highlightFrom < docText.length) {
									safeTo = highlightFrom + 1;
								} else {
									return;
								}
							}

							const shouldScroll = this.settings.autoScrollMode !== 'off';
							const shouldMoveCursor = this.settings.autoScrollMode === 'cursor';

							const transaction: TransactionSpec = {
								scrollIntoView: shouldScroll
							};

							// Only add highlight effect if mode is NOT 'none'
							if (this.settings.highlightMode !== 'none') {
								transaction.effects = [setActiveRange.of({ from: highlightFrom, to: safeTo })];
							}

							// If mode is 'cursor', move cursor to ensure Live Preview renders Source Mode for tables
							if (shouldMoveCursor) {
								transaction.selection = { anchor: safeTo };
							}

							view.dispatch(transaction);
						}
					}
				} else {
					// console.warn(`[VoxTrack] Sync: Could not find "${wordToFind}" after ${currentDocOffset} (base: ${chunkBaseOffset})`);
				}
			}

			this.syncInterval = requestAnimationFrame(updateLoop);
		};
		this.syncInterval = requestAnimationFrame(updateLoop);
	}

	private expandWordSelection(text: string, start: number, length: number): { start: number, length: number } {
		// Only expand if the matched text is ASCII (likely English fragment)
		// If it's Chinese, usually TTS gives correct char/word boundaries.
		const fragment = text.substring(start, start + length);
		if (!/^[\w]+$/.test(fragment)) {
			return { start, length };
		}

		let newStart = start;
		let newEnd = start + length;

		// Expand Left (English/Number only)
		while (newStart > 0) {
			const prevChar = text[newStart - 1];
			if (prevChar && /[\w]/.test(prevChar)) {
				newStart--;
			} else {
				break;
			}
		}

		// Expand Right (English/Number only)
		while (newEnd < text.length) {
			const nextChar = text[newEnd];
			if (nextChar && /[\w]/.test(nextChar)) {
				newEnd++;
			} else {
				break;
			}
		}

		return { start: newStart, length: newEnd - newStart };
	}

	private async processNextChunk(statusBar: HTMLElement) {
		this.currentChunkIndex++;
		this.chunkScanOffset = 0;
		if (this.currentChunkIndex < this.textChunks.length) {
			const nextText = this.textChunks[this.currentChunkIndex];
			if (!nextText) return;

			this.baseOffset = this.chunkOffsets[this.currentChunkIndex] || 0;

			await this.sendChunk(nextText, statusBar);
		} else {
			this.isTransferFinished = true;
			this.player.finish();
			this.socket.close();
		}
	}

	private async sendChunk(text: string, statusBar?: HTMLElement) {
		const voice = this.settings.voice || 'zh-CN-XiaoxiaoNeural';
		const rate = '+0%';
		const pitch = '+0Hz';
		const volume = this.settings.volume || '+0%';
		const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';

		const escapedText = text.replace(/[<>&"']/g, (c) => {
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

		// console.debug('[VoxTrack] Sending SSML:', ssml);

		try {
			await this.socket.sendSSML(ssml, uuidv4().replace(/-/g, ''));
		} catch (error) {
			console.error('[VoxTrack] Error sending Chunk:', error);
			new Notice(t("Notice: Send Error"));
			this.stopPlayback(statusBar);
		}
	}

	private async togglePlay(editor: Editor, mode: 'auto' | 'cursor', statusBar: HTMLElement) {
		if (this.isPlaying) {
			// If user explicitly triggers "Read from cursor" command, 
			// we should always restart regardless of current state.
			if (mode === 'cursor') {
				this.stopPlayback(statusBar);
				// Continue to start new playback below
			} else {
				// Regular toggle behavior for status bar button or general play command
				if (this.isPaused) {
					await this.player.play();
					this.isPaused = false;
					this.updateStatus(t("Status: Playing"), true, false);
				} else {
					this.player.pause();
					this.isPaused = true;
					this.updateStatus(t("Status: Paused"), true, true);
				}
				return;
			}
		}

		let rawText = '';
		let startOffset = 0;

		if (mode === 'cursor') {
			const result = getTextFromCursor(editor);
			rawText = result.text;
			startOffset = result.offset;
		} else {
			// Auto mode: Selection -> Full Note
			const selection = getSelectedText(editor);
			if (selection) {
				rawText = selection.text;
				startOffset = selection.offset;
			} else {
				const full = getFullText(editor);
				rawText = full.text;
				startOffset = full.offset;
			}
		}

		if (!rawText.trim()) {
			new Notice(t("Notice: No text"));
			return;
		}

		this.textChunks = [];
		this.chunkOffsets = [];
		this.currentChunkIndex = 0;
		this.receivingChunkIndex = 0;
		this.activeMode = mode;

		const voice = this.settings.voice || 'zh-CN-XiaoxiaoNeural';
		const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';

		const chunks = this.textProcessor.process(rawText, {
			filterCode: this.settings.filterCode,
			filterLinks: this.settings.filterLinks,
			filterMath: this.settings.filterMath,
			filterFrontmatter: this.settings.filterFrontmatter,
			filterObsidian: this.settings.filterObsidian,
			lang: lang
		});

		if (chunks.length === 0) {
			new Notice(t("Notice: Filtered"));
			return;
		}

		this.textChunks = chunks.map(c => c.text);
		this.chunkMaps = chunks.map(c => c.map);
		// Note: We fill all with startOffset because TrackedString.map contains the absolute index relative to the *original* text passed to it.
		// Since we passed the text starting at startOffset, map values are relative to startOffset.
		// So absPos = startOffset + map[i] is correct for ANY chunk.
		this.chunkOffsets = new Array<number>(chunks.length).fill(startOffset);

		try {
			this.player.reset();
			await this.player.initSource();
			this.player.setPlaybackRate(this.settings.playbackSpeed);

			this.updateStatus(t("Status: Connecting"), false, false);
			this.activeEditor = editor;
			this.isPlaying = true;
			this.isPaused = false;
			this.isTransferFinished = false;
			this.hasShownReceivingNotice = false;
			this.baseOffset = startOffset;
			this.audioTimeOffset = 0;
			this.chunkScanOffset = 0;

			this.setupDataHandler(statusBar);
			await this.socket.connect();
			if (!this.isPlaying) {
				this.socket.close();
				return;
			}

			if (this.textChunks.length > 0 && this.textChunks[0]) {
				// console.debug('[VoxTrack] Processed Chunk 0 Text:', JSON.stringify(this.textChunks[0]));
				await this.sendChunk(this.textChunks[0], statusBar);
			}

			if (!this.isPlaying) return; // Check again
			this.updateStatus(t("Status: Playing"), true, false);

		} catch (e) {
			const message = e instanceof Error ? e.message : 'Unknown error';
			console.error('[VoxTrack] Playback Error:', e);
			new Notice(`VoxTrack Error: ${message}`);
			this.stopPlayback(statusBar);
		}
	}

	private stopPlayback(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isPaused = false;
		this.activeMode = null;
		this.isTransferFinished = false;
		this.lastHighlightFrom = -1;
		this.lastHighlightTo = -1;
		if (this.activeEditor) {
			const safeEditor = this.activeEditor as unknown as SafeEditor;
			const view = safeEditor.cm || safeEditor.editor?.cm || safeEditor.view;
			if (view && view.dispatch) {
				view.dispatch({ effects: setActiveRange.of(null) });
			}
		}
		this.activeEditor = null;
		this.textChunks = [];
		this.currentChunkIndex = 0;
		this.updateStatus(t("Status: Ready"), false, false);
	}

	private handlePlaybackFinished(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isPaused = false;
		this.activeMode = null;
		this.isTransferFinished = false;
		this.lastHighlightFrom = -1;
		this.lastHighlightTo = -1;
		if (this.syncInterval) cancelAnimationFrame(this.syncInterval);
		this.syncController.reset();

		if (this.activeEditor) {
			const safeEditor = this.activeEditor as unknown as SafeEditor;
			const view = safeEditor.cm || safeEditor.editor?.cm || safeEditor.view;
			if (view && view.dispatch) {
				view.dispatch({ effects: setActiveRange.of(null) });
			}
		}

		this.activeEditor = null;
		this.textChunks = [];
		this.currentChunkIndex = 0;
		this.updateStatus(t("Status: Ready"), false, false);
	}

	public async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as unknown as VoxTrackSettings;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Migration: autoScroll (boolean) -> autoScrollMode (string)
		if ('autoScroll' in this.settings) {
			const legacySettings = this.settings as Record<string, unknown>;
			if (typeof legacySettings.autoScroll === 'boolean') {
				this.settings.autoScrollMode = legacySettings.autoScroll ? 'cursor' : 'off';
				delete legacySettings.autoScroll;
				await this.saveSettings();
			}
		}
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	public setPlaybackSpeed(speed: number) {
		if (this.player) {
			this.player.setPlaybackRate(speed);
		}
	}

	public applyHighlightColor() {
		// Remove existing color classes
		const colors = ['yellow', 'green', 'blue', 'purple', 'red', 'none'];
		for (const c of colors) {
			document.body.classList.remove(`voxtrack-color-${c}`);
		}
		// Add selected color class
		document.body.classList.add(`voxtrack-color-${this.settings.highlightColor || 'yellow'}`);
	}

	private unescapeHtml(text: string): string {
		return text
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'");
	}

	private updateStatus(text: string, isPlaying: boolean, isPaused: boolean) {
		if (this.statusBarTextEl) {
			this.statusBarTextEl.setText(text);
		}
		if (this.statusBarPlayBtn) {
			// If playing and NOT paused, show pause icon. Otherwise show play icon.
			const showPause = isPlaying && !isPaused;
			setIcon(this.statusBarPlayBtn, showPause ? 'pause' : 'play');
			this.statusBarPlayBtn.setAttribute('aria-label', showPause ? 'Pause' : 'Play');
		}
	}

	private scrollToActive() {
		if (this.activeEditor && this.lastHighlightFrom !== -1) {
			const safeEditor = this.activeEditor as unknown as SafeEditor;
			const view = safeEditor.cm || safeEditor.editor?.cm || safeEditor.view;
			if (view) {
				view.dispatch({
					effects: [EditorView.scrollIntoView(this.lastHighlightFrom, { y: 'center' })]
				});
			}
		}
	}
}
