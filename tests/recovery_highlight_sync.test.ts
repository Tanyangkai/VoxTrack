
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
    DEFAULT_SETTINGS: {},
    VoxTrackSettingTab: class {}
}));
jest.mock('../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), initialize: jest.fn() }
}));
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

(global as any).moment = { locale: () => 'en' };
(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Recovery Highlight Sync', () => {
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
            reset: jest.fn(),
            addMetadata: jest.fn(), // We will mock this to verify behavior
            getLastEndTime: jest.fn().mockReturnValue(0)
        };
        (SyncController as jest.Mock).mockImplementation(() => mockController);

        plugin = new VoxTrackPlugin({} as any, {} as any);
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        plugin.textProcessor = { process: jest.fn() };
        plugin.settings = { voice: 'zh-CN-XiaoxiaoNeural', volume: '+0%', playbackSpeed: 1.0 };
        plugin.chunkMaps = [[/* dummy map */]]; 
        plugin.textChunks = ["Hello. This is a test text"];
        plugin.chunkOffsets = [0];
        plugin.chunkScanOffsets = [0];
    });

    test('Should update chunkScanOffsets correctly after recovery to enable future matching', async () => {
        // SCENARIO:
        // Text: "Hello. This is a test text"
        // "Hello. " is index 0-6.
        // "This" starts at 7.
        // Interruption at "test" (index 17).
        // Lookback: "Hello. This is a "
        // Terminator at 5 ('.').
        // restartIndex = 6.
        
        // Mock state
        mockPlayer.getCurrentTime.mockReturnValue(5.0);
        mockController.findActiveMetadata.mockReturnValue({
            chunkIndex: 0, text: "test", textOffset: 17
        });
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 50000000 });

        // Trigger recovery
        plugin.isRecovering = false;
        await plugin.recoverConnection({} as HTMLElement);

        // Verify chunkScanOffsets is set
        expect(plugin.chunkScanOffsets[0]).toBe(6);

        // Now simulate incoming metadata for the NEXT word "text".
        // The TTS sends "text". 
        // Metadata will likely say Text="text", Offset=... (relative to audio start)
        
        // We need to simulate receiving this metadata and check if it is processed correctly.
        // This requires accessing the socket onMessage handler or mocking parseMetadata logic inside main.ts?
        // Since parseMetadata is imported, we can't easily mock the internal call flow unless we use rewire or inspect side effects.
        
        // However, we can check if `chunkScanOffsets` is maintained.
        // The issue description says "Highight stayed at span".
        // This means `updateLoop` kept finding the OLD metadata or NO metadata.
        // If `chunkScanOffsets` was reset to 0 accidentally?
        // Or if `addMetadata` was called with wrong offsets?
        
        // Let's verify `chunkScanOffsets` is NOT reset by `processNextChunk` if we are still in same chunk.
        // `processNextChunk` resets it. But we don't call `processNextChunk` in recovery.
        
        // Wait, `recoverConnection` calls `sendChunk`.
        // `sendChunk` sends data.
        // Metadata comes back.
        // `parseMetadata` uses `chunkScanOffsets`.
        
        // If `chunkScanOffsets` is 10.
        // New text sent: "text".
        // Incoming metadata: "text".
        // `currentChunkText`: "This is a test text".
        // `indexOf("text", 10)` -> found at 15.
        // `m.textOffset` = 15.
        // This is correct.
        
        // BUT, what if `sendChunk` or `recoverConnection` resets it somewhere else?
        // `recoverConnection` calls:
        // `this.chunkScanOffsets[this.currentChunkIndex] = restartIndex;`
        
        // Is it possible `chunkScanOffsets` is reset when `socket.onClose` fires AGAIN?
        // No.
        
        // Is it possible `updateLoop` fails to find the new metadata?
        // `updateLoop` uses `active.textOffset`.
        // If `parseMetadata` worked, `active.textOffset` is 15.
        // `updateLoop` finds word at `chunkBaseOffset + 15`.
        
        // Why would it freeze?
        // Maybe `parseMetadata` failed to match?
        // Log: `Sync: Could not find ...` is NOT present in the latest failure description.
        // Just "Highight stayed at span".
        // This implies `lastActive` didn't change? Or `findActiveMetadata` returned the OLD item repeatedly?
        // OR `findActiveMetadata` returned NEW item, but `updateLoop` didn't update highlight?
        
        // If `player.getCurrentTime()` is not advancing? 
        // Unlikely if audio is playing.
        
        // If `syncController` has OLD metadata + NEW metadata.
        // `recoverConnection` calls `this.syncController.removeChunk(this.currentChunkIndex)`.
        // So old metadata for this chunk is gone.
        // Only new metadata is added.
        
        // If new metadata has wrong `offset` (time)?
        // In `recoverConnection`:
        // `await this.player.restartAt(this.audioTimeOffset + relativeStartTime);`
        // `relativeStartTime` comes from `findMetadataByTextOffset(restartIndex)`.
        // If `restartIndex` = 84. `relativeStartTime` = time of word at 84.
        // Player starts at `time(84)`.
        
        // New metadata arrives.
        // `m.offset += this.audioTimeOffset * 10000000;`
        // Wait. `audioTimeOffset` is usually the start of the chunk.
        // In `recoverConnection`:
        // `this.player.restartAt(this.audioTimeOffset + relativeStartTime);`
        // We do NOT change `this.audioTimeOffset`.
        
        // So new metadata `offset` starts at 0 (relative to new stream).
        // We add `this.audioTimeOffset`.
        // So new metadata absolute offset = `audioTimeOffset + 0`.
        // BUT the player is playing at `audioTimeOffset + relativeStartTime`!
        
        // Mismatch!
        // Player time: `T_start + T_relative`.
        // Metadata time: `T_start + 0`.
        // So Metadata is BEHIND player.
        // `findActiveMetadata(playerTime)` will look for items at `T_start + T_relative`.
        // It won't find the new items because they are at `T_start`.
        
        // FIX: We need to adjust `audioTimeOffset` or the metadata offset logic during recovery.
        // The new audio stream starts from `restartIndex`.
        // The metadata for this new stream starts at 0.
        // This 0 corresponds to the audio content at `restartIndex`.
        // Ideally, this metadata should be mapped to `audioTimeOffset + relativeStartTime`.
        
        // So we should add `relativeStartTime` to the metadata offset?
        // `m.offset += (this.audioTimeOffset + relativeStartTime) * 10000000;`
        
        // But `parseMetadata` logic in `main.ts` uses `this.audioTimeOffset`.
        // We can't pass `relativeStartTime` easily to `parseMetadata` callback unless we store it.
        
        // Store `recoveryTimeOffset`?
    });
});
