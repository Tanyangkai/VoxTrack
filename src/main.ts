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
import { parseMetadata, EdgeResponse, AudioMetadata, isJunkMetadata } from './api/protocol';
import { TextProcessor } from './text-processor';
import { getSelectedText, getTextFromCursor, getFullText } from './utils/editor-utils';
import { findWordIndexInDoc, fuzzyIndexOf } from './utils/sync-utils';
import { SessionManager } from './utils/session-utils';
import { t } from './i18n/translations';
import { FileLogger } from './utils/logger';

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
	private chunkScanOffsets: number[] = []; // Per-chunk scan offsets
	private requestToChunkMap: Map<string, number> = new Map(); // Map X-RequestId to chunkIndex
	private lastHighlightFrom: number = -1;
	private lastHighlightTo: number = -1;
	private sessionManager: SessionManager = new SessionManager();
	private currentDocOffset: number = 0; // Tracks document offset for highlight search optimization

	// Status Bar Elements
	private statusBarItemEl: HTMLElement;
	private statusBarTextEl: HTMLElement;
	private statusBarPlayBtn: HTMLElement;
	private statusBarStopBtn: HTMLElement;
	private statusBarLocateBtn: HTMLElement;

	private receivingChunkIndex: number = 0;
	private isReceivingData: boolean = false;
	private isRecovering: boolean = false;
	private retryCount: number = 0;
	private readonly MAX_RETRIES = 3;
	private lastProcessedTextIndex: number = 0;
	private chunkTruncationOffset: number = 0;
	private recoveryTimeOffset: number = 0; // Additional time offset for recovered chunks

	public async onload(): Promise<void> {
		await this.loadSettings();
		this.applyHighlightColor();

		FileLogger.initialize(this.app);
		void FileLogger.log('Plugin loaded');

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
				void this.togglePlay(this.activeEditor, 'auto', this.statusBarItemEl).catch(e => FileLogger.error('Toggle Play Error', e));
			} else {
				// If not playing, find active view
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl).catch(e => FileLogger.error('Toggle Play Error', e));
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
				void this.togglePlay(activeView.editor, 'auto', this.statusBarItemEl).catch(e => FileLogger.error('Toggle Play Error', e));
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
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "p" }],
			editorCallback: (editor: Editor) => {
				void (async () => {
					try {
						await this.togglePlay(editor, 'auto', this.statusBarItemEl);
					} catch (e) {
						void FileLogger.error('Command Error', e);
					}
				})();
			}
		});

		this.addCommand({
			id: 'read-from-cursor',
			name: t("Command: Read from cursor"),
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "r" }],
			editorCallback: (editor: Editor) => {
				void (async () => {
					try {
						await this.togglePlay(editor, 'cursor', this.statusBarItemEl);
					} catch (e) {
						void FileLogger.error('Command Error', e);
					}
				})();
			}
		});

		this.addCommand({
			id: 'stop',
			name: t("Command: Stop"),
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
			editorCallback: () => {
				this.stopPlayback(this.statusBarItemEl);
			}
		});

		this.addCommand({
			id: 'locate',
			name: t("Tooltip: Locate"),
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
			callback: () => {
				this.scrollToActive();
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
		if (this.syncInterval) {
			cancelAnimationFrame(this.syncInterval);
			this.syncInterval = null;
		}

		const sessionId = uuidv4();
		this.sessionManager.startNewSession(sessionId);

		this.socket.onMessage((data) => {
			void (async () => {
				if (!this.sessionManager.isValid(sessionId)) return;

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
								// Extract RequestId from headers
								let targetChunkIndex = this.receivingChunkIndex;
								const requestIdMatch = text.match(/X-RequestId:([a-f0-9]+)/i);
								if (requestIdMatch && requestIdMatch[1]) {
									const mappedIndex = this.requestToChunkMap.get(requestIdMatch[1]);
									if (mappedIndex !== undefined) {
										targetChunkIndex = mappedIndex;
									} else {
										// FileLogger.debug('Metadata: No mapping for RequestId', { id: requestIdMatch[1] });
									}
								} else {
									// FileLogger.debug('Metadata: No RequestId in message');
								}

								const jsonStr = text.substring(jsonStart + 4);
								const jsonObj = JSON.parse(jsonStr) as unknown as EdgeResponse;
								const rawMetadata = parseMetadata(jsonObj);

								if (rawMetadata.length > 0) {
									const currentChunkText = this.textChunks[targetChunkIndex] || '';

									// NEW: Aggressively filter out SSML tags and fragments that Edge TTS erroneously returns
									const validMetadata = rawMetadata.filter(m => !isJunkMetadata(m.text));

									for (const m of validMetadata) {
										if (this.audioTimeOffset > 0 || this.recoveryTimeOffset > 0) {
											m.offset += (this.audioTimeOffset + this.recoveryTimeOffset) * 10000000;
										}
										m.chunkIndex = targetChunkIndex;

										// Auto-correct Text Offset
										if (currentChunkText) {
											const searchText = this.unescapeHtml(m.text);
											let scanOffset = this.chunkScanOffsets[targetChunkIndex] || 0;

											// Limit search window to prevent jumping to distant matches (noise reduction)
											const searchWindow = 300;
											let found = currentChunkText.indexOf(searchText, scanOffset);

											if (found !== -1 && found > scanOffset + searchWindow) {
												found = -1;
											}

											if (found === -1) {
												const cleanSearch = searchText.replace(/[.,;!?。，；！？、]/g, '');
												if (cleanSearch.length > 0) {
													found = currentChunkText.indexOf(cleanSearch, scanOffset);
													if (found !== -1 && found > scanOffset + searchWindow) {
														found = -1;
													}
												}
											}

											if (found !== -1) {
												// Ignore suspicious single-letter jumps (likely TTS garbage tokens)
												const isSingleLetter = searchText.length === 1 && /[a-zA-Z]/.test(searchText);
												if (isSingleLetter && found > scanOffset + 20) {
													// Skip this token
												} else {
													const expanded = this.expandWordSelection(currentChunkText, found, searchText.length);
													m.textOffset = expanded.start;
													m.wordLength = expanded.length;
													m.text = currentChunkText.substring(expanded.start, expanded.start + expanded.length);
													this.chunkScanOffsets[targetChunkIndex] = found + 1;
												}
											}
										}
									}
									this.syncController.addMetadata(validMetadata);
								}
							} catch (e) {
								void FileLogger.warn('Metadata parse error', e);
							}
						}
					} else if (text.includes('Path:turn.end')) {
						this.isReceivingData = false;
						// Wait for all audio data to be buffered to ensure accurate duration calculation
						// This fixes race condition where 'turn.end' arrives before silence is buffered
						await this.player.waitForQueueEmpty();

						// Calculate offset for next chunk
						const bufferedEnd = this.player.getBufferedEnd();
						const lastMetadataEnd = this.syncController.getLastEndTime() / 10000000; // Convert ticks to seconds

						// Use the maximum to ensure no overlap if metadata extends past buffer
						this.audioTimeOffset = Math.max(bufferedEnd, lastMetadataEnd);

						this.receivingChunkIndex++;
						await this.processNextChunk(statusBar);
					}
				}
			})();
		});

		this.socket.onClose((code, reason) => {
			if (!this.sessionManager.isValid(sessionId)) return;
			if (this.isPlaying) {
				if (this.isTransferFinished) {
					// No log
				} else if (!this.isReceivingData) {
					void FileLogger.log(`Socket closed while idle (Code: ${code}). Will reconnect on next request.`);
					// Do not stop playback. Auto-reconnect in sendChunk will handle next request.
				} else {
					void FileLogger.warn(`Socket closed unexpectedly during data transfer. Code: ${code}, Reason: ${reason}`);
					void this.recoverConnection(statusBar);
				}
			}
		});

		let lastActive: AudioMetadata | null = null;
		// Removed local currentDocOffset

		const updateLoop = () => {
			if (!this.sessionManager.isValid(sessionId)) {
				// Self-terminate old loop
				return;
			}
			if (!this.isPlaying) return;

			const time = this.player.getCurrentTime();
			const active = this.syncController.findActiveMetadata(time);

			if (active && active !== lastActive) {
				// FileLogger.debug('New Active Metadata', {
				// 	time,
				// 	text: active.text,
				// 	offset: active.offset,
				// 	chunk: active.chunkIndex
				// });
			}

			if (active && active !== lastActive && this.activeEditor) {
				if (lastActive === null || active.offset < lastActive.offset) {
					this.currentDocOffset = this.baseOffset;
				}
				lastActive = active;

				const docText = this.activeEditor.getValue();
				const wordToFind = active.text;
				let foundIndex = -1;

				// 1. Try Precise Map Lookup
				// Use the chunkIndex stored in metadata to find the correct map
				const mapIndex = active.chunkIndex;
				if (mapIndex === undefined) return; // Must have chunk info for reliable sync

				const currentMap = this.chunkMaps[mapIndex];
				const chunkBaseOffset = this.chunkOffsets[mapIndex] || 0;

				// Calculate the actual start of this chunk in the document
				let chunkActualStart = chunkBaseOffset;
				if (currentMap && currentMap.length > 0) {
					const firstCharOffset = currentMap[0];
					if (firstCharOffset !== undefined) {
						chunkActualStart = chunkBaseOffset + firstCharOffset;
					}
				}

				let startIdxInProcessed = active.textOffset;

				// Fallback: If textOffset is missing (or undefined), try to find the word in the processed chunk
				// using our local tracking index to handle long chunks where global search window fails.
				if (startIdxInProcessed === undefined && currentMap) {
					const chunkText = this.textChunks[mapIndex];
					if (chunkText) {
						// Use fuzzyIndexOf to match even if there are extra spaces in processed text (e.g. from punctuation replacement)
						const found = fuzzyIndexOf(chunkText, active.text, this.lastProcessedTextIndex);
						if (found !== -1) {
							// Basic sanity check: prevent jumping too far ahead? 
							// For now trust sequential playback.
							startIdxInProcessed = found;
						}
					}
				}

				if (currentMap && startIdxInProcessed !== undefined) {
					// active.textOffset is index in the processed chunk
					// active.wordLength is length in processed chunk

					// Update local tracker
					this.lastProcessedTextIndex = startIdxInProcessed;

					const endIdxInProcessed = startIdxInProcessed + active.wordLength;

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

							// Refine Map Result: 
							// The map might point to a replaced prefix (e.g. "- " becoming space).
							// If the text at the mapped location doesn't match, search forward slightly.
							// Exception: If we are looking for "Link" placeholder, do not search (it won't match).
							if (!wordToFind.includes('Link')) {
								const checkLen = wordToFind.length;
								const foundSlice = docText.substring(foundIndex, foundIndex + checkLen);
								if (foundSlice !== wordToFind) {
									// Try to find the exact word nearby
									const REFINEMENT_WINDOW = 50;
									const refinedIdx = findWordIndexInDoc({
										docText,
										wordToFind,
										currentDocOffset: foundIndex, // Start search from the mapped location
										chunkActualStart: chunkBaseOffset,
										searchWindow: REFINEMENT_WINDOW
									});
									
									if (refinedIdx !== -1) {
										foundIndex = refinedIdx;
									}
								}
							}
						}
					}
				}

				// Fallback Search
				if (foundIndex === -1) {
					const SEARCH_WINDOW = 500;
					foundIndex = findWordIndexInDoc({
						docText,
						wordToFind,
						currentDocOffset: this.currentDocOffset,
						chunkActualStart,
						searchWindow: SEARCH_WINDOW
					});
				}

									if (foundIndex !== -1) {
									const from = foundIndex;
				
									// Determine Length
									// If we used map, we might know the exact length in raw text
									// But we only got 'from'.
									// Let's recalculate 'to'.
				
									let matchLen = wordToFind.length;
				
									// Use map to find 'to' if possible
									// Use map to find 'to' if possible
									if (currentMap && active.textOffset !== undefined) {
										// Fix: Use the end of the LAST character of the word, rather than the start of the NEXT word.
										// This prevents the highlight from including skipped text (like markdown syntax, URLs, etc) that lies between words.
										const endIdxInProcessed = active.textOffset + active.wordLength;
				
										if (endIdxInProcessed > 0 && endIdxInProcessed <= currentMap.length) {
											// Look at the last character of the spoken word
											const lastCharRawStart = currentMap[endIdxInProcessed - 1];
				
											if (lastCharRawStart !== undefined && lastCharRawStart !== -1) {
												const absEnd = chunkBaseOffset + lastCharRawStart + 1; // +1 assumes 1-unit increments in map correspond to 1 unit in string
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

									// Special handling for "Link" placeholder
									// If TTS says "Link" but doc has URL, expand matchLen to cover the URL
									if (wordToFind.includes('Link')) {
										// Check if document actually has a URL here
										const potentialUrl = docText.substring(from);
										const urlMatch = potentialUrl.match(/^(https?:\/\/[^\s,)]+)/);
										if (urlMatch) {
											matchLen = urlMatch[0].length;
										}
									}
				
									const to = from + matchLen;
									
									// Text Mismatch Check
									const foundText = docText.substring(from, to);
									// Normalize both for comparison (ignore whitespace/punctuation differences)
									const normFound = foundText.replace(/\s+|[.,;!?。，；！？、]/g, '');
									const normExpected = wordToFind.replace(/\s+|[.,;!?。，；！？、]/g, '');
									
									// If they differ significantly, log a warning
									// Ignore mismatch if it's the "Link" placeholder case
									if (normFound !== normExpected && !wordToFind.includes('Link')) {
										void FileLogger.warn('Sync: Text Mismatch', {
											expected: wordToFind,
											found: foundText,
											index: from,
											chunk: active.chunkIndex
										});
									}
				
									this.currentDocOffset = to;
				
									let highlightFrom = from;					let highlightTo = to;

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
					// FileLogger.debug('Found Match (Sync)', {
					// 	word: wordToFind,
					// 	index: foundIndex,
					// 	highlightFrom,
					// 	highlightTo,
					// 	docSubstring: docText.substring(highlightFrom, highlightTo),
					// 	mapUsed: !!currentMap,
					// 	chunkIndex: active.chunkIndex,
					// 	audioTime: time
					// });
				} else {
					void FileLogger.warn(`Sync: Could not find "${wordToFind}"`, {
						currentDocOffset: this.currentDocOffset,
						chunkBase: chunkBaseOffset,
						chunkActualStart: chunkActualStart,
						searchWindow: 500
					});
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
		this.chunkTruncationOffset = 0;
		this.recoveryTimeOffset = 0;
		this.lastProcessedTextIndex = 0;
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
			// FileLogger.debug('Sending Chunk', { index: this.receivingChunkIndex, length: ssml.length, textLen: escapedText.length });
			this.isReceivingData = true;
			const requestId = uuidv4().replace(/-/g, '');
			this.requestToChunkMap.set(requestId, this.receivingChunkIndex);
			await this.socket.sendSSML(ssml, requestId);
		} catch (error) {
			void FileLogger.warn('Send Error, triggering recovery', error);
			void this.recoverConnection(statusBar);
		}
	}

	private async recoverConnection(statusBar: HTMLElement) {
		if (this.isRecovering) return;
		this.isRecovering = true;

		if (this.retryCount >= this.MAX_RETRIES) {
			void FileLogger.error('Max retries reached. Stopping.');
			new Notice(t("Notice: Connection lost"));
			this.stopPlayback(statusBar);
			this.isRecovering = false;
			return;
		}

		this.retryCount++;
		new Notice(`VoxTrack: Reconnecting... (${this.retryCount}/${this.MAX_RETRIES})`);

		// Add backoff delay to allow network to settle
		if (this.retryCount > 1) {
			await new Promise(r => setTimeout(r, 1000 * this.retryCount));
		}

		try {
			// 1. Calculate restart point
			// Use player's last known time to find the exact metadata we were at.
			// This is more reliable than lastProcessedTextIndex which relies on successful highlighs.
			const interruptionTime = this.player.getCurrentTime();
			let lastActiveItem = this.syncController.findActiveMetadata(interruptionTime);
			
			// Fallback: If no active item (e.g. silence), find closest preceding item
			if (!lastActiveItem) {
				lastActiveItem = this.syncController.findClosestMetadata(interruptionTime);
			}

			// Critical Fix: If we found metadata, trust its chunkIndex. 
			// currentChunkIndex might have advanced if we were buffering the next chunk.
			if (lastActiveItem && lastActiveItem.chunkIndex !== undefined) {
				this.currentChunkIndex = lastActiveItem.chunkIndex;
			}

			// Critical Fix: Also sync receivingChunkIndex to ensure new requests map to the correct chunk
			this.receivingChunkIndex = this.currentChunkIndex;

			const currentText = this.textChunks[this.currentChunkIndex] || '';
			let restartIndex = 0;
			
			// Determine the text index to scan backwards from
			let scanStart = this.lastProcessedTextIndex;
			if (lastActiveItem && lastActiveItem.textOffset !== undefined) {
				scanStart = lastActiveItem.textOffset;
			}
			
			if (scanStart > 0 && currentText) {
				const lookbackText = currentText.substring(0, scanStart);
				const terminators = /[.!?。！？\n]/;
				const secondaryTerminators = /[,，;；]/;

				let lastTerminator = -1;
				let lastSecondaryTerminator = -1;
				
				// Find terminators
				for (let i = lookbackText.length - 1; i >= 0; i--) {
					const char = lookbackText[i];
					// STRICTER CHECK: Terminator must be followed by whitespace or end of string (conceptually)
					// to avoid splitting abbreviations like "node.js" or "v1.0".
					// Since lookbackText ends at scanStart, we check characters relative to i inside lookbackText
					// or we check the char AFTER i in the original currentText.
					
					const absoluteIndex = i; // Index in lookbackText (which starts at 0 of chunk)
					const charAfter = currentText[absoluteIndex + 1];

					if (terminators.test(char)) {
						// Only treat as terminator if followed by whitespace/newline or if it's the end of text
						if (!charAfter || /\s/.test(charAfter)) {
							lastTerminator = i;
							break;
						}
					}
					if (lastSecondaryTerminator === -1 && secondaryTerminators.test(char)) {
						// Secondary terminators (comma) logic can remain simpler or also check whitespace?
						// Let's keep it simple for now or apply same logic?
						// Usually comma followed by space.
						if (!charAfter || /\s/.test(charAfter)) {
							lastSecondaryTerminator = i;
						}
					}
				}
				
				if (lastTerminator !== -1) {
					// If primary terminator is close enough (<= 50 chars), use it.
					// Otherwise, prefer secondary terminator to avoid long rewinds.
					if ((scanStart - lastTerminator) <= 50) {
						restartIndex = lastTerminator + 1;
					} else if (lastSecondaryTerminator !== -1) {
						restartIndex = lastSecondaryTerminator + 1;
					} else {
						restartIndex = lastTerminator + 1;
					}
				} else if (lastSecondaryTerminator !== -1) {
					restartIndex = lastSecondaryTerminator + 1;
				}
			}

			// Calculate relative start time for the restartIndex to align player timeline
			let relativeStartTime = 0;
			if (restartIndex > 0) {
				const restartMetadata = this.syncController.findMetadataByTextOffset(restartIndex, this.currentChunkIndex);
				if (restartMetadata) {
					// restartMetadata.offset is ABSOLUTE time (ticks).
					// We need RELATIVE time within the chunk (seconds).
					// relative = (absolute - chunkStart) / 10^7
					
					const chunkStartTimeTicks = this.audioTimeOffset * 10000000;
					relativeStartTime = (restartMetadata.offset - chunkStartTimeTicks) / 10000000.0;
					
					// Sanity check: relative time should be >= 0
					if (relativeStartTime < 0) relativeStartTime = 0;
				}
			}
			
			this.recoveryTimeOffset = relativeStartTime; // Store for metadata adjustment

			void FileLogger.debug('Recovery Logic', { 
				interruptionTime, 
				lastActiveText: lastActiveItem?.text, 
				lastActiveOffset: lastActiveItem?.textOffset, 
				scanStart, 
				restartIndex,
				relativeStartTime
			});

			// 2. Full reset player to current chunk start time + relative offset
			// We reset buffer timeline to start at audioTimeOffset + relativeStartTime. 
			// The new audio (which starts from restartIndex) will play starting from this time.
			await this.player.restartAt(this.audioTimeOffset + this.recoveryTimeOffset);
			
			// 3. Clear metadata for the current chunk to avoid duplication/conflicts
			this.syncController.removeChunk(this.currentChunkIndex);
			
			// 4. Set scan offset so metadata matching works on the Full Text
			this.chunkScanOffsets[this.currentChunkIndex] = restartIndex;
			this.lastProcessedTextIndex = restartIndex; // Reset tracking to restart point

			// Reset currentDocOffset to align with restartIndex
			// This prevents Fallback Search from searching past the restart point if Map Lookup fails
			const currentMap = this.chunkMaps[this.currentChunkIndex];
			if (currentMap && restartIndex < currentMap.length) {
				const rawOffset = currentMap[restartIndex];
				if (rawOffset !== undefined) {
					this.currentDocOffset = this.baseOffset + rawOffset;
				} else {
					this.currentDocOffset = this.baseOffset;
				}
			} else {
				this.currentDocOffset = this.baseOffset;
			}

			// 5. Reconnect
			await this.socket.connect();

			// 6. Resend partial chunk
			if (currentText) {
				const partialText = currentText.substring(restartIndex);
				await this.sendChunk(partialText, statusBar);
				void FileLogger.log('Recovery successful.');
				this.retryCount = 0; // Reset on success
			}
		} catch (e) {
			void FileLogger.error('Recovery failed', e);
			// Do not stop here immediately, let the next trigger (or user) decide, 
			// or maybe we should just stop if connect failed? 
			// If connect failed, we probably can't do anything.
			// But let's leave isRecovering = false so we can try again if triggered?
			// No, if connect failed, we should probably stop.
			new Notice(t("Notice: Connection lost"));
			this.stopPlayback(statusBar);
		} finally {
			this.isRecovering = false;
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

		let processingText = '';
		let baseDocOffset = 0;
		let cursorTargetOffset = 0;

		const selection = getSelectedText(editor);

		// Logic:
		// 1. Auto mode with Selection -> Read Selection only (User intent is specific)
		// 2. Cursor/Auto mode without Selection -> Read from Cursor/Start using Full Text context
		if (mode === 'auto' && selection) {
			processingText = selection.text;
			baseDocOffset = selection.offset;
			cursorTargetOffset = 0; // Start from beginning of selection
		} else {
			const full = getFullText(editor);
			processingText = full.text;
			baseDocOffset = 0;

			if (mode === 'cursor') {
				const cursor = editor.getCursor('from');
				cursorTargetOffset = editor.posToOffset(cursor);
			} else {
				cursorTargetOffset = 0; // Start from beginning
			}
		}

		if (!processingText.trim()) {
			new Notice(t("Notice: No text"));
			return;
		}

		this.textChunks = [];
		this.chunkOffsets = [];
		this.chunkMaps = []; // Reset maps
		this.chunkScanOffsets = [];
		this.requestToChunkMap.clear();
		this.currentChunkIndex = 0;
		this.receivingChunkIndex = 0;
		this.activeMode = mode;

		const voice = this.settings.voice || 'zh-CN-XiaoxiaoNeural';
		const lang = voice.startsWith('zh') ? 'zh-CN' : 'en-US';

		const chunks = this.textProcessor.process(processingText, {
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

		// Slice chunks based on cursorTargetOffset
		let foundStart = false;
		for (const chunk of chunks) {
			if (foundStart) {
				this.textChunks.push(chunk.text);
				this.chunkMaps.push(chunk.map);
				this.chunkOffsets.push(baseDocOffset);
				continue;
			}

			// Find if this chunk contains the start point
			// We look for the first character in the chunk that maps to a position >= cursorTargetOffset
			let sliceIndex = -1;
			for (let i = 0; i < chunk.map.length; i++) {
				if (chunk.map[i] >= cursorTargetOffset) {
					sliceIndex = i;
					foundStart = true;
					break;
				}
			}

			if (foundStart) {
				const text = chunk.text.substring(sliceIndex);
				const map = chunk.map.slice(sliceIndex);
				if (text.length > 0) {
					this.textChunks.push(text);
					this.chunkMaps.push(map);
					this.chunkOffsets.push(baseDocOffset);
				}
			}
		}

		if (this.textChunks.length === 0) {
			new Notice(t("Notice: Filtered"));
			return;
		}

		try {
			this.player.reset();
			this.player.setPlaybackRate(this.settings.playbackSpeed);

			this.updateStatus(t("Status: Connecting"), false, false);
			this.activeEditor = editor;
			this.isPlaying = true;
			this.isPaused = false;
			this.isTransferFinished = false;
			this.hasShownReceivingNotice = false;
			this.baseOffset = this.chunkOffsets[0] || 0; // Use first chunk's offset
			this.currentDocOffset = this.baseOffset;
			this.audioTimeOffset = 0;
			this.recoveryTimeOffset = 0;
			this.chunkScanOffsets = new Array(this.textChunks.length).fill(0) as number[];
			this.lastProcessedTextIndex = 0;
	
			this.setupDataHandler(statusBar);
			
			// Parallelize initialization to reduce startup latency
			await Promise.all([
				this.player.initSource().then(() => {
					// Start playback state immediately after source is ready.
					// The player will buffer until data arrives.
					// We do NOT await play() here to avoid potential deadlocks if play() waits for data.
					if (this.isPlaying && !this.isPaused) {
						void this.player.play().catch(e => FileLogger.warn('[VoxTrack] Pre-play warning', e));
					}
				}),
				this.socket.connect()
			]);

			if (!this.isPlaying) {
				this.socket.close();
				return;
			}

			if (this.textChunks.length > 0 && this.textChunks[0]) {
				await this.sendChunk(this.textChunks[0], statusBar);
			}

			if (!this.isPlaying) return; // Check again
			this.updateStatus(t("Status: Playing"), true, false);

		} catch (e) {
			const message = e instanceof Error ? e.message : 'Unknown error';
			void FileLogger.error('Playback Error', e);
			new Notice(`VoxTrack Error: ${message}`);
			this.stopPlayback(statusBar);
		}
	}

	private stopPlayback(statusBar?: HTMLElement) {
		this.player.stop(); // Stop audio playback immediately
		this.socket.close(); // Close connection to stop any pending data/metadata
		this.isPlaying = false;
		this.isPaused = false;
		this.activeMode = null;
		this.isTransferFinished = false;
		this.lastHighlightFrom = -1;
		this.lastHighlightTo = -1;
		this.sessionManager.clear();
		this.requestToChunkMap.clear();
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

	private handlePlaybackFinished(statusBar?: HTMLElement) {
		this.isPlaying = false;
		this.isPaused = false;
		this.activeMode = null;
		this.isTransferFinished = false;
		this.lastHighlightFrom = -1;
		this.lastHighlightTo = -1;
		this.sessionManager.clear();
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
