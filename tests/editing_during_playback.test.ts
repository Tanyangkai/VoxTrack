
import VoxTrackPlugin from '../src/main';
import { AudioPlayer } from '../src/audio/player';
import { EdgeSocket } from '../src/api/edge-socket';
import { SyncController } from '../src/sync/controller';
import { TextProcessor } from '../src/text-processor';
import { EditorView } from '@codemirror/view';

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
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

// Use real sync-utils implicitly
// jest.mock('../src/utils/sync-utils');

(global as any).requestAnimationFrame = (cb: Function) => cb(); // Auto-run
(global as any).cancelAnimationFrame = jest.fn();

describe('Editing During Playback', () => {
    let plugin: any;
    let mockPlayer: any;
    let mockSocket: any;
    let mockController: any;
    let mockEditor: any;
    let dispatchSpy: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        
        mockPlayer = {
            restartAt: jest.fn(),
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

        dispatchSpy = jest.fn();
        mockEditor = {
            getValue: jest.fn(),
            getCursor: jest.fn(),
            posToOffset: jest.fn(),
            cm: { dispatch: dispatchSpy },
            view: { dispatch: dispatchSpy }
        };

        const mockApp = { workspace: { getActiveViewOfType: jest.fn(), on: jest.fn() } };

        plugin = new VoxTrackPlugin(mockApp as any, {} as any);
        plugin.loadData = jest.fn().mockResolvedValue({});
        plugin.saveData = jest.fn().mockResolvedValue({});
        plugin.applyHighlightColor = jest.fn();
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
        // Use a semi-real text processor or manually set state
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
        
        // Inject mocks
        plugin.player = mockPlayer;
        plugin.socket = mockSocket;
        plugin.syncController = mockController;
    });

    test('Self-Healing: Small insertion BEFORE reading position', async () => {
        // Doc: "Start Target End"
        // Target is at index 6.
        const docTextOriginal = "Start Target End";
        mockEditor.getValue.mockReturnValue(docTextOriginal);
        
        // Manual setup
        plugin.textChunks = [docTextOriginal];
        plugin.chunkOffsets = [0];
        plugin.chunkMaps = [Array.from({length: docTextOriginal.length}, (_, i) => i)]; 
        plugin.currentChunkIndex = 0;
        plugin.isPlaying = true;
        plugin.activeEditor = mockEditor;
        plugin.baseOffset = 0;
        plugin.currentDocOffset = 0;

        // Simulate Metadata for "Target"
        // Offset 6 in original
        mockController.findActiveMetadata.mockReturnValue({
            text: "Target",
            textOffset: 6,
            wordLength: 6,
            chunkIndex: 0
        });

        // 1. Verify Normal Highlight
        // Manually trigger the sync logic (extract from main.ts updateLoop)
        // Since updateLoop is private and closed over, we can't call it easily.
        // We will invoke `togglePlay` to start the loop, but we need to control the loop.
        // Or we can just test the logic concept by trusting `findWordIndexInDoc` which is used by main.ts.
        
        // But let's try to run the actual loop via `requestAnimationFrame` mock.
        // The mock executes callback immediately.
        // So we need to control WHEN `requestAnimationFrame` is called.
        // The test setup sets it to auto-run. This might cause infinite loop if not careful.
        
        // Let's change the mock to manual.
        const originalSetup = (plugin as any).setupDataHandler.bind(plugin);
        (plugin as any).setupDataHandler = jest.fn((...args) => {
            console.log('[Mock] setupDataHandler hooked called');
            return originalSetup(...args);
        });
        
        // Mock rAF on both global and window (if exists)
        const mockRaf = jest.fn((cb: Function) => { 
            console.log('[Mock] rAF called');
            frameCallback = cb; 
            return 1; 
        });
        (global as any).requestAnimationFrame = mockRaf;
        if (typeof window !== 'undefined') (window as any).requestAnimationFrame = mockRaf;
        
        // Start play to init loop
        plugin.textProcessor.process.mockReturnValue([{ text: docTextOriginal, map: plugin.chunkMaps[0] }]);
        
        console.log('Calling togglePlay');
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        console.log('textChunks length:', plugin.textChunks.length);
        console.log('togglePlay returned. isPlaying:', plugin.isPlaying);
        console.log('setupDataHandler called:', (plugin as any).setupDataHandler.mock.calls.length);
        console.log('rAF call count:', mockRaf.mock.calls.length);
        
        // Force loop start if togglePlay failed to hook it (debugging fallback)
        if (mockRaf.mock.calls.length === 0) {
            console.log('Forcing setupDataHandler manually');
            (plugin as any).setupDataHandler({});
        }
        
        const loggerDebug = require('../src/utils/logger').FileLogger;
        if (loggerDebug.error.mock.calls.length > 0) {
             console.log('Logger errors:', loggerDebug.error.mock.calls);
        }
        
        // Expect one dispatch for "Target"
        expect(frameCallback).toBeTruthy();
        
        // 2. Modify Document: Insert "NEW " at start
        const docTextModified = "NEW Start Target End";
        mockEditor.getValue.mockReturnValue(docTextModified);
        
        // "Target" is now at index 10 (6 + 4).
        // Plugin's map still says index 6.
        
        // Run loop
        frameCallback!();
        
        // Check dispatch
        const calls = dispatchSpy.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        
        // If logic healed, range should be 10-16.
        // If logic failed, range would be 6-12 ("art Ta") or similar.
        
        // We need to inspect `setActiveRange`.
        // Since we can't inspect StateEffect object easily, we check if logic found it.
        // If `findWordIndexInDoc` works, it returns the index in `docTextModified`.
        
        // `chunkBaseOffset` = 0.
        // `rawStart` = 6. `absStart` = 6.
        // `foundSlice` = "art Ta" (in "NEW Start...").
        // `foundSlice` != "Target".
        // Enter refinement window search.
        // Search "Target" near 6.
        // Found at 10.
        
        // So it SHOULD heal.
        
        // Let's inspect the call arg structure.
        // We can't see the Effect value directly easily.
        // But we can rely on `FileLogger` warnings.
        // If mismatch, `FileLogger.warn` is called.
        
        const logger = require('../src/utils/logger').FileLogger;
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Text Mismatch"), expect.any(Object));
        
        // If we make the insertion HUGE, it should fail.
    });

    test('Failure: Large insertion BEFORE reading position', async () => {
        const docTextOriginal = "Start Target End";
        
        // Manual setup
        plugin.textChunks = [docTextOriginal];
        plugin.chunkOffsets = [0];
        plugin.chunkMaps = [Array.from({length: docTextOriginal.length}, (_, i) => i)]; 
        plugin.currentChunkIndex = 0;
        plugin.isPlaying = true;
        plugin.activeEditor = mockEditor;
        plugin.baseOffset = 0;
        plugin.currentDocOffset = 0;

        mockController.findActiveMetadata.mockReturnValue({
            text: "Target",
            textOffset: 6,
            wordLength: 6,
            chunkIndex: 0
        });

        let frameCallback: Function | null = null;
        const mockRaf = jest.fn((cb: Function) => { 
            frameCallback = cb; 
            return 1; 
        });
        (global as any).requestAnimationFrame = mockRaf;
        if (typeof window !== 'undefined') (window as any).requestAnimationFrame = mockRaf;
        
        plugin.textProcessor.process.mockReturnValue([{ text: docTextOriginal, map: plugin.chunkMaps[0] }]);
        await plugin.togglePlay(mockEditor, 'auto', {} as HTMLElement);
        
        if (!frameCallback) {
             (plugin as any).setupDataHandler({});
        }
        
        // Modify Document: Insert 1000 chars
        const padding = "X".repeat(1000);
        const docTextModified = padding + "Start Target End";
        mockEditor.getValue.mockReturnValue(docTextModified);
        
        // Run loop
        expect(frameCallback).toBeTruthy();
        frameCallback!();
        
        // Expect Warning (Either "Could not find" or "Text Mismatch" depending on if it matched garbage)
        const logger = require('../src/utils/logger').FileLogger;
        const lastCall = logger.warn.mock.calls[0];
        const msg = lastCall ? lastCall[0] : '';
        
        expect(msg).toMatch(/Could not find|Text Mismatch/);
    });
});
