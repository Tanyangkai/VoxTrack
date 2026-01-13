
import VoxTrackPlugin from '../../src/main';
import { AudioPlayer } from '../../src/audio/player';
import { EdgeSocket } from '../../src/api/edge-socket';
import { SyncController } from '../../src/sync/controller';
import { TextProcessor } from '../../src/text-processor';
import { FileLogger } from '../../src/utils/logger';

jest.mock('../../src/audio/player');
jest.mock('../../src/api/edge-socket');
jest.mock('../../src/sync/controller');
jest.mock('../../src/text-processor');
jest.mock('../../src/utils/editor-utils', () => ({
    getSelectedText: jest.fn(),
    getFullText: jest.fn().mockReturnValue({ text: 'dummy' }),
    getTextFromCursor: jest.fn()
}));
jest.mock('../../src/settings/setting-tab', () => ({
    DEFAULT_SETTINGS: {},
    VoxTrackSettingTab: class {}
}));
jest.mock('../../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), initialize: jest.fn() }
}));
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

(global as any).moment = { locale: () => 'en' };
(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Sync Mismatch on Recovery', () => {
    let plugin: any;
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockPlayer = {
            restartAt: jest.fn().mockResolvedValue(undefined),
            getCurrentTime: jest.fn().mockReturnValue(100),
            getBufferedEnd: jest.fn().mockReturnValue(100),
            reset: jest.fn(),
            stop: jest.fn(),
            finish: jest.fn(),
            initSource: jest.fn().mockResolvedValue(undefined),
            setPlaybackRate: jest.fn(),
            play: jest.fn().mockResolvedValue(undefined)
        };
        (AudioPlayer as jest.Mock).mockImplementation(() => mockPlayer);

        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn(),
            onClose: jest.fn()
        };
        (EdgeSocket as jest.Mock).mockImplementation(() => mockSocket);

        mockController = {
            findActiveMetadata: jest.fn(),
            findMetadataByTextOffset: jest.fn(),
            findClosestMetadata: jest.fn(),
            removeChunk: jest.fn(),
            reset: jest.fn()
        };
        (SyncController as jest.Mock).mockImplementation(() => mockController);

        plugin = new VoxTrackPlugin({} as any, {} as any);
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        plugin.textProcessor = { process: jest.fn() };
        plugin.settings = { voice: 'zh-CN-XiaoxiaoNeural', volume: '+0%', playbackSpeed: 1.0 };
        
        // Setup state mimicking the log failure
        // We are recovering, but sync fails immediately after.
        // This suggests chunkOffsets or map might be wrong or reset incorrectly.
        plugin.textChunks = ["Chunk 0", "Chunk 1", "Chunk 2", "Chunk 3", "Chunk 4"];
        plugin.chunkScanOffsets = [0, 0, 0, 0, 0];
        plugin.currentChunkIndex = 4; 
        plugin.chunkOffsets = [0, 100, 200, 300, 247430]; // Chunk 4 starts at 247430
        plugin.chunkMaps = [[], [], [], [], [0, 1, 2, 3]]; // Dummy map for chunk 4
    });

    test('Should correct scan offset and allow sync after recovery', async () => {
        // SCENARIO:
        // Recovery happened at index ~247714 (based on log).
        // This is inside Chunk 4.
        // Recovery logic sets restartIndex.
        // Does it update chunkScanOffsets correctly?
        
        // Mock interruption state
        mockPlayer.getCurrentTime.mockReturnValue(50.0);
        mockController.findActiveMetadata.mockReturnValue({
            chunkIndex: 4,
            text: "InterruptedWord",
            textOffset: 100 // index in Chunk 4 processed text
        });
        
        // Mock lookup for restart
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 40000000 });

        // Trigger recovery
        plugin.isRecovering = false;
        await plugin.recoverConnection({} as HTMLElement);

        // ASSERTIONS
        
        // 1. currentChunkIndex should remain 4
        expect(plugin.currentChunkIndex).toBe(4);
        
        // 2. chunkScanOffsets[4] should be reset to restartIndex (e.g. 0 or close to 100)
        // Log says restartIndex: 86.
        // Logic: chunkScanOffsets[this.currentChunkIndex] = restartIndex;
        // restartIndex depends on lookback. Assume lookback found terminator at 0.
        // Then chunkScanOffsets[4] should be 0 (or whatever restartIndex is).
        
        // Wait, if restartIndex is 0 (or small), but we are in middle of chunk...
        // The problem in logs is "Sync: Could not find ...".
        // This implies `findWordIndexInDoc` failed or map lookup failed.
        
        // Check if `chunkScanOffsets` was updated.
        // In the code: `this.chunkScanOffsets[this.currentChunkIndex] = restartIndex;`
        // restartIndex is derived from `lastActiveItem.textOffset` (100).
        
        // If restartIndex is set, say to 100.
        // Then `sendChunk` sends text starting from 100.
        // Incoming metadata for this new stream will have `text` relative to this partial text?
        // NO. Edge TTS returns metadata for the text YOU SENT.
        // So if you send partial text, metadata starts from 0 (relative to that partial text).
        
        // BUT `chunkScanOffsets` is used to match metadata text against `this.textChunks[index]`.
        // `this.textChunks[index]` is the FULL chunk text.
        // Incoming metadata text: "Hello" (from partial stream).
        // Code: `currentChunkText.indexOf(searchText, scanOffset)`
        // `currentChunkText` is FULL text.
        // `scanOffset` is `chunkScanOffsets[targetChunkIndex]`.
        
        // If we set `chunkScanOffsets` to `restartIndex` (e.g. 100), 
        // AND incoming metadata corresponds to the text starting at 100...
        // Then `indexOf` should find the text at 100+.
        
        // So where is the mismatch?
        // Maybe `restartIndex` calculation is wrong? 
        // Or `chunkScanOffsets` isn't persisting?
        
        // Let's verify `chunkScanOffsets` is set.
        // In the actual code `restartIndex` logic:
        // `scanStart` = 100.
        // `lookbackText` = substring(0, 100).
        // Find terminator. Say none. `restartIndex` = 0.
        // `chunkScanOffsets[4]` = 0.
        
        // If `restartIndex` is 0, we re-read from start. Sync should work.
        
        // In the log: `restartIndex: 86`. `scanStart: 118`.
        // `chunkScanOffsets` should be 86.
        
        // The logs show:
        // `Sync: Could not find "我们"` with `currentDocOffset: 247429`. `chunkActualStart: 247430`.
        // `247429` < `247430`.
        // `currentDocOffset` is reset to `baseOffset` (which is `chunkOffsets[0] = 0` in logs?)
        // No, `chunkBase` in log is 0.
        // `Data: {"currentDocOffset":247429,"chunkBase":0,"chunkActualStart":247430,"searchWindow":500}`
        
        // WAIT. `chunkBase` is 0?
        // `const chunkBaseOffset = this.chunkOffsets[mapIndex] || 0;`
        // If `chunkIndex` is 4, `chunkOffsets[4]` should be `247430`?
        // Why is `chunkBase` 0 in the log?
        // Because `this.chunkOffsets` might be empty or wrong?
        
        // If `chunkOffsets` is lost/cleared?
        // `recoverConnection` calls `this.syncController.removeChunk(this.currentChunkIndex)`.
        // It does NOT clear `this.chunkOffsets`.
        
        // BUT `togglePlay` clears `this.chunkOffsets`.
        // `recoverConnection` does NOT call `togglePlay`.
        
        // Why is `chunkBase: 0` in log?
        // `const chunkBaseOffset = this.chunkOffsets[mapIndex] || 0;`
        // This implies `this.chunkOffsets[4]` is undefined or 0.
        
        // IF `this.chunkOffsets` is correct, sync should work.
        // I suspect `chunkIndex` in metadata might be wrong? 
        // In logs: `chunk: 4` is present in mismatch log.
        
        // If `chunkIndex` is 4, and `chunkOffsets[4]` is missing...
        // `chunkOffsets` is populated in `togglePlay`.
        // Is it possible `chunkOffsets` array is sparse?
        // `this.chunkOffsets.push(baseDocOffset)` inside loop.
        // It should be populated.
        
        // UNLESS `recoverConnection` does something that affects `chunkOffsets`?
        // No.
        
        // Wait, `processNextChunk`.
        // `this.baseOffset = this.chunkOffsets[this.currentChunkIndex] || 0;`
        
        // In the failing log:
        // `Sync: Could not find "我们" | Data: {..., "chunkBase":0, "chunkActualStart":247430, ...}`
        // `chunkActualStart` = `chunkBaseOffset + firstCharOffset`.
        // If `chunkBase` is 0, and `chunkActualStart` is `247430`...
        // Then `firstCharOffset` must be `247430`.
        // This means the map `chunkMaps[4]` contains `247430`.
        // If `chunkMaps` stores relative offsets from `chunkBaseOffset`...
        // Then `firstCharOffset` should be small (0, 1, 2...).
        // If `chunkMaps` stores absolute offsets (doc based)?
        // Let's check `textProcessor` and `togglePlay`.
        
        /* 
        main.ts:
        // Slice chunks based on cursorTargetOffset
        // ...
        const map = chunk.map.slice(sliceIndex);
        this.chunkMaps.push(map);
        this.chunkOffsets.push(baseDocOffset);
        */
        
        // `textProcessor` returns `ProcessedChunk` with `map`.
        // `map` usually contains indices relative to the input text of `process`.
        // `process` takes `processingText`.
        // `processingText` is either selection or full text.
        // If full text, indices are absolute doc offsets.
        
        // So `chunkMaps` contains ABSOLUTE offsets.
        // And `chunkOffsets` contains `baseDocOffset`.
        // If `processingText` is full text, `baseDocOffset` is 0.
        // So `chunkOffsets` is `[0, 0, 0, 0, 0]`.
        
        // So `chunkBaseOffset` is indeed 0.
        // `chunkActualStart` = 0 + 247430 = 247430. This is correct.
        // `currentDocOffset` = 247429.
        // `searchWindow` = 500.
        // `findWordIndexInDoc` searches from `currentDocOffset` (247429).
        // `wordToFind` is "我们".
        // It fails.
        
        // Why?
        // Maybe "我们" is not at 247430?
        // Maybe it's at 247420? (Backwards?)
        // `findWordIndexInDoc` only searches forward?
        
        // Let's check `findWordIndexInDoc`.
    });
});
