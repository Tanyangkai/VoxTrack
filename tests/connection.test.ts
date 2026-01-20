import { EdgeSocket } from '../src/api/edge-socket';
import { WebSocket } from 'ws';

describe('EdgeSocket Connection', () => {
    let socket: EdgeSocket;

    beforeEach(() => {
        socket = new EdgeSocket();
    });

    afterEach(() => {
        socket.close();
    });

    it('should connect to Edge TTS service without 403 Forbidden error', async () => {
        try {
            await socket.connect();
            // If we reach here, connection was successful
            expect(true).toBe(true);
        } catch (error) {
            console.error('Connection failed:', error);
            // Fail if error contains 403
            const errorMessage = String(error);
            if (errorMessage.includes('403')) {
                throw new Error('Received 403 Forbidden: The Sec-MS-GEC token or User-Agent may be invalid.');
            }
            throw error;
        }
    }, 20000); // Increase timeout for network request
});
