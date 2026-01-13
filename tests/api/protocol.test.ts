import { parseMetadata, EdgeResponse, isJunkMetadata } from '../../src/api/protocol';

describe('Protocol Layer', () => {
    describe('isJunkMetadata', () => {
        it('should identify SSML tags as junk', () => {
            expect(isJunkMetadata("<speak>")).toBe(true);
            expect(isJunkMetadata("prosody")).toBe(true);
            expect(isJunkMetadata("voice")).toBe(true);
            expect(isJunkMetadata("mstts")).toBe(true);
        });

        it('should identify HTML entities as junk', () => {
            expect(isJunkMetadata("gt")).toBe(true);
            expect(isJunkMetadata("&amp;")).toBe(true);
            expect(isJunkMetadata("nbsp")).toBe(true);
            expect(isJunkMetadata(";")).toBe(true);
        });

        it('should identify slashes and fragments as junk', () => {
            expect(isJunkMetadata("/")).toBe(true);
            expect(isJunkMetadata("\\")).toBe(true);
        });

        it('should identify legitimate words as NOT junk', () => {
            expect(isJunkMetadata("Hello")).toBe(false);
            expect(isJunkMetadata("世界")).toBe(false);
            expect(isJunkMetadata("123")).toBe(false);
        });
    });

    describe('parseMetadata', () => {
        it('should parse valid Edge TTS WordBoundary event', () => {
            // Mock raw data from Edge TTS
            const rawData: EdgeResponse = {
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
            const rawData: EdgeResponse = {
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

        it('should handle camelCase textOffset in Flat structure', () => {
            const rawData: EdgeResponse = {
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

            const result = parseMetadata(rawData);
            expect(result).toHaveLength(1);
            if (result[0]) {
                expect(result[0].textOffset).toBe(15);
            }
        });

        it('should handle missing textOffset by setting it to undefined (not 0)', () => {
            const rawData: EdgeResponse = {
                Metadata: [
                    {
                        Type: "WordBoundary",
                        Data: {
                            Offset: 1000,
                            Duration: 100,
                            text: {
                                Text: "NoOffset",
                                // TextOffset is missing here
                                Length: 8
                            }
                        }
                    }
                ]
            };

            const result = parseMetadata(rawData);
            expect(result).toHaveLength(1);
            expect(result[0]?.textOffset).toBeUndefined();
        });

        it('should return empty array for irrelevant events', () => {
            const rawData: EdgeResponse = {
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
