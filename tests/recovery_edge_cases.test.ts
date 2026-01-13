
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

describe('Recovery Chunk Sync - Edge Cases', () => {
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
            findClosestMetadata: jest.fn(), // We will add this
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
        
        // Setup state for multi-chunk scenario
        plugin.textChunks = [
            "Chunk 0 Text",
            "Chunk 1 Text"
        ];
        plugin.chunkScanOffsets = [0, 0];
        plugin.currentChunkIndex = 1; // Simulate logic thinks we are at Chunk 1
        plugin.lastProcessedTextIndex = 0; // Reset by processNextChunk
        plugin.chunkOffsets = [0, 100];
    });

    test('Should recover correctly when interruption happens during silence (No Active Metadata)', async () => {
        // SCENARIO:
        // Chunk 0 is playing. Time = 50s.
        // Chunk 1 is pre-fetched. currentChunkIndex = 1.
        // Interruption happens during a pause/silence in Chunk 0.
        // findActiveMetadata returns NULL because no word is "active" at exactly 50s.
        
        mockPlayer.getCurrentTime.mockReturnValue(50.0);
        
        // 1. findActiveMetadata returns null (Silence)
        mockController.findActiveMetadata.mockReturnValue(null);

        // 2. We expect the logic to fallback to findClosestMetadata
        // Let's assume there was a word at 45s ending at 46s in Chunk 0.
        mockController.findClosestMetadata.mockReturnValue({
            chunkIndex: 0,
            text: "PreviousWord",
            textOffset: 40,
            offset: 45000000,
            duration: 10000000
        });

        mockController.findMetadataByTextOffset.mockReturnValue({
            offset: 40000000 // 4s
        });

        // Trigger recovery
        plugin.isRecovering = false;
        await plugin.recoverConnection({} as HTMLElement);

        // ASSERTIONS
        
        // 1. Should have reverted currentChunkIndex to 0 (based on closest metadata)
        expect(plugin.currentChunkIndex).toBe(0);
        
        // 2. Should send text from Chunk 0
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(
            expect.stringContaining("Chunk 0 Text"),
            expect.any(String)
        );
        
        // 3. Should NOT send Chunk 1
        expect(mockSocket.sendSSML).not.toHaveBeenCalledWith(
            expect.stringContaining("Chunk 1 Text"),
            expect.any(String)
        );
    });
});
