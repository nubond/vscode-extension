/**
 * workspace-language-service.ts
 * A long-lived `ts.LanguageService` per tsconfig group, owned by the extension
 * host. Replaces the previous `analyzeSourceText` path that re-parsed each
 * edit without a `TypeChecker` (and silently downgraded all inferred member
 * types to `any`). The LanguageService's incremental builder makes per-edit
 * re-analysis cheap (only changed files re-parsed) AND type-correct (full
 * `TypeChecker` available on every update).
 *
 * Note: this duplicates work tsserver is already doing. The fully consolidated
 * path is to RPC into the ts-plugin's existing LanguageService instead — see
 * P3 4.5 in DESIGN_ASSESSMENT.md. This file is the standalone-extension-host
 * version of that fix; consolidating with the ts-plugin is a follow-up.
 */

import * as ts from 'typescript';
import * as path from 'path';
import { resolveProgramGroups } from './decorator-analyzer';
import { logError } from './logger';

/** Normalize a path for use as a lookup key. The LanguageService internally
 *  canonicalizes paths to forward slashes, so callers passing native-separator
 *  paths (e.g. Windows `\`) won't otherwise hit our maps consistently. */
function normalizeKey(p: string): string {
    return p.replace(/\\/g, '/');
}

/** One LanguageService backing all files that share a single tsconfig.json. */
class LanguageServiceGroup {
    private fileVersions = new Map<string, number>();
    private fileContents = new Map<string, string>();
    private rootFiles = new Set<string>();
    readonly service: ts.LanguageService;

    constructor(options: ts.CompilerOptions, initialFiles: string[]) {
        for (const f of initialFiles) {
            const k = normalizeKey(f);
            this.rootFiles.add(k);
            this.fileVersions.set(k, 0);
        }

        // Host callbacks must never throw uncaught — TypeScript's
        // LanguageService catches some failures internally but a thrown
        // disk error from `readFile` or `fileExists` (permissions, locked
        // file on Windows, etc.) can put the LS in a degraded state and,
        // worse, leak through `getProgram()` to our analyzer call sites.
        // Wrap every disk-touching callback defensively.
        const safeFileExists = (p: string): boolean => {
            try { return ts.sys.fileExists(p); } catch { return false; }
        };
        const safeReadFile = (p: string, encoding?: string): string | undefined => {
            try { return ts.sys.readFile(p, encoding); } catch { return undefined; }
        };
        const safeReadDirectory = (...args: Parameters<typeof ts.sys.readDirectory>): string[] => {
            try { return ts.sys.readDirectory(...args); } catch { return []; }
        };
        const safeDirectoryExists = (p: string): boolean => {
            try { return ts.sys.directoryExists(p); } catch { return false; }
        };
        const safeGetDirectories = (p: string): string[] => {
            try { return ts.sys.getDirectories(p); } catch { return []; }
        };

        const host: ts.LanguageServiceHost = {
            getScriptFileNames: () => Array.from(this.rootFiles),
            // The version string changes whenever a file's content changes.
            // The LanguageService's incremental builder uses this to decide
            // which files actually need re-parsing on the next getProgram().
            getScriptVersion: f => String(this.fileVersions.get(normalizeKey(f)) ?? 0),
            getScriptSnapshot: f => {
                // Prefer in-memory content (for unsaved editor buffers we
                // explicitly fed via setFile); fall back to disk for everything
                // else (transitive imports, lib files, @types packages…).
                const inMemory = this.fileContents.get(normalizeKey(f));
                if (inMemory !== undefined) {
                    return ts.ScriptSnapshot.fromString(inMemory);
                }
                if (safeFileExists(f)) {
                    const text = safeReadFile(f);
                    if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
                }
                return undefined;
            },
            getCompilationSettings: () => options,
            getDefaultLibFileName: opts => {
                try { return ts.getDefaultLibFilePath(opts); } catch { return ''; }
            },
            fileExists: safeFileExists,
            readFile: safeReadFile,
            readDirectory: safeReadDirectory,
            directoryExists: safeDirectoryExists,
            getDirectories: safeGetDirectories,
            getCurrentDirectory: () => process.cwd(),
            useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
            getNewLine: () => ts.sys.newLine,
        };

        this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
    }

    /** Update or add a file's in-memory content; bumps version so the next
     *  `getProgram()` re-parses it. */
    setFile(filePath: string, content: string | undefined): void {
        const k = normalizeKey(filePath);
        this.rootFiles.add(k);
        if (content !== undefined) {
            this.fileContents.set(k, content);
        } else {
            // Caller is signalling "use disk content" — drop the in-memory
            // override so getScriptSnapshot reads from disk again.
            this.fileContents.delete(k);
        }
        this.fileVersions.set(k, (this.fileVersions.get(k) ?? 0) + 1);
    }

    removeFile(filePath: string): void {
        const k = normalizeKey(filePath);
        this.rootFiles.delete(k);
        this.fileContents.delete(k);
        this.fileVersions.delete(k);
    }

    has(filePath: string): boolean {
        return this.rootFiles.has(normalizeKey(filePath));
    }

    dispose(): void {
        this.service.dispose();
        this.rootFiles.clear();
        this.fileContents.clear();
        this.fileVersions.clear();
    }
}

/**
 * Workspace-wide registry of LanguageService groups, one per tsconfig.json.
 * Files are routed to their group by walking up to the nearest tsconfig
 * (memoized) — same logic the analyzer's `resolveProgramGroups` already uses.
 */
export class WorkspaceLanguageService {
    private groups = new Map<string, LanguageServiceGroup>();
    private fileToGroupKey = new Map<string, string>();

    /**
     * Build initial groups from a flat list of TS files. Each file is
     * assigned to the group keyed by its nearest tsconfig.json (or 'default'
     * for orphan files), using the same resolution `analyzeFiles` already
     * does so behavior is consistent across both code paths.
     */
    initialize(filePaths: string[]): void {
        // resolveProgramGroups can throw on a corrupt fs or unreadable
        // tsconfig — never let that propagate up to the extension activation,
        // which would disable our providers (and worse, leave the host with a
        // half-disposed state). Fall back to no groups; the per-file lazy
        // setFile path will still try to spin up groups individually later.
        let groupSpecs: ReturnType<typeof resolveProgramGroups>;
        try {
            groupSpecs = resolveProgramGroups(filePaths);
        } catch (err) {
            logError('WorkspaceLanguageService.initialize.resolveProgramGroups', err);
            return;
        }

        for (const spec of groupSpecs) {
            // Per-group try/catch: a single bad tsconfig must not prevent
            // other tsconfig groups from coming online. Without this, a
            // monorepo with one corrupt project file would lose IntelliSense
            // for every other project that's actually fine.
            try {
                // Use the first file's tsconfig path as the group key. The
                // grouping function already guarantees one entry per tsconfig.
                const key = this.deriveGroupKey(spec.files[0]);
                this.groups.set(key, new LanguageServiceGroup(spec.options, spec.files));
                for (const f of spec.files) {
                    this.fileToGroupKey.set(f, key);
                }
            } catch (err) {
                // This group is unusable — files in it will fall through to
                // the lazy `setFile`-driven code path on the next change.
                logError(`WorkspaceLanguageService.initialize.group(${spec.files[0]})`, err);
            }
        }
    }

    /** Update or add a file. Routes to the right group; creates a 'default'
     *  group on the fly if no group exists yet. */
    setFile(filePath: string, content: string | undefined): void {
        // Wrap the entire path so a corrupt project state can't propagate to
        // the file watcher / edit handler that called us. Failures here are
        // soft — the file simply isn't tracked by any LanguageService, and
        // analysis falls back to whatever the previous run produced.
        try {
            let key = this.fileToGroupKey.get(filePath);
            if (!key) {
                key = this.deriveGroupKey(filePath);
                this.fileToGroupKey.set(filePath, key);

                // If we don't have a group for this key yet (e.g. a brand-new
                // file under an as-yet-unseen tsconfig), spin one up using
                // `resolveProgramGroups` so options match the project.
                if (!this.groups.has(key)) {
                    const groupSpec = resolveProgramGroups([filePath])[0];
                    if (groupSpec) {
                        this.groups.set(key, new LanguageServiceGroup(groupSpec.options, []));
                    }
                }
            }
            this.groups.get(key)?.setFile(filePath, content);
        } catch (err) {
            logError(`WorkspaceLanguageService.setFile(${filePath})`, err);
        }
    }

    removeFile(filePath: string): void {
        // Called from a file watcher's delete event — must never throw, or
        // the watcher fails silently and subsequent deletes go unhandled.
        try {
            const key = this.fileToGroupKey.get(filePath);
            if (!key) return;
            this.groups.get(key)?.removeFile(filePath);
            this.fileToGroupKey.delete(filePath);
        } catch (err) {
            logError(`WorkspaceLanguageService.removeFile(${filePath})`, err);
        }
    }

    /** Return every active LanguageService — callers iterate to update each
     *  group's analyzer state on a workspace-wide refresh. */
    getAllLanguageServices(): ts.LanguageService[] {
        return Array.from(this.groups.values()).map(g => g.service);
    }

    /** Return the LanguageService for a specific file, or undefined if the
     *  file isn't tracked. Useful for targeted post-edit analysis. */
    getLanguageServiceForFile(filePath: string): ts.LanguageService | undefined {
        const key = this.fileToGroupKey.get(filePath);
        if (!key) return undefined;
        return this.groups.get(key)?.service;
    }

    dispose(): void {
        // Best-effort cleanup — do all groups even if one throws, so we don't
        // leak LanguageService instances on extension deactivation/restart.
        for (const group of this.groups.values()) {
            try {
                group.dispose();
            } catch (err) {
                // Worth knowing about — a failing dispose() means we're
                // leaking a LanguageService's internal AST cache.
                logError('WorkspaceLanguageService.dispose.group', err);
            }
        }
        this.groups.clear();
        this.fileToGroupKey.clear();
    }

    /** Resolve a file path to its tsconfig group key. Files that don't
     *  belong to any tsconfig share a single 'default' group. */
    private deriveGroupKey(filePath: string): string {
        const dir = path.dirname(filePath);
        const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
        return configPath ?? 'default';
    }
}
