
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';

// Minimal mock setup for simulation
jest.mock('../src/audio/player');
jest.mock('../src/api/edge-socket');
jest.mock('../src/sync/controller');

describe('Recover Connection Logic', () => {
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    
    // We need to simulate the plugin instance context
    let pluginContext: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock Player
        mockPlayer = {
            restartAt: jest.fn().mockResolvedValue(undefined),
            getBufferedEnd: jest.fn().mockReturnValue(10), // Example buffered end
            reset: jest.fn(),
            stop: jest.fn(),
            finish: jest.fn()
        };
        (AudioPlayer as jest.Mock).mockImplementation(() => mockPlayer);

        // Mock Socket
        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn(),
            onClose: jest.fn()
        };
        (EdgeSocket as jest.Mock).mockImplementation(() => mockSocket);

        // Mock Controller
        mockController = {
            removeChunk: jest.fn(),
            reset: jest.fn(),
            findActiveMetadata: jest.fn().mockReturnValue({ textOffset: undefined }),
            findMetadataByTextOffset: jest.fn().mockReturnValue({ offset: 20000000 }) // Default 2s offset for testing
        };
        (SyncController as jest.Mock).mockImplementation(() => mockController);

        // Setup Plugin Context (mimicking VoxTrackPlugin)
        pluginContext = {
            player: mockPlayer,
            socket: mockSocket,
            syncController: mockController,
            isRecovering: false,
            retryCount: 0,
            MAX_RETRIES: 3,
            currentChunkIndex: 0,
            textChunks: ["Chunk 1 Text", "This is sentence one. This is sentence two! And three?"],
            audioTimeOffset: 5.0,
            lastProcessedTextIndex: 0,
            chunkScanOffset: 0,
            recoverConnection: async function() {
                if (this.isRecovering) return;
                this.isRecovering = true;
                this.retryCount++;
                
                try {
                    const interruptionTime = this.player.getCurrentTime ? this.player.getCurrentTime() : 0;
                    const lastActiveItem = this.syncController.findActiveMetadata(interruptionTime);

                    const currentText = this.textChunks[this.currentChunkIndex] || '';
                    let restartIndex = 0;
                    
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
                        
                        for (let i = lookbackText.length - 1; i >= 0; i--) {
                            const char = lookbackText[i];
                            if (terminators.test(char)) {
                                lastTerminator = i;
                                break;
                            }
                            if (lastSecondaryTerminator === -1 && secondaryTerminators.test(char)) {
                                lastSecondaryTerminator = i;
                            }
                        }
                        
                        if (lastTerminator !== -1) {
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

                    let relativeStartTime = 0;
                    if (restartIndex > 0) {
                        const restartMetadata = this.syncController.findMetadataByTextOffset(restartIndex, this.currentChunkIndex);
                        if (restartMetadata) {
                            relativeStartTime = restartMetadata.offset / 10000000.0;
                        }
                    }

                    await this.player.restartAt(this.audioTimeOffset + relativeStartTime);
                    this.syncController.removeChunk(this.currentChunkIndex);
                    
                    this.chunkScanOffset = restartIndex;
                    this.lastProcessedTextIndex = restartIndex;

                    await this.socket.connect();

                    if (currentText) {
                        const partialText = currentText.substring(restartIndex).trim();
                        await this.socket.sendSSML(`<ssml>${partialText}</ssml>`, "uuid");
                        this.retryCount = 0;
                    }
                } finally {
                    this.isRecovering = false;
                }
            }
        };
    });

    test('Should truncate text at the nearest sentence boundary on recovery', async () => {
        pluginContext.currentChunkIndex = 1;
        pluginContext.lastProcessedTextIndex = 30; 
        pluginContext.audioTimeOffset = 10.0;
        
        // Mock metadata return for time alignment
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 15000000 }); // 1.5s

        await pluginContext.recoverConnection();

        // Expect restartAt to be audioTimeOffset (10) + relative (1.5) = 11.5
        expect(mockPlayer.restartAt).toHaveBeenCalledWith(11.5);
        
        // restartIndex = 21
        expect(pluginContext.chunkScanOffset).toBe(21);
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(
            expect.stringContaining("This is sentence two! And three?"), 
            expect.any(String)
        );
    });

    test('Should use comma if primary terminator is too far', async () => {
        // Setup long text
        const prefix = "A".repeat(60) + "."; // Index 60 is dot. Length 61.
        const mid = "B".repeat(60) + ",";   // Index 121 is comma. Length 61.
        const suffix = "C".repeat(10);      // Index 131 is end of C.
        // Total text: A...A.B...B,C...C
        // Interrupt at end of C (Index ~132)
        // Distance to dot: 132 - 60 = 72 > 50.
        // Distance to comma: 132 - 121 = 11.
        
        pluginContext.textChunks[0] = prefix + mid + suffix;
        pluginContext.currentChunkIndex = 0;
        pluginContext.lastProcessedTextIndex = 132;
        pluginContext.audioTimeOffset = 0;
        
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 5000000 }); // 0.5s
        
        await pluginContext.recoverConnection();
        
        // Should restart after comma (index 122)
        expect(pluginContext.chunkScanOffset).toBe(122);
        
        // Should restart player at 0.5s
        expect(mockPlayer.restartAt).toHaveBeenCalledWith(0.5);
    });

    test('Should start from beginning of chunk if no boundary found', async () => {
        pluginContext.currentChunkIndex = 1;
        pluginContext.textChunks[1] = "No terminators here just words";
        pluginContext.lastProcessedTextIndex = 10;
        
        await pluginContext.recoverConnection();
        
        expect(pluginContext.chunkScanOffset).toBe(0);
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(
            expect.stringContaining("No terminators here just words"),
            expect.any(String)
        );
    });
});
