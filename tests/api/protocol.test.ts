import { parseMetadata, AudioMetadata } from '../../src/api/protocol';

describe('Protocol Layer', () => {
    describe('parseMetadata', () => {
        it('should parse valid Edge TTS WordBoundary event', () => {
            // Mock raw data from Edge TTS
            const rawData = {
                Metadata: [
                    {
                        Type: "WordBoundary",
                        Data: {
                            Offset: 1230000,
                            Duration: 50000,
                            text: {
                                Text: "Hello",
                                Length: 5,
                                BoundaryType: "Word"
                            }
                        }
                    }
                ]
            };

            const expected: AudioMetadata[] = [{
                offset: 1230000,
                duration: 50000,
                text: "Hello",
                textOffset: 0, // Note: This might need calculation logic in the parser if not provided
                wordLength: 5
            }];

            // Assuming parseMetadata returns an array of metadata
            const result = parseMetadata(rawData);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                offset: 1230000,
                duration: 50000,
                text: "Hello",
                wordLength: 5
            });
        });

        it('should parse Flat Edge TTS metadata structure correctly', () => {
            const rawData = {
                Metadata: [
                    {
                        Type: "WordBoundary",
                        Data: {
                            Offset: 9999999, // Audio Offset (Should NOT be used as TextOffset)
                            Duration: 50000,
                            Text: "Flat",
                            TextOffset: 42,
                            WordLength: 4
                        }
                    }
                ]
            };

            const result = parseMetadata(rawData);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                offset: 9999999,
                duration: 50000,
                text: "Flat",
                textOffset: 42, // MUST be 42, not 9999999
                wordLength: 4
            });
        });

        it('should return empty array for irrelevant events', () => {
            const rawData = {
                Metadata: [
                    {
                        Type: "SessionEnd",
                        Data: {}
                    }
                ]
            };
            const result = parseMetadata(rawData);
            expect(result).toEqual([]);
        });
    });
});
