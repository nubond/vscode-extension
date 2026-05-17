/**
 * logger.ts
 * Module-level diagnostic logger used by every core helper that needs to
 * report a swallowed exception. Centralized so the catch sites don't have to
 * pull in `vscode` (which would create a circular dependency between the core
 * layer and the extension entry point) yet failures still surface in the same
 * "Language Service" output channel as extension.ts errors.
 *
 * Behavior:
 * - By default the logger is a no-op so tests stay quiet.
 * - extension.ts calls `setLogger(...)` during activation to wire it to the
 *   real `vscode.window.OutputChannel`.
 * - All log calls are themselves try/catch-protected — the logger must never
 *   become an error source itself, otherwise our catch blocks become unsafe.
 *
 * The contract every caller relies on: `logError` and `logWarn` will not
 * throw, no matter what the logger function does or what the error is.
 */

export type LoggerFn = (message: string) => void;

let logger: LoggerFn = () => { /* silent by default */ };

/** Wire a real logger (typically extension.ts's `log()` helper). */
export function setLogger(fn: LoggerFn): void {
    logger = fn;
}

/** Reset to the default no-op — used by tests to restore a clean state. */
export function resetLogger(): void {
    logger = () => { /* silent */ };
}

/**
 * Log an unexpected error swallowed by a catch block. Always pass a `context`
 * string so the output is greppable — e.g. "analyzeWithLanguageService.getProgram".
 * Never throws; if `err` is exotic, falls back to String() coercion.
 */
export function logError(context: string, err: unknown): void {
    try {
        let msg: string;
        if (err instanceof Error) {
            msg = err.stack ? `${err.message}\n${err.stack}` : err.message;
        } else if (err === undefined) {
            msg = '(no error object)';
        } else {
            try { msg = String(err); } catch { msg = '(unstringifiable error)'; }
        }
        logger(`[${context}] ${msg}`);
    } catch { /* a logger that throws must not bring callers down */ }
}

/** Log a warning that isn't tied to a specific exception. */
export function logWarn(context: string, message: string): void {
    try {
        logger(`[${context}] ${message}`);
    } catch { /* see logError */ }
}
