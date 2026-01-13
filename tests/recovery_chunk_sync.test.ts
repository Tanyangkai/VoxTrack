
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
jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

(global as any).moment = { locale: () => 'en' };
(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Recovery Chunk Sync', () => {
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
        plugin.currentChunkIndex = 1; // Simulate logic thinks we are at Chunk 1 (maybe pre-fetching?)
        plugin.chunkOffsets = [0, 100];
    });

    test('Should recover using chunk from LAST ACTIVE metadata, not currentChunkIndex', async () => {
        // SCENARIO:
        // We are playing Chunk 0. Time is 50s.
        // But currentChunkIndex has advanced to 1 (because Chunk 0 download finished and we started Chunk 1).
        // Interruption happens.
        
        // Mock player time
        mockPlayer.getCurrentTime.mockReturnValue(50.0);
        
        // Mock metadata says we are in Chunk 0
        mockController.findActiveMetadata.mockReturnValue({
            chunkIndex: 0,
            text: "Text",
            textOffset: 5
        });

        // Mock metadata for restart calculation
        mockController.findMetadataByTextOffset.mockReturnValue({
            offset: 40000000 // 4s
        });

        // Trigger recovery
        plugin.isRecovering = false;
        await plugin.recoverConnection({} as HTMLElement);

        // ASSERTIONS
        
        // Debug: Check for errors
        if ((FileLogger.error as jest.Mock).mock.calls.length > 0) {
            console.log("FileLogger Error:", JSON.stringify((FileLogger.error as jest.Mock).mock.calls));
        }

        // 1. Should have reverted currentChunkIndex to 0
        expect(plugin.currentChunkIndex).toBe(0);
        
        // 2. Should send text from Chunk 0
        expect(mockSocket.sendSSML).toHaveBeenCalledWith(
            expect.stringContaining("Chunk 0 Text"), // Or substring of it
            expect.any(String)
        );
        
        // 3. Should NOT send Chunk 1
        expect(mockSocket.sendSSML).not.toHaveBeenCalledWith(
            expect.stringContaining("Chunk 1 Text"),
            expect.any(String)
        );
    });

    test('Should reset receivingChunkIndex to match recovered chunk', async () => {
        // SCENARIO:
        // Playback at Chunk 0.
        // Pre-fetch finished Chunk 0, started Chunk 1.
        // receivingChunkIndex = 1 (or 2 if finished).
        // Interruption. Recover Chunk 0.
        
        mockPlayer.getCurrentTime.mockReturnValue(50.0);
        mockController.findActiveMetadata.mockReturnValue({
            chunkIndex: 0,
            text: "Text",
            textOffset: 5
        });
        mockController.findMetadataByTextOffset.mockReturnValue({ offset: 40000000 });

        // Simulate advanced receiving index
        plugin.receivingChunkIndex = 1;

        await plugin.recoverConnection({} as HTMLElement);

        // Expect receivingChunkIndex to be reverted to 0
        expect(plugin.receivingChunkIndex).toBe(0);
        
        // Expect request map to map new request to 0
        const calls = mockSocket.sendSSML.mock.calls;
        const lastCall = calls[calls.length - 1];
        const requestId = lastCall[1];
        
        expect(plugin.requestToChunkMap.get(requestId)).toBe(0);
    });
});
