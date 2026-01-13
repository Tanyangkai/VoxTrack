
import { AudioPlayer } from '../src/audio/player';

describe('AudioPlayer Seek Logic', () => {
    let player: AudioPlayer;
    let mockAudio: any;
    let mockSourceBuffer: any;
    let mockMediaSource: any;

    beforeEach(() => {
        // Mock HTMLAudioElement
        mockAudio = {
            currentTime: 0,
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            src: '',
            load: jest.fn(),
            removeAttribute: jest.fn(),
            cloneNode: jest.fn().mockReturnValue({}),
            replaceWith: jest.fn()
        };
        global.Audio = jest.fn(() => mockAudio) as any;
        global.URL.createObjectURL = jest.fn();
        global.URL.revokeObjectURL = jest.fn();

        // Mock MediaSource & SourceBuffer
        mockSourceBuffer = {
            updating: false,
            buffered: {
                length: 0,
                start: jest.fn(),
                end: jest.fn()
            },
            appendBuffer: jest.fn(),
            remove: jest.fn(),
            addEventListener: jest.fn()
        };

        mockMediaSource = {
            readyState: 'open',
            addSourceBuffer: jest.fn().mockReturnValue(mockSourceBuffer),
            addEventListener: jest.fn(),
            endOfStream: jest.fn()
        };
        global.MediaSource = jest.fn(() => mockMediaSource) as any;

        player = new AudioPlayer();
        player.initSource(); // Attach mocks
    });

    test('Should not play if pending seek is set', async () => {
        player.setPendingSeek(10);
        
        await player.play();
        
        // Should NOT call underlying audio.play() yet because we are waiting for seek
        expect(mockAudio.play).not.toHaveBeenCalled();
    });

    test('Should execute seek and then play when buffer covers target', () => {
        // Trigger sourceopen to set sourceBuffer on player
        const sourceOpenHandler = mockMediaSource.addEventListener.mock.calls.find((call: any[]) => call[0] === 'sourceopen')[1];
        sourceOpenHandler();
        
        player.setPendingSeek(10);
        
        // Initially buffer does NOT cover target (e.g. empty)
        mockSourceBuffer.buffered = {
            length: 0,
            start: jest.fn(),
            end: jest.fn()
        };

        // 1. play() called -> should be deferred
        player.play();
        expect(mockAudio.play).not.toHaveBeenCalled();
        expect((player as any).isPlaying).toBe(true);
        
        // 2. Simulate data arrival (Buffer updates to cover target)
        mockSourceBuffer.buffered = {
            length: 1,
            start: (i: number) => 5,
            end: (i: number) => 15
        };

        // Trigger check via addChunk -> processQueue
        player.addChunk(new Uint8Array([0]));
        
        // Verify seek happened
        expect(mockAudio.currentTime).toBe(10);
        
        // Verify play happened AFTER seek
        expect(mockAudio.play).toHaveBeenCalled();
    });
});
