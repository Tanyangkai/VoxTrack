import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { EDGE_TTS_URL } from './protocol';

export class EdgeSocket {
    private ws: WebSocket | null = null;
    private onMessageCallback: ((data: string | Buffer) => void) | null = null;

    onMessage(callback: (data: string | Buffer) => void) {
        this.onMessageCallback = callback;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const uuid = uuidv4().replace(/-/g, '');
            const url = `${EDGE_TTS_URL}?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`;


            console.log('[VoxTrack] Connecting to Edge TTS...');

            // @ts-ignore - Explicitly using Node WebSocket
            this.ws = new WebSocket(url, {
                headers: {
                    "Pragma": "no-cache",
                    "Cache-Control": "no-cache",
                    "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36 Edg/91.0.864.41"
                }
            });

            this.ws!.addEventListener('open', () => {
                console.log('[VoxTrack] WebSocket Connected');
                this.sendConfig();
                resolve();
            });

            this.ws!.addEventListener('message', (event: any) => {
                if (this.onMessageCallback) {
                    this.onMessageCallback(event.data);
                }
            });

            this.ws!.addEventListener('error', (err: any) => {
                console.error('[VoxTrack] WebSocket Error Event:', err);
                if (err.error) console.error('[VoxTrack] Underlying Error:', err.error);
                if (err.message) console.error('[VoxTrack] Error Message:', err.message);
                reject(err);
            });
        });
    }

    private sendConfig() {
        if (!this.ws) return;
        // Basic configuration to enable WordBoundaries
        const configMsg = `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
        this.ws.send(configMsg);
    }

    async sendSSML(ssml: string, requestId: string): Promise<void> {
        if (!this.ws) throw new Error("Socket not connected");

        const timestamp = new Date().toString();
        const msg = `X-RequestId: ${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}\r\nPath:ssml\r\n\r\n${ssml}`;

        this.ws.send(msg);
    }
}
