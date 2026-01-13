import { SessionManager } from '../../src/utils/session-utils';

describe('SessionManager', () => {
    let manager: SessionManager;

    beforeEach(() => {
        manager = new SessionManager();
    });

    test('validates current session correctly', () => {
        manager.startNewSession("session1");
        expect(manager.isValid("session1")).toBe(true);
        expect(manager.isValid("session2")).toBe(false);
    });

    test('invalidates old sessions when new one starts', () => {
        manager.startNewSession("session1");
        manager.startNewSession("session2");
        expect(manager.isValid("session1")).toBe(false);
        expect(manager.isValid("session2")).toBe(true);
    });

    test('invalidates all sessions after clear', () => {
        manager.startNewSession("session1");
        manager.clear();
        expect(manager.isValid("session1")).toBe(false);
    });
});
