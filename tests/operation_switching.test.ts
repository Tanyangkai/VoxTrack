
import VoxTrackPlugin from '../src/main';
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';
import { TextProcessor } from '../src/text-processor';
import { v4 as uuidv4 } from 'uuid';

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
jest.mock('uuid', () => ({ v4: jest.fn() }));

(global as any).requestAnimationFrame = jest.fn();
(global as any).cancelAnimationFrame = jest.fn();

describe('Operation Switching & Cache Interference', () => {
    let plugin: any;
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    let mockEditor: any;
    let messageCallback: (data: any) => Promise<void>;
    let closeCallback: (code: number, reason: string) => void;

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // --- Player Mock ---
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
            addChunk: jest.fn(),
            clearFutureBuffer: jest.fn()
        };
        (AudioPlayer as jest.Mock).mockImplementation(() => mockPlayer);

        // --- Socket Mock ---
        mockSocket = {
            connect: jest.fn().mockResolvedValue(undefined),
            sendSSML: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            onMessage: jest.fn((cb: any) => { 
                cb._id = Math.random();
                console.log('[Mock] onMessage called with cb identity:', cb._id);
                messageCallback = cb; 
            }),
            onClose: jest.fn((cb: any) => { closeCallback = cb; })
        };
        (EdgeSocket as jest.Mock).mockImplementation(() => mockSocket);

        // --- Controller Mock ---
        // Use a simple real-ish implementation for metadata array to verify clearing
        let metadataStore: any[] = [];
        mockController = {
            findActiveMetadata: jest.fn(),
            findMetadataByTextOffset: jest.fn(),
            findClosestMetadata: jest.fn(),
            removeChunk: jest.fn(),
            reset: jest.fn(() => { metadataStore = []; }),
            addMetadata: jest.fn((items) => { metadataStore.push(...items); }),
            getLastEndTime: jest.fn().mockReturnValue(0),
            getMetadataCount: () => metadataStore.length // Helper for test verification
        };
        (SyncController as jest.Mock).mockImplementation(() => mockController);

        // --- Editor Mock ---
        mockEditor = {
            getValue: jest.fn(),
            getCursor: jest.fn(),
            posToOffset: jest.fn(),
            cm: {
                dispatch: jest.fn()
            }
        };

        // --- UUID Mock ---
        // Return sequential IDs to distinguish sessions
        let uuidCounter = 0;
        (uuidv4 as jest.Mock).mockImplementation(() => {
            const val = `uuid-${++uuidCounter}`;
            console.log('[Test] uuid generated:', val);
            return val;
        });

        // --- Plugin Instantiation ---
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
            voice: 'en-US-JennyNeural', 
            volume: '+0%', 
            playbackSpeed: 1.0,
            highlightMode: 'word',
            autoScrollMode: 'off'
        };
        
        // Mock UI elements
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

        await plugin.onload();
        
        // Inject mocks AFTER onload, because onload creates its own instances
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        plugin.textProcessor = { process: jest.fn() };
    });

    const triggerPlay = async (text: string, mode: 'auto' | 'cursor' = 'auto') => {
        // Must provide a map with at least one entry >= 0 to ensure foundStart becomes true
        // assuming cursorTargetOffset is 0.
        plugin.textProcessor.process.mockReturnValue([{ text: text, map: [0, 1, 2] }]);
        mockEditor.getValue.mockReturnValue(text);
        // Also update getFullText mock if in auto mode without selection
        const utils = require('../src/utils/editor-utils');
        utils.getFullText.mockReturnValue({ text: text });
        
        if (mode === 'cursor') {
            mockEditor.getCursor.mockReturnValue({line: 0, ch: 0});
            mockEditor.posToOffset.mockReturnValue(0);
        }
        
        console.log(`[Test] Triggering play. Mode: ${mode}, Text: ${text}`);
        await plugin.togglePlay(mockEditor, mode, {} as HTMLElement);
        console.log(`[Test] Trigger finished. isPlaying: ${plugin.isPlaying}, isPaused: ${plugin.isPaused}`);
        console.log(`[Test] Process called: ${plugin.textProcessor.process.mock.calls.length}`);
        
        // Check for errors
        const logger = require('../src/utils/logger').FileLogger;
        if (logger.error.mock.calls.length > 0) {
            console.log('[Test] FileLogger.error called:', logger.error.mock.calls[0]);
        }
    };

    test('Play -> Stop -> Play: Ensures fresh state', async () => {
        // 1. Start Session A
        await triggerPlay("Session A Text");
        expect(plugin.isPlaying).toBe(true);
        const sessionA_ID = (uuidv4 as jest.Mock).mock.results[0].value; // captured during setupDataHandler? 
        // Note: uuid is called multiple times (setupDataHandler, sendChunk requestID).
        
        // Simulate receiving metadata for A
        const metaHeader = "Path:audio.metadata\r\nX-RequestId:req1\r\n\r\n";
        const metaBody = JSON.stringify({ Metadata: [{ Type: "WordBoundary", Data: { Offset: 100, Duration: 50, text: { Text: "A" } } }] });
        await messageCallback(new TextEncoder().encode(metaHeader + metaBody));
        
        expect(mockController.addMetadata).toHaveBeenCalledTimes(1);
        expect(mockController.getMetadataCount()).toBe(1);

        // 2. Stop
        plugin.stopPlayback();
        expect(plugin.isPlaying).toBe(false);
        expect(mockPlayer.stop).toHaveBeenCalled();
        expect(mockController.reset).toHaveBeenCalled();
        expect(mockController.getMetadataCount()).toBe(0);

        // 3. Start Session B
        await triggerPlay("Session B Text");
        expect(plugin.isPlaying).toBe(true);
        
        // Verify state is clean
        expect(plugin.textChunks[0]).toBe("Session B Text");
        // Ensure NO old metadata leaked (controller was reset)
        expect(mockController.getMetadataCount()).toBe(0); 

        // Simulate receiving metadata for B
        const metaHeaderB = "Path:audio.metadata\r\nX-RequestId:req2\r\n\r\n";
        const metaBodyB = JSON.stringify({ Metadata: [{ Type: "WordBoundary", Data: { Offset: 100, Duration: 50, text: { Text: "B" } } }] });
        await messageCallback(new TextEncoder().encode(metaHeaderB + metaBodyB));

        expect(mockController.getMetadataCount()).toBe(1);
        // We can't easily inspect the content of metadataStore since it's inside the mock scope unless we exposed it,
        // but we verify count is 1, meaning it didn't keep 'A'.
    });

    test('Race Condition: Fast Switch (Read Cursor A -> Read Cursor B)', async () => {
        // Mock session manager logic to verify isolation
        const mockSessionManager = {
            startNewSession: jest.fn(),
            isValid: jest.fn(),
            clear: jest.fn()
        };
        (plugin as any).sessionManager = mockSessionManager;

        // 1. Trigger A
        await triggerPlay("Text A");
        const handlerA = messageCallback;
        expect(mockSessionManager.startNewSession).toHaveBeenCalledTimes(1);
        const sessionA_ID = mockSessionManager.startNewSession.mock.calls[0][0];

        // 2. Immediately Trigger B
        await triggerPlay("Text B", 'cursor');
        const handlerB = messageCallback;
        expect(mockSessionManager.startNewSession).toHaveBeenCalledTimes(2);
        const sessionB_ID = mockSessionManager.startNewSession.mock.calls[1][0];

        expect(sessionA_ID).not.toBe(sessionB_ID);

        // Configure isValid to simulate real behavior: only latest is valid
        mockSessionManager.isValid.mockImplementation((id) => id === sessionB_ID);

        // 3. Simulate Data Arrival for Session A
        const audioData = new Uint8Array([0x00, 0x00, 0x01]); // Fake audio
        
        mockPlayer.addChunk.mockClear(); 
        await handlerA(audioData);
        
        // Verify handlerA checked validity of sessionA_ID
        expect(mockSessionManager.isValid).toHaveBeenCalledWith(sessionA_ID);
        // Since isValid returned false (A != B), addChunk should not be called
        expect(mockPlayer.addChunk).not.toHaveBeenCalled();

        // 4. Simulate Data Arrival for Session B
        await handlerB(audioData);
        expect(mockSessionManager.isValid).toHaveBeenCalledWith(sessionB_ID);
        expect(mockPlayer.addChunk).toHaveBeenCalledTimes(1);
    });

    test('Read from Cursor -> Read from Cursor: Should restart completely each time', async () => {
        // 1. First "Read from Cursor"
        await triggerPlay("Text A", 'cursor');
        expect(plugin.activeMode).toBe('cursor');
        expect(plugin.isPlaying).toBe(true);
        
        mockPlayer.stop.mockClear();
        mockPlayer.initSource.mockClear();
        
        // 2. Second "Read from Cursor"
        await triggerPlay("Text B", 'cursor');
        
        // Expect full restart
        expect(mockPlayer.stop).toHaveBeenCalled();
        expect(mockPlayer.initSource).toHaveBeenCalled();
        expect(plugin.activeMode).toBe('cursor');
        expect(plugin.isPlaying).toBe(true);
    });

    test('Play -> Play (Auto mode): Should toggle Pause/Resume, not Restart', async () => {
        // 1. Start Playing
        await triggerPlay("Text A", 'auto');
        expect(plugin.isPlaying).toBe(true);
        expect(plugin.isPaused).toBe(false);
        
        mockPlayer.stop.mockClear();
        mockPlayer.initSource.mockClear();
        
        // 2. Trigger Play again (e.g. status bar click)
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        
        expect(plugin.isPlaying).toBe(true);
        expect(plugin.isPaused).toBe(true);
        expect(mockPlayer.pause).toHaveBeenCalled();
        expect(mockPlayer.stop).not.toHaveBeenCalled(); // Important: No restart
        
        // 3. Trigger Play yet again
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        
        expect(plugin.isPlaying).toBe(true);
        expect(plugin.isPaused).toBe(false);
        expect(mockPlayer.play).toHaveBeenCalled();
        expect(mockPlayer.initSource).not.toHaveBeenCalled(); // No re-init
    });

    test('Pause -> Read from Cursor: Should restart completely', async () => {
        // 1. Play
        await triggerPlay("Text A");
        
        // 2. Pause
        plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement); // Toggles to pause
        expect(plugin.isPaused).toBe(true);
        expect(mockPlayer.pause).toHaveBeenCalled();
        
        // 3. Read from Cursor (Force Restart)
        await triggerPlay("Text B", 'cursor');
        
        expect(plugin.isPlaying).toBe(true);
        expect(plugin.isPaused).toBe(false);
        expect(plugin.activeMode).toBe('cursor');
        
        // Verify stop was called to clean up A
        expect(mockPlayer.stop).toHaveBeenCalled();
        // Verify B started
        expect(mockPlayer.initSource).toHaveBeenCalled();
    });

    test('Cursor Mode -> Toggle (Play/Pause): Should Pause, not Restart', async () => {
        // 1. Start with Cursor
        await triggerPlay("Text A", 'cursor');
        expect(plugin.activeMode).toBe('cursor');
        
        mockPlayer.stop.mockClear();
        mockPlayer.initSource.mockClear();
        
        // 2. Toggle (User clicks Play button or hits command)
        // Note: The UI logic usually calls togglePlay with 'auto' for generic button clicks.
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        
        // Expect: Pause
        expect(plugin.isPaused).toBe(true);
        expect(mockPlayer.pause).toHaveBeenCalled();
        
        // Expect: NO Reset/Stop
        expect(mockPlayer.stop).not.toHaveBeenCalled();
        
        // 3. Toggle again (Resume)
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        expect(plugin.isPaused).toBe(false);
        expect(mockPlayer.play).toHaveBeenCalled();
        expect(mockPlayer.initSource).not.toHaveBeenCalled(); // No re-init
    });
});
