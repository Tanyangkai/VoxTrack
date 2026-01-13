/**
 * Logic to ensure only the latest session can execute.
 */
export class SessionManager {
    private currentSessionId: string | null = null;

    startNewSession(id: string): void {
        this.currentSessionId = id;
    }

    isValid(id: string): boolean {
        return this.currentSessionId === id;
    }

    clear(): void {
        this.currentSessionId = null;
    }
}
