import { WebSocket, ClientOptions } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EDGE_TTS_URL } from './protocol';
import { FileLogger } from '../utils/logger';

export class EdgeSocket {
    private ws: WebSocket | null = null;
    private onMessageCallback: ((data: string | Uint8Array) => void) | null = null;
    private onCloseCallback: ((code?: number, reason?: string) => void) | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private readonly TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

    onMessage(callback: (data: string | Uint8Array) => void) {
        this.onMessageCallback = callback;
    }

    onClose(callback: (code?: number, reason?: string) => void) {
        this.onCloseCallback = callback;
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // console.debug('[VoxTrack] Sending heartbeat...'); // Debug log
                if (typeof this.ws.ping === 'function') {
                    this.ws.ping();
                } else {
                    // Fallback for environments without ping (e.g. Native WebSocket)
                    this.sendConfig();
                }
            }
        }, 15000); // Send ping every 15 seconds to keep connection alive
        
        if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
            this.heartbeatTimer.unref();
        }
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private async generateSecMsGec(): Promise<string> {
        const WIN_EPOCH = 11644473600n;
        let ticks = BigInt(Math.floor(Date.now() / 1000));
        ticks += WIN_EPOCH;
        ticks -= ticks % 300n;
        ticks *= 10000000n;

        const strToHash = `${ticks}${this.TRUSTED_CLIENT_TOKEN}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(strToHash);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        return hashHex;
    }

    private getTimestamp(): string {
        const date = new Date();
        return date.toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
    }

    async connect(retries = 5, delay = 1000): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        try {
            const uuid = uuidv4().replace(/-/g, '');
            const secMsGec = await this.generateSecMsGec();
            const url = `${EDGE_TTS_URL}?TrustedClientToken=${this.TRUSTED_CLIENT_TOKEN}&ConnectionId=${uuid}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68`;

            return new Promise((resolve, reject) => {
                try {
                    this.ws = new WebSocket(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
                            'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
                        }
                    } as ClientOptions);
                    this.ws.binaryType = 'arraybuffer';

                    this.ws.onopen = () => {
                        this.startHeartbeat();
                        this.sendConfig();
                        resolve();
                    };

                    this.ws.onmessage = (ev: { data: string | ArrayBuffer; type: string; target: WebSocket }) => {
                        if (this.onMessageCallback) {
                            let data: string | Uint8Array;
                            if (typeof ev.data === 'string') {
                                data = ev.data;
                            } else {
                                data = new Uint8Array(ev.data);
                            }
                            this.onMessageCallback(data);
                        }
                    };

                    this.ws.onerror = (err) => {
                        void (async () => {
                            await FileLogger.error(`[VoxTrack] WebSocket Error (Retries left: ${retries})`, err);

                            if (retries > 0) {
                                this.ws = null;
                                const nextDelay = Math.min(delay * 2, 10000); // Cap at 10 seconds
                                await new Promise(r => setTimeout(r, delay));
                                try {
                                    await this.connect(retries - 1, nextDelay);
                                    resolve();
                                } catch (e) {
                                    reject(e instanceof Error ? e : new Error(String(e)));
                                }
                            } else {
                                reject(err instanceof Error ? err : new Error("WebSocket connection failed after retries"));
                            }
                        })();
                    };

                    this.ws.onclose = (ev: { code: number; reason: string }) => {
                        this.stopHeartbeat();
                        if (this.onCloseCallback) {
                            this.onCloseCallback(ev.code, ev.reason);
                        }
                        this.ws = null;
                    };
                } catch (wsError) {
                    reject(wsError instanceof Error ? wsError : new Error(String(wsError)));
                }
            });
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private sendConfig() {
        if (!this.ws) return;
        const config = {
            context: {
                synthesis: {
                    audio: {
                        metadataoptions: {
                            sentenceBoundaryEnabled: false,
                            wordBoundaryEnabled: true
                        },
                        outputFormat: "audio-24khz-48kbitrate-mono-mp3"
                    }
                }
            }
        };
        // Ensure exact trailing newline for config message and send as string (Text Frame)
        const configMsg = `X-Timestamp:${this.getTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}\r\n`;
        this.ws.send(configMsg);
    }

    sendSSML(ssml: string, requestId: string): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Socket not connected");

        const timestamp = this.getTimestamp();
        // Append 'Z' to timestamp as in original code, and send as string
        const msg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`;
        this.ws.send(msg);
        return Promise.resolve();
    }

    close(): void {
        this.stopHeartbeat();
        if (this.ws) {
            // Nullify handlers to prevent pending events from firing after close()
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
        }
    }
}
