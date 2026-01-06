export const EDGE_TTS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

export interface AudioMetadata {
    offset: number;
    duration: number;
    text: string;
    textOffset: number;
    wordLength: number;
}

interface EdgeMetadataData {
    Offset?: number;
    offset?: number;
    Duration?: number;
    duration?: number;
    Text?: string;
    text?: string | { Text?: string; text?: string; Word?: string; Offset?: number; offset?: number; TextOffset?: number; Length?: number; length?: number; WordLength?: number };
    Word?: string;
    Length?: number;
    length?: number;
    WordLength?: number;
    TextOffset?: number;
    [key: string]: any;
}

interface EdgeMetadataItem {
    Type: string;
    Data: EdgeMetadataData;
}

interface EdgeResponse {
    Metadata?: EdgeMetadataItem[];
}

export function parseMetadata(data: EdgeResponse): AudioMetadata[] {
    const results: AudioMetadata[] = [];

    if (!data?.Metadata || !Array.isArray(data.Metadata)) {
        return results;
    }

    for (const item of data.Metadata) {
        if (item.Type === "WordBoundary" && item.Data) {
            const d = item.Data;
            // The protocol is inconsistent. Check all known variations.
            const audioOffset = d.Offset ?? d.offset ?? 0;
            const audioDuration = d.Duration ?? d.duration ?? 0;
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const textObj: any = d.text ?? d.Text ?? d; // Fallback to Data itself if flat
            const word = (textObj.Text ?? textObj.text ?? textObj.Word ?? "") + "";
            const textOffset = textObj.Offset ?? textObj.offset ?? textObj.TextOffset ?? 0;
            const wordLength = textObj.Length ?? textObj.length ?? textObj.WordLength ?? word.length;
            
            if (word) {
                results.push({
                    offset: Number(audioOffset),
                    duration: Number(audioDuration),
                    text: word,
                    textOffset: Number(textOffset),
                    wordLength: Number(wordLength)
                });
            }
        }
    }

    return results;
}
