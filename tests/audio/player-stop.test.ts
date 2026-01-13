
import { AudioPlayer } from '../../src/audio/player';

// Mock Browser APIs
class MockAudio {
    public playbackRate: number = 1;
    public currentTime: number = 0;
    public src: string = '';
    public paused: boolean = true;
    public listeners: any = {};

    constructor() {
        this.listeners = {};
    }

    addEventListener(event: string, callback: any) {
        this.listeners[event] = callback;
    }

    removeEventListener(event: string, callback: any) {
        if (this.listeners[event] === callback) {
            delete this.listeners[event];
        }
    }

    play() {
        this.paused = false;
        return Promise.resolve();
    }
    pause() {
        this.paused = true;
    }
    load() { }
    cloneNode() { return new MockAudio(); }
    replaceWith() { }
    removeAttribute(attr: string) {
        if (attr === 'src') this.src = '';
    }
}

global.Audio = MockAudio as any;
global.MediaSource = class {
    readyState = 'closed';
    addEventListener() {}
    addSourceBuffer() { return { addEventListener: () => {} }; }
    endOfStream() {}
} as any;
global.URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => { }
} as any;

describe('AudioPlayer Stop Behavior', () => {
    let player: AudioPlayer;
    let mockAudio: MockAudio;

    beforeEach(() => {
        const originalAudio = global.Audio;
        global.Audio = class extends MockAudio {
            constructor() {
                super();
                mockAudio = this;
            }
        } as any;
        player = new AudioPlayer();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should pause audio and clear source when stopped', async () => {
        await player.play();
        expect(mockAudio.paused).toBe(false);

        player.stop();

        expect(mockAudio.paused).toBe(true);
        expect(mockAudio.src).toBe('');
    });
});
