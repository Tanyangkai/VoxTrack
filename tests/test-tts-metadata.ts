
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// --- CONSTANTS ---
const EDGE_TTS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

// --- HELPERS ---
function getTimestamp() {
    const date = new Date();
    return date.toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

async function generateSecMsGec() {
    const WIN_EPOCH = 11644473600n;
    let ticks = BigInt(Math.floor(Date.now() / 1000));
    ticks += WIN_EPOCH;
    ticks -= ticks % 300n;
    ticks *= 10000000n;

    const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
    // Use Node's crypto
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(strToHash).digest('hex').toUpperCase();
    return hash;
}

// --- MAIN TEST ---
async function runTest() {
    const text = "1.定义：审美是人类通过感知过滤，对事物呈现出的和谐、秩序或独特性进行价值评价的能力。它不只是看漂亮与否，而是大脑在识别高品质信息。就像舌头能瞬间分辨出美食还是腐肉，审美是精神上的味觉，帮我们从混乱的世界中筛选出那些具有生命力、协调感和深层逻辑的事物。\n\n识别出问题是否值得解决？\n识别出问题的解决方案是否足够完美？\n\n2.跨界迁移\n\n逻辑提取：识别事物内部规律与外部表现的高度统一，并将其转化为优选信号的评估机制。\n\n1. 生物演化：雄孔雀开屏。雌孔雀的审美其实是在检测对方的基因健康度，繁复对称的羽毛是无病害、高能量的视觉证明，审美在这里变成了生物生存质量的质检仪。\n2. ";

    const ssml = `
    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>
        <voice name='zh-CN-XiaoxiaoNeural'>
            <prosody rate='0%' pitch='0%'>
                ${text}
            </prosody>
        </voice>
    </speak>`;

    const uuid = uuidv4().replace(/-/g, '');
    const secMsGec = await generateSecMsGec();
    const url = `${EDGE_TTS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${uuid}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68`;

    console.log("Connecting to Edge TTS...");
    const ws = new WebSocket(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
            'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
        }
    });

    ws.on('open', () => {
        console.log("Connected.");

        // Send Config
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
        const configMsg = `X-Timestamp:${getTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}\r\n`;
        ws.send(configMsg);

        // Send SSML
        const requestId = uuidv4().replace(/-/g, '');
        const msg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${getTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(msg);
        console.log("SSML Sent.");
    });

    let metadataCount = 0;
    let audioBytes = 0;

    // Track text covered
    let lastWord = "";
    let lastOffset = 0;

    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            // It's audio or binary metadata
            const buffer = data as Buffer;
            const headerLen = buffer.readUInt16BE(0);
            const header = buffer.subarray(2, 2 + headerLen).toString();

            if (header.includes("Path:audio")) {
                audioBytes += buffer.length - (2 + headerLen);
            } else {
                // console.log("Binary Header:", header);
            }
        } else {
            const text = data.toString();
            if (text.includes("Path:turn.end")) {
                console.log("\nTurn End Received.");
                console.log(`Total Audio Bytes: ${audioBytes}`);
                console.log(`Total Metadata Events: ${metadataCount}`);
                console.log(`Last Word: "${lastWord}" at offset ${lastOffset / 10000}ms`);
                ws.close();
                process.exit(0);
            } else if (text.includes("Path:audio.metadata")) {
                // Parse Metadata
                const jsonStr = text.split("\r\n\r\n")[1];
                try {
                    const json = JSON.parse(jsonStr);
                    if (json.Metadata) {
                        for (const item of json.Metadata) {
                            if (item.Type === "WordBoundary") {
                                metadataCount++;
                                const d = item.Data;
                                const word = d.text?.Text || d.text || d.Text || d.Word || "";
                                const offset = d.Offset ?? d.offset ?? 0;

                                lastWord = word;
                                lastOffset = offset;

                                // Print words around the problematic area
                                if (word.includes("和") || word.includes("谐") || word.includes("秩") || word.includes("最")) {
                                    console.log(`Match: "${word}" at ${offset / 10000}ms`);
                                }

                                // Also print every 10th word to show progress
                                if (metadataCount % 10 === 0) {
                                    // console.log(`Progress: "${word}" at ${offset/10000}ms`);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("JSON Parse Error", e);
                }
            }
        }
    });

    ws.on('close', () => {
        console.log("Connection closed.");
    });

    ws.on('error', (err) => {
        console.error("Websocket Error", err);
    });
}

runTest();
