import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

interface MockWebSocket {
    send: jest.Mock;
    close: jest.Mock;
    addEventListener: jest.Mock;
    on: jest.Mock;
    readyState: number;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: unknown; type: string; target: WebSocket }) => void) | null;
    onerror: ((err: Error) => void) | null;
    onclose: (() => void) | null;
    binaryType: string;
}

describe('EdgeSocket', () => {
    let socket: EdgeSocket;
    let mockWsInstance: MockWebSocket;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock global crypto
        Object.defineProperty(global, 'crypto', {
            value: {
                subtle: {
                    digest: jest.fn().mockResolvedValue(new ArrayBuffer(32))
                }
            },
            writable: true
        });

        // Setup the mock instance that WebSocket constructor will return
        mockWsInstance = {
            send: jest.fn(),
            close: jest.fn(),
            addEventListener: jest.fn(),
            on: jest.fn(),
            readyState: 1, // OPEN
            onopen: null, // Will be set by the class
            onmessage: null,
            onerror: null,
            onclose: null,
            binaryType: 'arraybuffer'
        };

        // When new WebSocket() is called, return our mock instance
        (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWsInstance);
        // Also mock the static OPEN constant
        (WebSocket as unknown as { OPEN: number }).OPEN = 1;

        socket = new EdgeSocket();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('connect should establish WebSocket connection', async () => {
        const connectPromise = socket.connect();

        // Wait for async parts (crypto)
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(WebSocket as unknown as jest.Mock).toHaveBeenCalledWith(
            expect.stringContaining('wss://') as unknown,
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': expect.any(String) as unknown as string,
                    'Origin': expect.any(String) as unknown as string
                }) as unknown
            }) as unknown
        );

        // Simulate open event
        if (mockWsInstance.onopen) {
            mockWsInstance.onopen();
        }

        await connectPromise;

        expect(mockWsInstance.send).toHaveBeenCalled();
    });

    test('sendSSML should send correct text message', async () => {
        const connectPromise = socket.connect();
        await new Promise(resolve => setTimeout(resolve, 50)); // Wait for WebSocket init
        if (mockWsInstance.onopen) mockWsInstance.onopen();
        await connectPromise;

        const ssml = "<speak>Hello</speak>";
        const requestId = "123-456";
        await socket.sendSSML(ssml, requestId);

        expect(mockWsInstance.send).toHaveBeenCalledWith(expect.stringContaining(ssml));
        expect(mockWsInstance.send).toHaveBeenCalledWith(expect.stringContaining("X-RequestId:123-456"));
    });

    test('close should close WebSocket connection', async () => {
        const connectPromise = socket.connect();
        await new Promise(resolve => setTimeout(resolve, 50)); // Wait for WebSocket init
        if (mockWsInstance.onopen) mockWsInstance.onopen();
        await connectPromise;

        socket.close();
        expect(mockWsInstance.close).toHaveBeenCalled();
    });
});
