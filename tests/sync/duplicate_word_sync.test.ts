
import VoxTrackPlugin from '../../src/main';
import { AudioPlayer } from '../../src/audio/player';
import { EdgeSocket } from '../../src/api/edge-socket';
import { TextProcessor } from '../../src/text-processor';
import { FileLogger } from '../../src/utils/logger';

// Mock dependencies
jest.mock('../../src/audio/player');
jest.mock('../../src/api/edge-socket');
jest.mock('../../src/text-processor');
jest.mock('../../src/utils/editor-utils', () => ({
    getSelectedText: jest.fn().mockReturnValue(null),
    getFullText: jest.fn().mockReturnValue({ text: '生不如死。生不如死。' }),
    getTextFromCursor: jest.fn().mockReturnValue(null)
}));
jest.mock('../../src/settings/setting-tab', () => ({
    DEFAULT_SETTINGS: { playbackSpeed: 1.0, voice: 'zh-CN-XiaoxiaoNeural' },
    VoxTrackSettingTab: class {}
}));
jest.mock('../../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn(), initialize: jest.fn() }
}));

// Mock global moment and requestAnimationFrame
(global as any).moment = { locale: () => 'en' };
(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Duplicate Word Sync Across Chunks', () => {
    let plugin: VoxTrackPlugin;
    let mockPlayer: any;
    let mockSocket: any;
    let mockProcessor: any;
    let messageCallback: (data: any) => void;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        mockPlayer = {
            initSource: jest.fn().mockResolvedValue(undefined),
            reset: jest.fn(),
            setPlaybackRate: jest.fn(),
            stop: jest.fn(),
            addChunk: jest.fn(),
            getCurrentTime: jest.fn().mockReturnValue(0),
            play: jest.fn().mockResolvedValue(undefined),
            waitForQueueEmpty: jest.fn().mockResolvedValue(undefined),
            getBufferedEnd: jest.fn().mockReturnValue(0)
        };
        (AudioPlayer as jest.Mock).mockImplementation(() => mockPlayer);

        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn((cb) => { messageCallback = cb; }),
            onClose: jest.fn()
        };
        (EdgeSocket as jest.Mock).mockImplementation(() => mockSocket);

        mockProcessor = {
            process: jest.fn().mockReturnValue([
                { text: '生不如死。', map: [0, 1, 2, 3, 4] },
                { text: '生不如死。', map: [5, 6, 7, 8, 9] }
            ])
        };
        (TextProcessor as jest.Mock).mockImplementation(() => mockProcessor);

        plugin = new VoxTrackPlugin({
            workspace: { getActiveViewOfType: () => null } 
        } as any, {} as any);
        
        (plugin as any).settings = { playbackSpeed: 1.0, voice: 'zh-CN-XiaoxiaoNeural' };
        (plugin as any).player = mockPlayer;
        (plugin as any).socket = mockSocket;
        (plugin as any).textProcessor = mockProcessor;
        (plugin as any).syncController = { 
            addMetadata: jest.fn(), 
            reset: jest.fn(), 
            getLastEndTime: () => 0 
        };
    });

    test('Should correctly attribute metadata using X-RequestId even if receivingChunkIndex has advanced', async () => {
        const mockEditor = { getCursor: jest.fn(), posToOffset: jest.fn(), getValue: () => '生不如死。生不如死。' };
        const mockStatusBar = {} as HTMLElement;
        
        const requestId0 = "a1b2c3d4e5f600000000000000000000";
        const requestId1 = "f6e5d4c3b2a111111111111111111111";

        // Mock UUID calls:
        // 1. sessionId in setupDataHandler (via togglePlay)
        // 2. requestId for Chunk 0
        // 3. requestId for Chunk 1
        const uuidSpy = jest.spyOn(require('uuid'), 'v4');
        uuidSpy.mockReturnValueOnce("session-id-uuid")
               .mockReturnValueOnce("a1b2c3d4-e5f6-0000-0000-000000000000")
               .mockReturnValueOnce("f6e5d4c3-b2a1-1111-1111-111111111111");

        // Start playback
        await (plugin as any).togglePlay(mockEditor, 'auto', mockStatusBar);

        // 1. Capture the RequestId for Chunk 0
        expect(mockSocket.sendSSML).toHaveBeenCalledTimes(1);
        const capturedId0 = mockSocket.sendSSML.mock.calls[0][1];

        // 2. Simulate end of Chunk 0, advancing receivingChunkIndex to 1
        messageCallback(`Path:turn.end\r\n\r\n`);
        await new Promise(r => setTimeout(r, 10));

        expect((plugin as any).receivingChunkIndex).toBe(1);
        
        // 3. Capture RequestId for Chunk 1
        expect(mockSocket.sendSSML).toHaveBeenCalledTimes(2);
        const capturedId1 = mockSocket.sendSSML.mock.calls[1][1];

        // 4. Simulate a DELAYED metadata for Chunk 0 arriving NOW
        const metadata0 = {
            Metadata: [{
                Type: "WordBoundary",
                Data: { text: { Text: "生不如死" }, Offset: 0, Duration: 1000 }
            }]
        };
        const metadataMsg0 = `X-RequestId:${capturedId0}\r\nPath:audio.metadata\r\n\r\n${JSON.stringify(metadata0)}`;
        messageCallback(metadataMsg0);

        // Wait for async handler
        await new Promise(r => setTimeout(r, 50));

        // 5. Verify metadata 0 was attributed to Chunk 0, not Chunk 1
        const addMetadataMock = (plugin as any).syncController.addMetadata;
        if (addMetadataMock.mock.calls.length === 0) {
            console.log("addMetadata was not called!");
        }
        expect(addMetadataMock).toHaveBeenCalled();
        const firstCallMetadata = addMetadataMock.mock.calls[0][0];
        expect(firstCallMetadata[0].chunkIndex).toBe(0); // CRITICAL: Should be 0
        expect(firstCallMetadata[0].text).toBe("生不如死");

        // 6. Simulate metadata for Chunk 1
        const metadata1 = {
            Metadata: [{
                Type: "WordBoundary",
                Data: { text: { Text: "生不如死" }, Offset: 0, Duration: 1000 }
            }]
        };
        const metadataMsg1 = `X-RequestId:${requestId1}\r\nPath:audio.metadata\r\n\r\n${JSON.stringify(metadata1)}`;
        messageCallback(metadataMsg1);
        await new Promise(r => setTimeout(r, 50));

        // 7. Verify metadata 1 was attributed to Chunk 1
        const secondCallMetadata = addMetadataMock.mock.calls[1][0];
        expect(secondCallMetadata[0].chunkIndex).toBe(1);
    });
});
