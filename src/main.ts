import { Editor, MarkdownView, Plugin, Notice, setIcon } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { VoxTrackSettings, DEFAULT_SETTINGS, VoxTrackSettingTab } from './settings/setting-tab';
import { AudioPlayer } from './audio/player';
import { SyncController } from './sync/controller';
import { EdgeSocket } from './api/edge-socket';
import { voxTrackExtensions } from './editor/extensions';
import { setActiveRange } from './editor/decorations';
import { parseMetadata } from './api/protocol';
import { TextProcessor } from './text-processor';
import { getSelectedText, getTextFromCursor, getFullText } from './utils/editor-utils';

export default class VoxTrackPlugin extends Plugin {
	settings: VoxTrackSettings;
	private player: AudioPlayer;
	private syncController: SyncController;
	private socket: EdgeSocket;
	private textProcessor: TextProcessor;
	private isPlaying: boolean = false;
	private isPaused: boolean = false;
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

	// Status Bar Elements
	private statusBarItemEl: HTMLElement;
	private statusBarTextEl: HTMLElement;
	private statusBarPlayBtn: HTMLElement;
	private statusBarStopBtn: HTMLElement;

	public async onload(): Promise<void> {
		await this.loadSettings();

		this.player = new AudioPlayer();
		this.syncController = new SyncController();
		this.socket = new EdgeSocket();
		this.textProcessor = new TextProcessor();

		this.addSettingTab(new VoxTrackSettingTab(this.app, this));
		this.registerEditorExtension(voxTrackExtensions());

		// Status Bar Initialization
		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.addClass('voxtrack-status-bar');

		this.statusBarTextEl = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-text', text: 'VoxTrack: Ready' });

		// Play/Pause Button
		this.statusBarPlayBtn = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-btn', attr: { 'aria-label': 'Play/Pause' } });
		setIcon(this.statusBarPlayBtn, 'play');
		this.statusBarPlayBtn.onclick = () => {
			if (this.isPlaying && this.activeEditor) {
				// If playing, just toggle
				void this.togglePlay(this.activeEditor, 'auto', this.statusBarItemEl);
			} else {
				// If not playing, find active view
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl);
				} else {
					new Notice('VoxTrack: No active Markdown editor found.');
				}
			}
		};

		// Stop Button
		this.statusBarStopBtn = this.statusBarItemEl.createSpan({ cls: 'voxtrack-status-btn', attr: { 'aria-label': 'Stop' } });
		setIcon(this.statusBarStopBtn, 'square');
		this.statusBarStopBtn.onclick = () => {
			if (this.isPlaying) {
				this.stopPlayback(this.statusBarItemEl);
			}
		};


		// Ribbon Icon
		this.addRibbonIcon('play-circle', 'VoxTrack: Play/Pause', (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl);
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
			id: 'voxtrack-play',
			name: 'Play / pause',
			editorCallback: (editor: Editor) => {
				void this.togglePlay(editor, 'auto', this.statusBarItemEl);
			}
		});

		this.addCommand({
			id: 'voxtrack-read-from-cursor',
			name: 'Read from cursor',
			editorCallback: (editor: Editor) => {
				void this.togglePlay(editor, 'cursor', this.statusBarItemEl);
			}
		});

		this.addCommand({
			id: 'voxtrack-stop',
			name: 'Stop',
			editorCallback: () => {
				this.stopPlayback(this.statusBarItemEl);
			}
		});

		// Context Menu
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('VoxTrack: Read from cursor')
						.setIcon('play-circle')
						.onClick(() => {
							void this.togglePlay(editor, 'cursor', this.statusBarItemEl);
						});
				});
			})
		);
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

					// Only auto-play if we are logically "playing" and NOT "paused"
					if (this.isPlaying && !this.isPaused) {
						void this.player.play().catch(() => { });
					}
				}
			} else {
				const text = new TextDecoder('utf-8').decode(buffer);
				if (text.includes('Path:audio.metadata')) {
					const jsonStart = text.indexOf('\r\n\r\n');
					if (jsonStart !== -1) {
						try {
							const jsonStr = text.substring(jsonStart + 4);
							const jsonObj = JSON.parse(jsonStr);
							const metadata = parseMetadata(jsonObj);
							if (metadata.length > 0) {
								const currentChunkText = this.textChunks[this.currentChunkIndex] || '';
                                // DEBUG: Log chunk text once
                                if (this.chunkScanOffset === 0 && this.currentChunkIndex === 0 && metadata[0].offset < 5000000) {
                                    console.log('[VoxTrack] Current Chunk Text:', JSON.stringify(currentChunkText));
                                }

								if (this.audioTimeOffset > 0) {
									for (const m of metadata) {
										m.offset += this.audioTimeOffset;
										m.chunkIndex = this.currentChunkIndex;

										// Auto-correct Text Offset
										if (currentChunkText) {
											const found = currentChunkText.indexOf(m.text, this.chunkScanOffset);
											if (found !== -1) {
                                                // console.log(`[VoxTrack] Correction: "${m.text}" found at ${found} (was ${m.textOffset}, scan ${this.chunkScanOffset})`);
												
												// Try to expand selection to full word if it looks like a partial match
												const expanded = this.expandWordSelection(currentChunkText, found, m.wordLength);
												m.textOffset = expanded.start;
												m.wordLength = expanded.length;
												m.text = currentChunkText.substring(expanded.start, expanded.start + expanded.length);

												// Advance scan offset, ensuring we don't skip too much if words overlap (unlikely)
												// Use a safe increment.
												this.chunkScanOffset = found + 1; 
											} else {
                                                console.warn(`[VoxTrack] Correction Failed: "${m.text}" not found after ${this.chunkScanOffset}`);
                                            }
										}
									}
								} else {
									for (const m of metadata) {
										m.chunkIndex = this.currentChunkIndex;
										
										// Auto-correct Text Offset
										if (currentChunkText) {
											const found = currentChunkText.indexOf(m.text, this.chunkScanOffset);
											if (found !== -1) {
                                                // console.log(`[VoxTrack] Correction: "${m.text}" found at ${found} (was ${m.textOffset}, scan ${this.chunkScanOffset})`);
												
												const expanded = this.expandWordSelection(currentChunkText, found, m.wordLength);
												m.textOffset = expanded.start;
												m.wordLength = expanded.length;
												m.text = currentChunkText.substring(expanded.start, expanded.start + expanded.length);

												this.chunkScanOffset = found + 1;
											} else {
                                                console.warn(`[VoxTrack] Correction Failed: "${m.text}" not found after ${this.chunkScanOffset}`);
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
					this.audioTimeOffset = this.syncController.getLastEndTime();
					void this.processNextChunk(statusBar);
				}
			}
		});

		this.socket.onClose(() => {
			if (this.isPlaying) {
				if (this.isTransferFinished) {
					// No log
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
                // DEBUG: Log sync details
                console.log('[VoxTrack] Sync:', {
                    word: active.text,
                    time: time.toFixed(3),
                    textOffset: active.textOffset,
                    chunkIdx: active.chunkIndex,
                    mapLen: this.chunkMaps[active.chunkIndex || 0]?.length,
                    rawStart: this.chunkMaps[active.chunkIndex || 0]?.[active.textOffset]
                });

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
						
						// Try to find rawEnd. The end index might be mapped, or we might need to look at the next mapped char.
						// If endIdxInProcessed is out of bounds (end of string), rawEnd is implied?
						// We can look at map[endIdxInProcessed] if it exists, else map[endIdxInProcessed - 1] + 1?
						
						let rawEnd = -1;
						if (endIdxInProcessed < currentMap.length) {
							const val = currentMap[endIdxInProcessed];
							if (val !== undefined) {
								rawEnd = val;
							}
						} else if (currentMap.length > 0) {
							// End of string, guess based on last char
							// Note: This might be inaccurate if there are trailing deleted chars, but "word" usually doesn't include them.
							// Assuming raw chars are contiguous for the word:
							// We can just calculate length based on content if map fails for end.
						}

						if (rawStart !== undefined && rawStart !== -1) {
							const absStart = chunkBaseOffset + rawStart;
							foundIndex = absStart;
							
							// Verify if the text at this location looks vaguely correct (optional, but good for safety)
							// const potentialMatch = docText.substring(absStart, absStart + 1);
							// if (potentialMatch.toLowerCase() !== wordToFind[0].toLowerCase()) { ... }
							// Trust the map for now.
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
					const lowerWord = wordToFind.toLowerCase();
					foundIndex = lowerDoc.indexOf(lowerWord, currentDocOffset);
				}

				// Fallback 3: Fuzzy search (strip punctuation from wordToFind)
				// TTS sometimes adds punctuation like commas or periods that aren't in source
				if (foundIndex === -1) {
					const cleanWord = wordToFind.replace(/[.,;!?。，；！？、]/g, '');
					if (cleanWord.length > 0 && cleanWord !== wordToFind) {
						foundIndex = docText.indexOf(cleanWord, currentDocOffset);
						// Try case-insensitive specific clean word
						if (foundIndex === -1) {
							foundIndex = docText.toLowerCase().indexOf(cleanWord.toLowerCase(), currentDocOffset);
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

					const view = (this.activeEditor as any).cm || (this.activeEditor as any).editor?.cm || (this.activeEditor as any).view;
					if (view && view.dispatch) {
						// Defensive check: CodeMirror Mark decorations cannot be empty (from === to).
						// Ensure we have at least 1 character if possible, or skip update.
						let safeTo = to;
						if (safeTo <= from) {
							if (from < docText.length) {
								safeTo = from + 1;
							} else {
								// End of doc, cannot extend.
								// If from > 0, try extending backwards? Or just ignore.
								// Ignoring is safest to prevent crash.
								return; 
							}
						}

						const shouldScroll = this.settings.autoScrollMode !== 'off';
						const shouldMoveCursor = this.settings.autoScrollMode === 'cursor';

						const transaction: any = {
							effects: setActiveRange.of({ from, to: safeTo }),
							scrollIntoView: shouldScroll
						};

						// If mode is 'cursor', move cursor to ensure Live Preview renders Source Mode for tables
						if (shouldMoveCursor) {
							transaction.selection = { anchor: safeTo };
						}

						view.dispatch(transaction);
					}
				} else {
					console.warn(`[VoxTrack] Sync: Could not find "${wordToFind}" after ${currentDocOffset} (base: ${chunkBaseOffset})`);
					// Debug context
					const context = docText.substring(currentDocOffset, Math.min(currentDocOffset + 50, docText.length));
					console.debug(`[VoxTrack] Sync Context: Next 50 chars in doc: "${context}"`);
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
		while (newStart > 0 && /[\w]/.test(text[newStart - 1])) {
			newStart--;
		}

		// Expand Right (English/Number only)
		while (newEnd < text.length && /[\w]/.test(text[newEnd])) {
			newEnd++;
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
		const rate = this.settings.rate || '+0%';
		const pitch = this.settings.pitch || '+0Hz';
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

		try {
			await this.socket.sendSSML(ssml, uuidv4().replace(/-/g, ''));
		} catch (error) {
			console.error('[VoxTrack] Error sending Chunk:', error);
			new Notice('VoxTrack: Failed to send text to TTS service');
			this.stopPlayback(statusBar);
		}
	}

	private async togglePlay(editor: Editor, mode: 'auto' | 'cursor', statusBar: HTMLElement) {
		if (this.isPlaying) {
			if (this.isPaused) {
				await this.player.play();
				this.isPaused = false;
				this.updateStatus('VoxTrack: Playing...', true, false);
			} else {
				this.player.pause();
				this.isPaused = true;
				this.updateStatus('VoxTrack: Paused', true, true);
			}
			return;
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
			new Notice('No text to speak');
			return;
		}

		this.textChunks = [];
		this.chunkOffsets = [];
		this.currentChunkIndex = 0;

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
			new Notice('No speakable text found after filtering');
			return;
		}

		this.textChunks = chunks.map(c => c.text);
		this.chunkMaps = chunks.map(c => c.map);
		// Note: We fill all with startOffset because TrackedString.map contains the absolute index relative to the *original* text passed to it.
		// Since we passed the text starting at startOffset, map values are relative to startOffset.
		// So absPos = startOffset + map[i] is correct for ANY chunk.
		this.chunkOffsets = new Array(chunks.length).fill(startOffset);

		try {
			this.player.reset();
			await this.player.initSource();

			this.updateStatus('VoxTrack: Connecting...', false, false);
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
				await this.sendChunk(this.textChunks[0], statusBar);
			}

			if (!this.isPlaying) return; // Check again
			this.updateStatus('VoxTrack: Playing...', true, false);

		} catch (e: any) {
			console.error('[VoxTrack] Playback Error:', e);
			new Notice(`VoxTrack Error: ${e.message || 'Unknown'}`);
			this.stopPlayback(statusBar);
		}
	}

	private stopPlayback(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isPaused = false;
		this.isTransferFinished = false;
		if (this.syncInterval) cancelAnimationFrame(this.syncInterval);
		this.player.stop();
		this.socket.close();
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
		this.updateStatus('VoxTrack: Ready', false, false);
	}

	private handlePlaybackFinished(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isPaused = false;
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
		this.updateStatus('VoxTrack: Ready', false, false);
	}

	public async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// Migration: autoScroll (boolean) -> autoScrollMode (string)
		if ('autoScroll' in this.settings) {
			const legacySettings = this.settings as any;
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
}
