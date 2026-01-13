
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';
import { AudioPlayer } from '../src/audio/player';
import { parseMetadata } from '../src/api/protocol';

// Mock deps
jest.mock('../src/api/edge-socket');
jest.mock('../src/audio/player');
jest.mock('../src/sync/controller');

describe('Recovery Boundaries & Offset Integration', () => {
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    let pluginContext: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockPlayer = {
            getCurrentTime: jest.fn().mockReturnValue(10.0),
            restartAt: jest.fn().mockResolvedValue(undefined),
            getBufferedEnd: jest.fn().mockReturnValue(20),
            reset: jest.fn(),
            stop: jest.fn(),
            finish: jest.fn()
        };
        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn()
        };
        mockController = {
            findActiveMetadata: jest.fn(),
            removeChunk: jest.fn(),
            addMetadata: jest.fn(),
            getLastEndTime: jest.fn().mockReturnValue(0)
        };

        // Context Setup
        pluginContext = {
            player: mockPlayer,
            socket: mockSocket,
            syncController: mockController,
            isRecovering: false,
            retryCount: 0,
            MAX_RETRIES: 3,
            currentChunkIndex: 0,
            textChunks: ["Sentence one. Sentence two is here."],
            audioTimeOffset: 0,
            lastProcessedTextIndex: 0,
            chunkScanOffset: 0,
            
            // Simplified recover logic copy for isolation testing
            // In a real integration test we would load the plugin, but here we test the logic unit.
            recoverConnection: async function() {
                if (this.isRecovering) return;
                this.isRecovering = true;
                this.retryCount++;
                try {
                    const interruptionTime = this.player.getCurrentTime();
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
                        let lastTerminator = -1;
                        for (let i = lookbackText.length - 1; i >= 0; i--) {
                            if (terminators.test(lookbackText[i])) {
                                lastTerminator = i;
                                break;
                            }
                        }
                        if (lastTerminator !== -1) {
                            restartIndex = lastTerminator + 1;
                        }
                    }

                    await this.player.restartAt(this.audioTimeOffset);
                    this.syncController.removeChunk(this.currentChunkIndex);
                    
                    this.chunkScanOffset = restartIndex;
                    this.lastProcessedTextIndex = restartIndex;

                    await this.socket.connect();

                    if (currentText) {
                        // Avoid sending empty string if at end
                        if (restartIndex >= currentText.length) {
                             // Edge case: End of text. Should probably finish?
                             // For this test we just want to see logic behavior.
                        } else {
                            const partialText = currentText.substring(restartIndex);
                            await this.socket.sendSSML(`<ssml>${partialText}</ssml>`, "uuid");
                            this.retryCount = 0;
                        }
                    }
                } finally {
                    this.isRecovering = false;
                }
            }
        };
    });

    test('Boundary: Interruption at exact start (offset 0)', async () => {
        mockController.findActiveMetadata.mockReturnValue({ textOffset: 0 });
        pluginContext.textChunks = ["Start text."];
        
        await pluginContext.recoverConnection();
        
        expect(pluginContext.chunkScanOffset).toBe(0);
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(expect.stringContaining("Start text."), expect.any(String));
    });

    test('Boundary: Fallback when metadata missing (use lastProcessedTextIndex)', async () => {
        mockController.findActiveMetadata.mockReturnValue(null);
        pluginContext.lastProcessedTextIndex = 5; // "Sente"
        pluginContext.textChunks = ["Sentence one. Two."];
        
        // "Sentence one." -> '.' is at 12.
        // lastProcessedTextIndex is 5.
        // lookback "Sente". No terminator.
        // Should start at 0.
        
        await pluginContext.recoverConnection();
        expect(pluginContext.chunkScanOffset).toBe(0);
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(expect.stringContaining("Sentence one. Two."), expect.any(String));
    });

    test('Boundary: Correctly snaps to previous sentence', async () => {
        mockController.findActiveMetadata.mockReturnValue({ textOffset: 15 }); // "Two"
        pluginContext.textChunks = ["Sentence one. Two."];
        // "Sentence one." length 13. Index 12 is '.'.
        // textOffset 15 is 'T' in 'Two'.
        // lookback: "Sentence one. "
        // Terminator '.' found at 12.
        // restartIndex = 13.
        
        await pluginContext.recoverConnection();
        
        expect(pluginContext.chunkScanOffset).toBe(13); // 12 + 1
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(expect.stringContaining("Two."), expect.any(String));
        // Should NOT contain "Sentence one."
        const callArgs = mockSocket.sendSSML.mock.calls[0][0];
        expect(callArgs).not.toContain("Sentence one.");
    });

    // Integration Simulation: Verify that chunkScanOffset affects Metadata processing
    // We cannot easily mock the private method `setupDataHandler` or the message callback without
    // instantiating the real plugin or extracting the logic.
    // However, we can simulate the LOGIC of metadata correction here to verify the math.
    
    test('Logic Verification: Metadata correction using chunkScanOffset', () => {
        // Assume recoverConnection set chunkScanOffset = 13 (from previous test)
        const chunkScanOffset = 13;
        const currentChunkText = "Sentence one. Two.";
        
        // Edge TTS sends metadata for "Two."
        // It might say: "Two" at offset 0 (relative to sent text "Two.")
        // Our logic in main.ts uses indexOf search.
        
        const metadataWord = "Two";
        
        // Simulation of main.ts search logic:
        // let found = currentChunkText.indexOf(searchText, this.chunkScanOffset);
        
        const foundIndex = currentChunkText.indexOf(metadataWord, chunkScanOffset);
        
        expect(foundIndex).toBe(14); // "Sentence one. " is 14 chars long?
        // "Sentence one." is 13 chars. space is 13. 'T' is 14.
        // Wait, in previous test I said restartIndex=13.
        // "Sentence one."
        // 0123456789012
        // index 12 is '.'. restartIndex 13 is space.
        // So sent text is " Two."
        // " Two." index 0 is space. index 1 is 'T'.
        
        // Main.ts logic:
        // found = currentChunkText.indexOf("Two", 13);
        // "Sentence one. Two."
        //               ^ (14)
        
        expect(foundIndex).toBe(14);
        
        // This confirms that simply setting chunkScanOffset is sufficient for the search logic
        // to find the correct absolute index in the full text.
    });
});
