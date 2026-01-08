import { parseMetadata } from '../../src/api/protocol';

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

            // Assuming parseMetadata returns an array of metadata
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = parseMetadata(rawData as any);
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

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = parseMetadata(rawData as any);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                offset: 9999999,
                duration: 50000,
                text: "Flat",
                textOffset: 42, // MUST be 42, not 9999999
                wordLength: 4
            });
        });

        it('should handle camelCase textOffset in Flat structure', () => {
            const rawData = {
                Metadata: [
                    {
                        Type: "WordBoundary",
                        Data: {
                            Offset: 12345,
                            Duration: 100,
                            text: "Camel", // lower case text key might imply flat if d.text is string
                            textOffset: 15,
                            WordLength: 5
                        }
                    }
                ]
            };
            // Note: In my parser logic:
            // d.text is "Camel" (string). typeof d.text is 'string' != 'object'.
            // d.Text is undefined.
            // textObj = d.
            // isFlat = true.
            // textOffset = d.TextOffset ?? d.textOffset
            
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = parseMetadata(rawData as any);
            expect(result).toHaveLength(1);
            if (result[0]) {
                expect(result[0].textOffset).toBe(15);
            }
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = parseMetadata(rawData as any);
            expect(result).toEqual([]);
        });
    });
});
