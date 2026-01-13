import VoxTrackPlugin from '../src/main';
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';
import { TextProcessor } from '../src/text-processor';

// Mocks
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
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

// We do NOT mock sync-utils so we use the real implementation for findWordIndexInDoc

describe('Bug Repro: Highlight Jump on Recovery', () => {
    let plugin: any;
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    let mockEditor: any;
    let dispatchSpy: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockPlayer = {
            restartAt: jest.fn().mockResolvedValue(undefined),
            getCurrentTime: jest.fn().mockReturnValue(0),
            getBufferedEnd: jest.fn().mockReturnValue(100),
            reset: jest.fn(),
            stop: jest.fn(),
            finish: jest.fn(),
            initSource: jest.fn().mockResolvedValue(undefined),
            setPlaybackRate: jest.fn(),
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            onComplete: jest.fn(),
            waitForQueueEmpty: jest.fn().mockResolvedValue(undefined),
            destroy: jest.fn()
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

        dispatchSpy = jest.fn();
        mockEditor = {
            getValue: jest.fn(),
            getCursor: jest.fn(),
            posToOffset: jest.fn(),
            cm: {
                dispatch: dispatchSpy
            }
        };

        const mockApp = {
            workspace: {
                getActiveViewOfType: jest.fn(),
                on: jest.fn()
            }
        };

        plugin = new VoxTrackPlugin(mockApp as any, {} as any);
        plugin.loadData = jest.fn().mockResolvedValue({});
        plugin.saveData = jest.fn().mockResolvedValue({});
        plugin.applyHighlightColor = jest.fn();
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        plugin.textProcessor = { process: jest.fn() };
        plugin.settings = { 
            voice: 'zh-CN-XiaoxiaoNeural', 
            volume: '+0%', 
            playbackSpeed: 1.0,
            highlightMode: 'word',
            autoScrollMode: 'off'
        };
        plugin.activeEditor = mockEditor;
        
        plugin.addStatusBarItem = jest.fn().mockReturnValue({
            createSpan: jest.fn().mockReturnValue({
                addClass: jest.fn(),
                setText: jest.fn(),
                setAttribute: jest.fn()
            }),
            addClass: jest.fn()
        });
        plugin.registerEditorExtension = jest.fn();
        plugin.addSettingTab = jest.fn();
        plugin.addRibbonIcon = jest.fn();
        plugin.addCommand = jest.fn();
        plugin.registerEvent = jest.fn();
        plugin.onload();
    });

    test('Reproduce incorrect restart index on words with periods (e.g. node.js)', async () => {
        const docText = "Use node.js for backend. Use node.js again.";
        mockEditor.getValue.mockReturnValue(docText);
        
        plugin.textChunks = [docText];
        plugin.chunkOffsets = [0];
        plugin.chunkMaps = [Array.from({length: docText.length}, (_, i) => i)]; 
        plugin.chunkScanOffsets = [0];
        plugin.currentChunkIndex = 0;
        plugin.isPlaying = false;
        plugin.isPaused = false;
        plugin.activeEditor = mockEditor;

        let loopCallback: Function | null = null;
        (global as any).requestAnimationFrame = (cb: Function) => {
            loopCallback = cb;
            return 123;
        };

        plugin.textProcessor.process.mockReturnValue([{ text: docText, map: plugin.chunkMaps[0] }]);
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        
        // Advance past "node.js" to "backend"
        // "Use node.js for " -> length 16.
        plugin.lastProcessedTextIndex = 16;
        mockPlayer.getCurrentTime.mockReturnValue(5.0);
        
        // Mock findActiveMetadata to return "backend"
        mockController.findActiveMetadata.mockReturnValue({
            text: "backend",
            textOffset: 16,
            chunkIndex: 0
        });
        
        // Trigger recovery
        // Current logic will see '.' in "node.js" (index 8) as terminator.
        // It will restart at index 9 ("js for backend...").
        // We want it to ignore that dot and go back to start or previous sentence.
        
        // We can inspect 'plugin.lastProcessedTextIndex' or 'chunkScanOffsets' after recovery.
        // Or inspect calls to 'player.restartAt' (we can't easily see calculated index there).
        // But 'sendChunk' is called with substring.
        
        // Let's spy on 'sendChunk' or 'socket.sendSSML'.
        // sendSSML arg contains the text.
        
        await plugin.recoverConnection({} as HTMLElement);
        
        const calls = mockSocket.sendSSML.mock.calls;
        const sendCall = calls[calls.length - 1]; // Get the LAST call
        const sentSSML = sendCall[0];
        
        console.log('Sent SSML (Recovery):', sentSSML);
        
        // BUG: Logic finds '.' in "node.js" and restarts at 9 ("js for backend")
        // FIX: Logic should ignore '.' and restart at 0 ("Use node.js...")
        
        // Assert FIXED behavior
        expect(sentSSML).toContain("Use node.js for backend"); 
        expect(sentSSML).not.toContain("><prosody pitch='+0Hz' rate='+0%' volume='+0%'>js for backend");
    });
});