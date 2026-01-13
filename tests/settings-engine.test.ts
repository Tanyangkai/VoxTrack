import { VoxTrackSettings, DEFAULT_SETTINGS } from '../src/settings/setting-tab';

describe('Settings - Model/Engine Switching', () => {
    test('should support multiple TTS engines in settings', () => {
        const settings: VoxTrackSettings = {
            ...DEFAULT_SETTINGS,
            engine: 'openai', // Hypothetical new setting
            voice: 'shimmer'
        };
        expect(settings.engine).toBe('openai');
    });

    test('DEFAULT_SETTINGS should default to edge engine', () => {
        // We will need to add 'engine' to DEFAULT_SETTINGS
        expect(DEFAULT_SETTINGS).toHaveProperty('engine', 'edge');
    });
});
