import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

describe('EdgeSocket Robust Heartbeat', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockWsInstance = {
            send: jest.fn(),
            // ping: undefined, // Simulate NO ping method
            close: jest.fn(),
            readyState: 1, 
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            binaryType: 'arraybuffer'
        };

        (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWsInstance);
        (WebSocket as unknown as any).OPEN = 1;

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

    test('should use application-level keep-alive (sendConfig) when ping is not available', async () => {
        const connectPromise = socket.connect();
        await Promise.resolve(); 
        await Promise.resolve();
        if (mockWsInstance.onopen) mockWsInstance.onopen();
        await connectPromise;

        // Initial config sent
        expect(mockWsInstance.send).toHaveBeenCalledTimes(1);

        // Advance time by 20 seconds (heartbeat interval is 15s)
        jest.advanceTimersByTime(20000);

        // Should have called send() again as keep-alive because ping is missing
        expect(mockWsInstance.send).toHaveBeenCalledTimes(2);
        expect(mockWsInstance.send).toHaveBeenLastCalledWith(expect.stringContaining('Path:speech.config'));
    });
});
