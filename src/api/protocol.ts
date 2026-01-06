export const EDGE_TTS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

export interface AudioMetadata {
    offset: number;
    duration: number;
    text: string;
    textOffset: number;
    wordLength: number;
}

export function parseMetadata(data: any): AudioMetadata[] {
    const results: AudioMetadata[] = [];

    if (!data?.Metadata || !Array.isArray(data.Metadata)) {
        return results;
    }

    for (const item of data.Metadata) {
        if (item.Type === "WordBoundary" && item.Data) {
            const d = item.Data;
            results.push({
                offset: d.Offset,
                duration: d.Duration,
                text: d.text?.Text || "",
                textOffset: d.text?.Offset || 0,
                wordLength: d.text?.Length || 0
            });
        }
    }

    return results;
}
