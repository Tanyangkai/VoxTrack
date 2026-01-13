
import VoxTrackPlugin from '../src/main';
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';
import { TextProcessor } from '../src/text-processor';
import { FileLogger } from '../src/utils/logger';

jest.mock('../src/audio/player');
jest.mock('../src/api/edge-socket');
jest.mock('../src/sync/controller');
jest.mock('../src/text-processor');
jest.mock('../src/utils/editor-utils', () => ({
    getSelectedText: jest.fn(),
    getFullText: jest.fn().mockReturnValue({ text: 'dummy' }),
    getTextFromCursor: jest.fn()
}));
jest.mock('../src/settings/setting-tab', () => ({
    DEFAULT_SETTINGS: { highlightMode: 'word' },
    VoxTrackSettingTab: class {}
}));
jest.mock('../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), initialize: jest.fn() }
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Recovery Offset Bug Repro', () => {
    let plugin: any;
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    let mockEditor: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        
        mockPlayer = {
            restartAt: jest.fn().mockResolvedValue(undefined),
            getCurrentTime: jest.fn().mockReturnValue(0),
            getBufferedEnd: jest.fn().mockReturnValue(0),
            reset: jest.fn(),
            stop: jest.fn(),
            finish: jest.fn(),
            initSource: jest.fn().mockResolvedValue(undefined),
            setPlaybackRate: jest.fn(),
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            onComplete: jest.fn(),
            waitForQueueEmpty: jest.fn().mockResolvedValue(undefined),
            destroy: jest.fn(),
            addChunk: jest.fn()
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
            reset: jest.fn(),
            addMetadata: jest.fn(),
            getLastEndTime: jest.fn().mockReturnValue(0)
        };
        (SyncController as jest.Mock).mockImplementation(() => mockController);

        mockEditor = {
            getValue: jest.fn(),
            getCursor: jest.fn(),
            posToOffset: jest.fn(),
            cm: { dispatch: jest.fn() }
        };

        const mockApp = { workspace: { getActiveViewOfType: jest.fn(), on: jest.fn() } };

        plugin = new VoxTrackPlugin(mockApp as any, {} as any);
        plugin.loadData = jest.fn().mockResolvedValue({});
        plugin.saveData = jest.fn().mockResolvedValue({});
        plugin.applyHighlightColor = jest.fn();
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        plugin.textProcessor = { process: jest.fn() };
        
        plugin.settings = { 
            voice: 'en-US-JennyNeural', 
            volume: '+0%', 
            playbackSpeed: 1.0,
            highlightMode: 'word',
            autoScrollMode: 'off'
        };
        
        // Mock UI
        plugin.addStatusBarItem = jest.fn().mockReturnValue({
            createSpan: jest.fn().mockReturnValue({ addClass: jest.fn(), setText: jest.fn(), setAttribute: jest.fn() }),
            addClass: jest.fn()
        });
        plugin.registerEditorExtension = jest.fn();
        plugin.addSettingTab = jest.fn();
        plugin.addRibbonIcon = jest.fn();
        plugin.addCommand = jest.fn();
        plugin.registerEvent = jest.fn();

        await plugin.onload();
        plugin.player = mockPlayer; // Ensure instance is same
    });

    test('Repro: Recovery with relativeStartTime adds up incorrectly', async () => {
        // Setup state to simulate the bug
        // "interruptionTime": 50.986
        // "restartIndex": 0
        // "relativeStartTime": 0
        
        // Let's assume we are in Chunk 0.
        // Chunk 0 starts at 0.
        // Audio interruption at 50s.
        // Restart at 0 (beginning of chunk).
        
        plugin.currentChunkIndex = 0;
        plugin.audioTimeOffset = 0; // Chunk 0 base time
        plugin.textChunks = ["Some text content here."];
        plugin.chunkOffsets = [0];
        plugin.chunkMaps = [[0, 1, 2, 3]];
        
        mockPlayer.getCurrentTime.mockReturnValue(50.986);
        
        // Mock finding metadata
        mockController.findActiveMetadata.mockReturnValue({
            text: "content",
            textOffset: 10,
            chunkIndex: 0
        });
        
        // Mock restart calculation (simplified from log: restartIndex=0)
        // Last processed text index = 10
        plugin.lastProcessedTextIndex = 10;
        
        // Force restartIndex to 0 by mocking finding no terminators or close enough
        // Actually, if restartIndex is 0, findMetadataByTextOffset should return offset 0.
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 0 }); // 0s
        
        // Call recover
        plugin.isRecovering = false;
        await plugin.recoverConnection({} as HTMLElement);
        
        // Check audioTimeOffset
        // `recoverConnection` calculates `relativeStartTime` (which is 0 here)
        // It calls `player.restartAt(this.audioTimeOffset + relativeStartTime)`
        // `this.audioTimeOffset` is 0. `relativeStartTime` is 0.
        // So player restarts at 0.
        expect(mockPlayer.restartAt).toHaveBeenCalledWith(0);
        
        // NOW, simulate NEXT chunk transition or next recovery.
        // The issue description says: "当中断后,又重新朗读...高亮调到别处".
        // If recovery successful, player plays from 0.
        
        // New metadata arrives.
        // `m.offset += (this.audioTimeOffset + this.recoveryTimeOffset) * 10000000;`
        // `recoveryTimeOffset` is stored in plugin.
        
        // In this case (restartIndex=0), recoveryTimeOffset = 0.
        // Metadata offset (from 0) + 0 + 0 = Correct absolute offset.
        
        // BUT consider the SECOND log entry:
        // "interruptionTime": 1099.189
        // "restartIndex": 123
        // "relativeStartTime": 1086.9245
        
        // Let's simulate THIS scenario.
        // Chunk N.
        // `audioTimeOffset` = ? (Chunk start time). 
        // Let's say Chunk N starts at 1080s.
        plugin.audioTimeOffset = 1080; 
        plugin.currentChunkIndex = 40;
        plugin.textChunks[40] = "Long text content... " + "X".repeat(200);
        
        mockPlayer.getCurrentTime.mockReturnValue(1099.189);
        mockController.findActiveMetadata.mockReturnValue({
            text: "Current",
            textOffset: 188,
            chunkIndex: 40
        });
        
        // restartIndex = 123.
        // Metadata at 123 has offset relative to chunk start? No, metadata offset is ABSOLUTE (from session start).
        // Wait, `findMetadataByTextOffset` returns item from `syncController`.
        // `syncController` stores ABSOLUTE offsets.
        // So `item.offset` is e.g. (1080 + 6.9245) * 10^7 = 10869245000.
        
        // `relativeStartTime = restartMetadata.offset / 10000000.0`.
        // This calculates the ABSOLUTE time of the restart point.
        // relativeStartTime = 1086.9245.
        
        mockController.findMetadataByTextOffset.mockReturnValue({
            offset: 10869245000 // 1086.9245s
        });
        
        await plugin.recoverConnection({} as HTMLElement);
        
        // Check restartAt
        // Code: `await this.player.restartAt(this.audioTimeOffset + this.recoveryTimeOffset);`
        // `this.audioTimeOffset` = 1080.
        // `this.recoveryTimeOffset` = 1086.9245.
        // Sum = 2166.9245.
        
        // ERROR!
        // `restartAt` expects absolute timeline time.
        // We are adding `Chunk Start Time` + `Absolute Restart Time`.
        // This is DOUBLE COUNTING the chunk start time!
        
        // `relativeStartTime` calculated in `recoverConnection` is actually ABSOLUTE time if it comes from metadata.
        
        // Let's verify `findMetadataByTextOffset` return value source.
        // It returns `AudioMetadata` objects stored in `SyncController`.
        // `SyncController` adds metadata via `addMetadata`.
        // In `setupDataHandler`:
        // `m.offset += (this.audioTimeOffset + this.recoveryTimeOffset) * 10000000;`
        // So stored metadata IS absolute.
        
        // So `restartMetadata.offset` IS absolute time (e.g. 1086s).
        // `relativeStartTime` variable name is misleading, it holds 1086s.
        
        // Then `player.restartAt(this.audioTimeOffset + relativeStartTime)`
        // `1080 + 1086 = 2166`.
        // Player seeks to 2166s.
        // But the audio segment (Chunk 40) is only valid around 1080s.
        // Player buffers new data starting from 0 (relative to new request).
        // `player.ts`: `this.sourceBuffer.timestampOffset = time;`
        // We set timestamp offset to 2166s.
        // So new audio plays at 2166s.
        
        // But metadata for NEW stream comes in starting at 0.
        // `setupDataHandler`:
        // `m.offset += (this.audioTimeOffset + this.recoveryTimeOffset) * 10000000;`
        // `audioTimeOffset` is still 1080.
        // `recoveryTimeOffset` is 1086.
        // New metadata offset = 0 + 1080 + 1086 = 2166.
        
        // So Audio and Metadata are BOTH shifted to 2166s.
        // They are synced with EACH OTHER.
        
        // BUT!
        // `currentDocOffset` logic?
        // `findActiveMetadata` searches using `player.getCurrentTime()`.
        // Player is at 2166s.
        // Metadata is at 2166s.
        // So `findActiveMetadata` finds the metadata.
        // `active.text` is correct.
        
        // So why "高亮调到别处"?
        // Maybe because `audioTimeOffset` logic for NEXT chunk is broken?
        // Or because we jumped far ahead in timeline (2166s), but we are conceptually still at 1086s?
        // Does this unbounded growth cause issues?
        // If we recover 10 times, time doubles each time?
        // 1000 -> 2000 -> 4000...
        
        // But more importantly:
        // `findMetadataByTextOffset` finds the OLD metadata.
        // `recoverConnection` REMOVES the old metadata: `this.syncController.removeChunk(this.currentChunkIndex);`
        // But it calculates `relativeStartTime` BEFORE removing.
        
        // The issue is definitely the double addition.
        // `restartMetadata.offset` is ALREADY absolute (1086).
        // We add `audioTimeOffset` (1080).
        // We get 2166.
        
        // We should just use `restartMetadata.offset` as the restart time?
        // `this.recoveryTimeOffset = restartMetadata.offset / 10000000.0;`
        // Then `player.restartAt(this.recoveryTimeOffset)`.
        
        // Wait, `player.restartAt(time)` sets `timestampOffset = time`.
        // If we set `timestampOffset = 1086`.
        // New audio (which starts from "restartIndex") will be placed at 1086s.
        // This matches the original timeline!
        // This is what we want! We want to "overwrite" the old timeline or resume where we left off.
        
        // If we use 2166, we are creating a "phantom" timeline far in the future.
        // Although it's self-consistent, it's messy.
        
        // AND!
        // `setupDataHandler` adds `this.audioTimeOffset`.
        // `m.offset += (this.audioTimeOffset + this.recoveryTimeOffset) ...`
        // If `recoveryTimeOffset` is 1086 (absolute).
        // And `audioTimeOffset` is 1080.
        // New metadata (starts at 0) becomes 0 + 1080 + 1086 = 2166.
        
        // So we are indeed shifting everything to 2166.
        
        // Is this shift harmful?
        // If we have subsequent chunks (Chunk 41).
        // Chunk 41's `audioTimeOffset` will be calculated based on `bufferedEnd` or `lastMetadataEnd`.
        // If `lastMetadataEnd` is now ~2200.
        // Chunk 41 will start at 2200.
        
        // It seems consistent but weirdly inflated.
        
        // BUT wait!
        // `restartIndex` is 123.
        // The NEW audio starts from text index 123.
        // The OLD audio (which we are replacing) started from text index 0 (of the chunk).
        // The time 1086 corresponds to text index 123.
        
        // If we want to maintain the ORIGINAL timeline (so Chunk 41 still starts where it was supposed to):
        // We should place the new audio at 1086.
        // `timestampOffset` = 1086.
        
        // For metadata:
        // New metadata starts at 0 (relative to new audio).
        // We want it to be 1086.
        // So we need to add 1086.
        
        // Current logic:
        // `m.offset += (this.audioTimeOffset + this.recoveryTimeOffset)`
        // `1080 + 1086 = 2166`.
        // Wrong.
        
        // We want `1080 + X = 1086`.
        // X should be `1086 - 1080` = 6.9245 (The relative offset within the chunk).
        
        // So `recoveryTimeOffset` should be RELATIVE to chunk start.
        // But `findMetadataByTextOffset` returns ABSOLUTE offset.
        
        // FIX:
        // `relativeStartTime = restartMetadata.offset - (this.audioTimeOffset * 10000000);`
        // Then `relativeStartTime` is 6.9245s.
        
        // Then `player.restartAt(this.audioTimeOffset + relativeStartTime)`
        // `1080 + 6.92 = 1086.92`. Correct absolute time.
        
        // Then metadata:
        // `m.offset += 1080 + 6.92`.
        // `0 + 1086.92 = 1086.92`. Correct absolute time.
        
        // With fix:
        // relativeStartTime = (1086.9245 - 1080) = 6.9245
        // restartAt(1080 + 6.9245) = 1086.9245
        
        expect(mockPlayer.restartAt).toHaveBeenLastCalledWith(1086.9245);
    });
});
