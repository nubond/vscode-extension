/**
 * ts-plugin/index.ts
 * TypeScript Language Service Plugin.
 * Intercepts findReferences, findRenameLocations, getDefinitionAndBoundSpan
 * to include HTML template usages of TS class members.
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { DecoratorAnalyzer, TemplateAssociation, ClassMember } from '../core/decorator-analyzer';
import { setLogger as setCoreLogger } from '../core/logger';

let analyzer: DecoratorAnalyzer;
let lastAnalysisVersion: string | undefined;
/** tsserver's logger, captured during create(). Used to surface plugin errors
 *  in the TS Server log so they're greppable when debugging. */
let tsServerLogger: ts.server.Logger | undefined;

/**
 * Plugin-local diagnostic log. Routes through tsserver's logger when available
 * so messages land in the user's TS Server log file (greppable via the
 * `nubond.trace.server` setting + TypeScript: Open TS Server Log command).
 * Falls back to console.error so messages aren't entirely lost when tsserver
 * gives us no logger. Never throws.
 */
function pluginLog(context: string, err: unknown): void {
    try {
        const msg = err instanceof Error
            ? (err.stack ? `${err.message}\n${err.stack}` : err.message)
            : String(err);
        const line = `[nuBond ts-plugin][${context}] ${msg}`;
        if (tsServerLogger) {
            try { tsServerLogger.msg(line, ts.server.Msg.Err); return; } catch { /* fall through */ }
        }
        // Fallback: console.error appears in tsserver's stderr stream.
        try { console.error(line); } catch { /* nothing left */ }
    } catch { /* a logger that throws must not crash callers */ }
}

function init(_modules: { typescript: typeof ts }): ts.server.PluginModule {
    // tsserver invokes init() exactly once per plugin load. Wrap defensively
    // so even a syntax error in the module above can't propagate up and
    // disable the entire tsserver process for the user.
    try {
        return { create: safeCreate, getExternalFiles: safeGetExternalFiles };
    } catch (err) {
        pluginLog('init', err);
        // Return a no-op plugin module — tsserver continues with native
        // language support unchanged. Our `create` returns the unmodified
        // LanguageService so tsserver's behavior is untouched.
        return {
            create: (info: ts.server.PluginCreateInfo) => info.languageService,
            getExternalFiles: () => [],
        };
    }
}

/** Wrapper around `create` that guarantees tsserver never sees an exception
 *  from us, even if `create` itself somehow throws before its own try/catch. */
function safeCreate(info: ts.server.PluginCreateInfo): ts.LanguageService {
    try {
        return create(info);
    } catch (err) {
        pluginLog('safeCreate', err);
        return info?.languageService;
    }
}

/** Wrapper around `getExternalFiles` — must never throw. tsserver calls this
 *  on every project update; an uncaught exception could crash tsserver. */
function safeGetExternalFiles(project: ts.server.Project): string[] {
    try {
        return getExternalFiles(project);
    } catch (err) {
        pluginLog('safeGetExternalFiles', err);
        return [];
    }
}

function getExternalFiles(_project: ts.server.Project): string[] {
    // Return empty — HTML files must NOT be added to the TypeScript project.
    // Adding them causes TS to attempt parsing HTML as TypeScript, which
    // interferes with highlighting and diagnostics in real .ts files.
    // The findRenameLocations override reads HTML files on demand instead.
    return [];
}

function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const tsLS = info?.languageService;
    const project = info?.project;

    // Defend against tsserver passing us a malformed `info` object — should
    // never happen, but if it does we'd otherwise blow up in `createProxy`
    // and break native TS support for the entire workspace.
    if (!tsLS || !project) {
        pluginLog('create.preconditions', `info?.languageService=${!!tsLS} info?.project=${!!project}`);
        return tsLS!;
    }

    // Capture tsserver's logger so subsequent pluginLog() calls land in the
    // TS Server log file. Also wire it into the shared core logger so any
    // decorator-analyzer / workspace-LS errors invoked from the plugin path
    // route to the same place.
    try {
        tsServerLogger = info.project.projectService.logger;
        if (tsServerLogger) {
            setCoreLogger(msg => {
                try { tsServerLogger!.msg(`[nuBond core] ${msg}`, ts.server.Msg.Err); }
                catch { try { console.error(`[nuBond core] ${msg}`); } catch { /* ignore */ } }
            });
        }
    } catch (err) { pluginLog('create.captureLogger', err); }

    // If anything below throws, fall back to the untouched TS language service
    // so a broken plugin can never take down tsserver for the user.
    try {
        analyzer = new DecoratorAnalyzer();
    } catch (err) {
        pluginLog('create.newDecoratorAnalyzer', err);
        return tsLS;
    }

    let proxy: ts.LanguageService;
    try {
        proxy = createProxy(tsLS);
    } catch (err) {
        // Proxy creation should never fail (it's a simple object copy) —
        // but if it does, return the untouched LS so tsserver keeps working.
        pluginLog('create.createProxy', err);
        return tsLS;
    }

    try {
        refreshAnalysis(project);
    } catch (err) {
        // Project may not be ready yet — will retry on first use.
        pluginLog('create.initialRefreshAnalysis', err);
    }

    // Note: findReferences is NOT overridden — the extension's CodeLens provider
    // already shows "N template references" separately. Overriding findReferences would
    // inflate the standard "N references" CodeLens count with duplicate template refs.

    // --- Override: findRenameLocations ---
    proxy.findRenameLocations = (
        fileName: string,
        position: number,
        findInStrings: boolean,
        findInComments: boolean,
        preferences?: ts.UserPreferences | boolean
    ): readonly ts.RenameLocation[] | undefined => {
        const originalLocations = tsLS.findRenameLocations(fileName, position, findInStrings, findInComments, preferences as any) ?? [];

        try {
            if (!isTypeScriptFile(fileName)) return originalLocations.length ? originalLocations : undefined;

            refreshAnalysis(project);

            const memberName = getMemberNameAtPosition(fileName, position, project);
            if (!memberName) return originalLocations.length ? originalLocations : undefined;

            const htmlRefs = findHtmlMemberRefs(fileName, memberName, project);
            if (htmlRefs.length === 0) return originalLocations.length ? originalLocations : undefined;

            const htmlRenames: ts.RenameLocation[] = htmlRefs.map(r => ({
                fileName: r.fileName,
                textSpan: r.textSpan,
                ...(r.contextSpan ? { contextSpan: r.contextSpan } : {}),
                prefixText: '',
                suffixText: '',
            }));

            return [...originalLocations, ...htmlRenames];
        } catch (err) {
            pluginLog(`findRenameLocations.override(${fileName})`, err);
            return originalLocations.length ? originalLocations : undefined;
        }
    };

    return proxy;
}

function refreshAnalysis(project: ts.server.Project): void {
    // Project version is an O(1) hash that bumps whenever any file changes.
    // Skipping re-analysis when it hasn't changed avoids per-request overhead
    // on hot paths like findRenameLocations.
    const currentVersion = (project as any).getProjectVersion?.() as string | undefined;
    if (currentVersion !== undefined && currentVersion === lastAnalysisVersion) return;

    // Reuse the same analyzer instance across calls and let the LanguageService
    // path do incremental updates: only files whose `ts.SourceFile` reference
    // changed since the previous call are re-analyzed. Critically, the
    // LanguageService gives us a working `TypeChecker` on every update — so
    // inferred member types stay correct as the user edits, instead of
    // collapsing to `any` (the regression we shipped with the old
    // `analyzeSourceText` path).
    try {
        analyzer.analyzeWithLanguageService(project.getLanguageService());
        lastAnalysisVersion = currentVersion;
    } catch (err) {
        // A single bad file shouldn't poison subsequent calls. Leave
        // lastAnalysisVersion unchanged so we retry on the next request.
        pluginLog('refreshAnalysis', err);
    }
}

/**
 * Find all references to a member name in HTML templates associated with a TS file.
 * Uses direct text search on the raw file content for correct offsets.
 */
function findHtmlMemberRefs(
    tsFileName: string,
    memberName: string,
    project: ts.server.Project
): ts.ReferencedSymbolEntry[] {
    const result: ts.ReferencedSymbolEntry[] = [];
    const associations = analyzer.getAssociationsForTs(tsFileName);

    for (const assoc of associations) {
        if (!assoc.htmlFilePath) continue;

        // Read file content exactly as the TS server sees it
        const content = readFileContent(assoc.htmlFilePath, project);
        if (!content) continue;

        // Direct text search for "this.<memberName>" with word boundary
        const searchStr = 'this.' + memberName;
        let searchFrom = 0;
        while (true) {
            const idx = content.indexOf(searchStr, searchFrom);
            if (idx === -1) break;

            // Check word boundary after the match
            const afterIdx = idx + searchStr.length;
            if (afterIdx < content.length && /\w/.test(content[afterIdx])) {
                searchFrom = idx + 1;
                continue;
            }

            // The member name starts after "this."
            const memberStart = idx + 5;

            // Compute line context span
            const lineStart = content.lastIndexOf('\n', idx) + 1;
            let lineEnd = content.indexOf('\n', afterIdx);
            if (lineEnd === -1) lineEnd = content.length;
            // Strip trailing \r if present
            const lineEndClean = (lineEnd > 0 && content[lineEnd - 1] === '\r') ? lineEnd - 1 : lineEnd;

            result.push({
                fileName: assoc.htmlFilePath!,
                textSpan: {
                    start: memberStart,
                    length: memberName.length,
                },
                contextSpan: {
                    start: lineStart,
                    length: lineEndClean - lineStart,
                },
                isWriteAccess: false,
                isDefinition: false,
            });

            searchFrom = afterIdx;
        }
    }

    return result;
}

function readFileContent(filePath: string, project: ts.server.Project): string | null {
    try {
        // Try TS server's script info first — this has the exact content the server uses
        const scriptInfo = project.projectService.getScriptInfo(filePath);
        if (scriptInfo) {
            const snapshot = scriptInfo.getSnapshot();
            return snapshot.getText(0, snapshot.getLength());
        }
        // Fallback: read from disk
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
    } catch {
        // ignore
    }
    return null;
}

function getMemberNameAtPosition(fileName: string, position: number, project: ts.server.Project): string | null {
    const program = project.getLanguageService().getProgram();
    if (!program) return null;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return null;

    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return null;

    const parent = node.parent;
    if (
        ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent)
    ) {
        if (parent.name === node) {
            const classNode = parent.parent;
            if (ts.isClassDeclaration(classNode)) {
                const assocs = analyzer.getAssociationsForTs(fileName);
                if (assocs.some(a => a.className === classNode.name?.text)) {
                    return node.text;
                }
            }
        }
    }

    if (ts.isParameter(parent) && ts.isConstructorDeclaration(parent.parent)) {
        const mods = ts.getModifiers(parent);
        if (mods?.some(m => m.kind === ts.SyntaxKind.PublicKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
            return node.text;
        }
    }

    return null;
}

function findNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
    function find(node: ts.Node): ts.Node | undefined {
        if (position >= node.getStart() && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
        return undefined;
    }
    return find(sourceFile);
}

function isTypeScriptFile(fileName: string): boolean {
    return fileName.endsWith('.ts') || fileName.endsWith('.tsx');
}

function createProxy(ls: ts.LanguageService): ts.LanguageService {
    const proxy: any = {};
    for (const key of Object.keys(ls)) {
        // Forward every LS method transparently. We do NOT wrap these in
        // try/catch — the TypeScript server expects native TS errors to
        // surface, and swallowing them would hide genuine tsserver bugs.
        // Overrides (findRenameLocations) have their own
        // try/catch that falls back to the original result on failure.
        proxy[key] = (...args: any[]) => (ls as any)[key](...args);
    }
    return proxy as ts.LanguageService;
}

export = init;
