import { EdgeSocket } from '../../src/api/edge-socket';
import WebSocket from 'ws';

jest.mock('ws', () => {
    return {
        __esModule: true,
        default: jest.fn()
    };
});

describe('EdgeSocket', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockWsInstance = {
            send: jest.fn(),
            close: jest.fn(),
            addEventListener: jest.fn(),
            readyState: 1
        };

        (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWsInstance);

        socket = new EdgeSocket();
    });

    test('connect should establish WebSocket connection with headers', async () => {
        const connectPromise = socket.connect();

        expect(WebSocket).toHaveBeenCalledWith(
            expect.stringContaining('wss://'),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                    'User-Agent': expect.stringContaining('Mozilla')
                })
            })
        );

        // Simulate open event
        const openCallback = mockWsInstance.addEventListener.mock.calls.find((call: any) => call[0] === 'open')?.[1];
        if (openCallback) {
            openCallback();
        }

        await connectPromise;

        expect(mockWsInstance.send).toHaveBeenCalled(); 
    });

    test('sendSSML should send correct text message', async () => {
        const connectPromise = socket.connect();
        const openCallback = mockWsInstance.addEventListener.mock.calls.find((call: any) => call[0] === 'open')?.[1];
        if (openCallback) openCallback();
        await connectPromise;

        const ssml = "<speak>Hello</speak>";
        const requestId = "123-456";
        await socket.sendSSML(ssml, requestId);

        expect(mockWsInstance.send).toHaveBeenCalledWith(expect.stringContaining(ssml));
        expect(mockWsInstance.send).toHaveBeenCalledWith(expect.stringContaining("X-RequestId: 123-456"));
    });
});
