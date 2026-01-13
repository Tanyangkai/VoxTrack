import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

describe('EdgeSocket Heartbeat', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockWsInstance = {
            send: jest.fn(),
            ping: jest.fn(),
            close: jest.fn(),
            readyState: 1, // OPEN
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            binaryType: 'arraybuffer'
        };

        (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWsInstance);
        (WebSocket as unknown as any).OPEN = 1;

        // Mock global crypto for connect()
        Object.defineProperty(global, 'crypto', {
            value: {
                subtle: {
                    digest: jest.fn().mockResolvedValue(new ArrayBuffer(32))
                }
            },
            writable: true
        });

        socket = new EdgeSocket();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should send heartbeat pings periodically after connection', async () => {
        const connectPromise = socket.connect();
        
        // Advance timers to trigger connection async parts
        await Promise.resolve();
        await Promise.resolve();

        if (mockWsInstance.onopen) mockWsInstance.onopen();
        await connectPromise;

        // Advance time by 30 seconds
        jest.advanceTimersByTime(30000);

        // Check if ping was called
        // Note: We haven't implemented it yet, so this SHOULD FAIL.
        expect(mockWsInstance.ping).toHaveBeenCalled();
    });
});
