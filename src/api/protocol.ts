export const EDGE_TTS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

export interface AudioMetadata {
    offset: number;
    duration: number;
    text: string;
    textOffset: number;
    wordLength: number;
    chunkIndex?: number;
}

interface EdgeMetadataTextObject {
    Text?: string;
    text?: string;
    Word?: string;
    Offset?: number;
    offset?: number;
    TextOffset?: number;
    textOffset?: number;
    Length?: number;
    length?: number;
    WordLength?: number;
    BoundaryType?: string;
}

export interface EdgeMetadataData {
    Duration?: number;
    duration?: number;
    text?: string | EdgeMetadataTextObject;
    Text?: string | EdgeMetadataTextObject;
    Offset?: number;
    offset?: number;
    TextOffset?: number;
    textOffset?: number;
    Word?: string;
    Length?: number;
    length?: number;
    WordLength?: number;
    [key: string]: unknown;
}

export interface EdgeMetadataItem {
    Type: string;
    Data: EdgeMetadataData;
}

export interface EdgeResponse {
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

            let textObj: EdgeMetadataTextObject;
            let isFlat = false;

            // Check if nested text object exists
            if (d.text && typeof d.text === 'object') {
                textObj = d.text;
                isFlat = false;
            } else if (d.Text && typeof d.Text === 'object') {
                textObj = d.Text;
                isFlat = false;
            } else {
                // If text/Text are strings or undefined, use d itself as the text object
                isFlat = true;
                textObj = {
                    Text: typeof d.Text === 'string' ? d.Text : undefined,
                    text: typeof d.text === 'string' ? d.text : undefined,
                    Word: d.Word,
                    Offset: d.Offset,
                    offset: d.offset,
                    TextOffset: d.TextOffset,
                    textOffset: d.textOffset,
                    Length: d.Length,
                    length: d.length,
                    WordLength: d.WordLength
                };
            }

            const word = (textObj.Text ?? textObj.text ?? textObj.Word ?? "") + "";

            let textOffset = 0;
            if (isFlat) {
                // In flat structure, 'Offset' is Audio Offset. Only accept explicit TextOffset.
                textOffset = textObj.TextOffset ?? textObj.textOffset ?? 0;
            } else {
                // In nested structure, 'Offset' is likely Text Offset relative to the phrase.
                textOffset = textObj.Offset ?? textObj.offset ?? textObj.TextOffset ?? 0;
            }

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
