/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

describe('EdgeSocket', () => {
    let socket: EdgeSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWsInstance: any;

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

        expect(WebSocket).toHaveBeenCalledWith(
            expect.stringContaining('wss://'),
            expect.objectContaining({ headers: expect.any(Object) })
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
