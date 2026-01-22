import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

describe('EdgeSocket Connection Failure Reproduction', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;
    let mockOnClose: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

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
            ping: jest.fn(),
            close: jest.fn(),
            addEventListener: jest.fn(),
            on: jest.fn(),
            readyState: 0, // CONNECTING
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null,
            binaryType: 'arraybuffer'
        };

        (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWsInstance);
        (WebSocket as unknown as { OPEN: number }).OPEN = 1;

        socket = new EdgeSocket();
        mockOnClose = jest.fn();
        socket.onClose(mockOnClose);
    });

    test('should NOT trigger onClose callback when connection fails and retries', async () => {
        // Start connection
        const connectPromise = socket.connect(1, 10); // 1 retry, short delay

        // Wait for WebSocket instantiation
        await new Promise(resolve => setTimeout(resolve, 50));

        // Simulate connection error BEFORE open
        const error = new Error('Connection failed');
        if (mockWsInstance.onerror) {
            mockWsInstance.onerror(error);
        }

        // Simulate socket close immediately after error (common behavior)
        if (mockWsInstance.onclose) {
            mockWsInstance.onclose({ code: 1006, reason: 'Abnormal Closure' });
        }

        // Wait for potential retry delay
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify that onClose callback was NOT called (it should be suppressed during connection phase)
        expect(mockOnClose).not.toHaveBeenCalled();

        // Now verify we are indeed retrying (new WebSocket should be created)
        // With 1 retry, we expect 2 instantiations total (initial + 1 retry)
        // However, since we mock the implementation to return the SAME object reference in this simple setup,
        // we check the constructor calls.
        expect(WebSocket).toHaveBeenCalledTimes(2); 

        // Let the retry fail too to clean up promise
        // Simulate failure on the second attempt
        if (mockWsInstance.onerror) {
             mockWsInstance.onerror(new Error('Retry failed'));
        }
        
        try {
            await connectPromise;
        } catch (e) {
            // Expected failure after retries
        }
    });
});
