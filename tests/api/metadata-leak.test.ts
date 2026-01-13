import { EdgeSocket } from '../../src/api/edge-socket';
import { WebSocket } from 'ws';

jest.mock('ws');

describe('Metadata Leak Prevention', () => {
    let socket: EdgeSocket;
    let mockWsInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWsInstance = {
            send: jest.fn(),
            close: jest.fn(),
            readyState: 1,
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            ping: jest.fn()
        };
        (WebSocket as any).mockImplementation(() => mockWsInstance);
        (WebSocket as any).OPEN = 1;
        
        // Mock global crypto
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

    test('close() should nullify handlers to prevent stale events', async () => {
        const connectPromise = socket.connect();
        
        // Wait for async parts (crypto) to complete and WebSocket to be initialized
        await new Promise(resolve => setTimeout(resolve, 50));

        // Trigger open
        if (mockWsInstance.onopen) mockWsInstance.onopen();
        await connectPromise;

        expect(mockWsInstance.onmessage).not.toBeNull();
        
        socket.close();
        
        expect(mockWsInstance.onmessage).toBeNull();
        expect(mockWsInstance.onclose).toBeNull();
        expect(mockWsInstance.onerror).toBeNull();
        expect(mockWsInstance.close).toHaveBeenCalled();
    });
});