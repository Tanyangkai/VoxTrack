export class FileLogger {
    private static isEnabled = true;

    /**
     * No longer needs to initialize file system adapter as we now log directly to console.
     */
    public static initialize(_app: unknown) {
        // No-op for compatibility
    }

    public static async log(message: string, data?: unknown) {
        if (!this.isEnabled) return;
        if (data !== undefined) {
            console.debug(`[VoxTrack] [INFO] ${message}`, data);
        } else {
            console.debug(`[VoxTrack] [INFO] ${message}`);
        }
    }

    public static async debug(message: string, data?: unknown) {
        if (!this.isEnabled) return;
        if (data !== undefined) {
            console.debug(`[VoxTrack] [DEBUG] ${message}`, data);
        } else {
            console.debug(`[VoxTrack] [DEBUG] ${message}`);
        }
    }

    public static async warn(message: string, data?: unknown) {
        if (!this.isEnabled) return;
        if (data !== undefined) {
            console.warn(`[VoxTrack] [WARN] ${message}`, data);
        } else {
            console.warn(`[VoxTrack] [WARN] ${message}`);
        }
    }

    public static async error(message: string, data?: unknown) {
        if (!this.isEnabled) return;
        if (data !== undefined) {
            console.error(`[VoxTrack] [ERROR] ${message}`, data);
        } else {
            console.error(`[VoxTrack] [ERROR] ${message}`);
        }
    }
}