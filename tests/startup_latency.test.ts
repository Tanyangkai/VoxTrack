
import VoxTrackPlugin from '../src/main';
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { TextProcessor } from '../src/text-processor';
import { FileLogger } from '../src/utils/logger';

// Mock dependencies
jest.mock('../src/audio/player');
jest.mock('../src/api/edge-socket');
jest.mock('../src/text-processor');
jest.mock('../src/utils/editor-utils', () => ({
    getSelectedText: jest.fn().mockReturnValue(null),
    getFullText: jest.fn().mockReturnValue({ text: 'Some text to read' }),
    getTextFromCursor: jest.fn().mockReturnValue(null)
}));
// Mock settings tab to avoid import issues if any
jest.mock('../src/settings/setting-tab', () => ({
    DEFAULT_SETTINGS: {},
    VoxTrackSettingTab: class {}
}));
// Mock logger
jest.mock('../src/utils/logger', () => ({
    FileLogger: { debug: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

// Mock global moment
(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Startup Latency / Deadlock Prevention', () => {
    let plugin: VoxTrackPlugin;
    let mockPlayer: any;
    let mockSocket: any;
    let mockProcessor: any;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup Player Mock
        mockPlayer = {
            initSource: jest.fn().mockResolvedValue(undefined),
            reset: jest.fn(),
            setPlaybackRate: jest.fn(),
            stop: jest.fn(),
            addChunk: jest.fn(),
            getCurrentTime: jest.fn().mockReturnValue(0),
            // Default play behavior: resolve immediately
            play: jest.fn().mockResolvedValue(undefined) 
        };
        (AudioPlayer as jest.Mock).mockImplementation(() => mockPlayer);

        // Setup Socket Mock
        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn(),
            onClose: jest.fn()
        };
        (EdgeSocket as jest.Mock).mockImplementation(() => mockSocket);

        // Setup Processor Mock
        mockProcessor = {
            process: jest.fn().mockReturnValue([
                { text: 'Some text to read', map: [0, 1, 2, 3, 4] }
            ])
        };
        (TextProcessor as jest.Mock).mockImplementation(() => mockProcessor);

        // Instantiate Plugin (with mocked App and Manifest)
        plugin = new VoxTrackPlugin({} as any, {} as any);
        
        // Manually trigger onload/loadSettings if needed, or just set settings directly
        (plugin as any).settings = {
             playbackSpeed: 1.0,
             voice: 'zh-CN-XiaoxiaoNeural'
        };
        (plugin as any).player = mockPlayer;
        (plugin as any).socket = mockSocket;
        (plugin as any).textProcessor = mockProcessor;
        
        // Initialize other required properties that might be used in togglePlay
        (plugin as any).textChunks = [];
        (plugin as any).chunkOffsets = [];
        (plugin as any).chunkMaps = [];
        (plugin as any).sessionManager = { startNewSession: jest.fn(), isValid: jest.fn().mockReturnValue(true), clear: jest.fn() };
        (plugin as any).syncController = { reset: jest.fn() };
    });

    test('Should send data even if player.play() hangs (Deadlock Fix)', async () => {
        // ARRANGE
        // Simulate "Hanging" play: returns a promise that never resolves within test timeframe
        // or effectively takes forever. We can simulate this by returning a Promise that resolves after a long delay,
        // or we can just verify that sendChunk is called BEFORE play resolves.
        
        let playResolve: Function;
        const playPromise = new Promise(r => { playResolve = r; });
        mockPlayer.play.mockReturnValue(playPromise);

        // Use fake timers to control async flow if needed, but for async/await deadlock, 
        // real promises are usually enough.
        
        // ACT
        // Call togglePlay. We need to cast to any because it's private.
        // pass mock editor and status bar
        const mockEditor = { getCursor: jest.fn(), posToOffset: jest.fn() };
        const mockStatusBar = {};
        
        // We expect this promise to resolve quickly because it shouldn't await play()
        await (plugin as any).togglePlay(mockEditor, 'auto', mockStatusBar);

        // Debug: Did an error occur?
        if ((FileLogger.error as jest.Mock).mock.calls.length > 0) {
            console.error('FileLogger.error called with:', (FileLogger.error as jest.Mock).mock.calls[0]);
        }

        expect(mockProcessor.process).toHaveBeenCalled();
        // Check if text chunks were populated (indirectly via reset call which happens after chunking)
        expect(mockPlayer.reset).toHaveBeenCalled();

        // ASSERT
        // 1. initSource called
        expect(mockPlayer.initSource).toHaveBeenCalled();
        
        // 2. socket.connect called
        expect(mockSocket.connect).toHaveBeenCalled();
        
        // 3. play called (because we trigger it in parallel)
        // Wait... in my code: if (this.isPlaying && !this.isPaused) { void this.player.play() }
        // This happens inside the .then() of initSource. 
        // Since initSource resolves immediately in mock, play should be called.
        expect(mockPlayer.play).toHaveBeenCalled();

        // 4. CRITICAL: sendSSML must be called. 
        // If deadlock existed (awaiting play), this would NOT be reached because playPromise is still pending.
        expect(mockSocket.sendSSML).toHaveBeenCalled();
        
        // Cleanup: resolve the hanging promise to finish test cleanly
        if (playResolve!) playResolve();
    });
});
