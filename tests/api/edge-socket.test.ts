import { EdgeSocket } from '../../src/api/edge-socket';

describe('EdgeSocket', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;
    let originalWebSocket: any;

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

        mockWsInstance = {
            send: jest.fn(),
            close: jest.fn(),
            addEventListener: jest.fn(),
            on: jest.fn(),
            readyState: 1
        };

        originalWebSocket = global.WebSocket;
        global.WebSocket = jest.fn(() => mockWsInstance) as any;
        (global.WebSocket as any).OPEN = 1;

        socket = new EdgeSocket();
    });

    afterEach(() => {
        global.WebSocket = originalWebSocket;
    });

    test('connect should establish WebSocket connection', async () => {
        const connectPromise = socket.connect();

        // Wait for async parts (crypto)
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(global.WebSocket).toHaveBeenCalledWith(
            expect.stringContaining('Sec-MS-GEC=')
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
