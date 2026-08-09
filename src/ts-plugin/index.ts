/**
 * ts-plugin/index.ts
 * TypeScript Language Service Plugin.
 * Overrides `findRenameLocations` to include HTML template usages of TS class
 * members. (findReferences is deliberately NOT overridden — see the note in
 * `create()`. `getExternalFiles` deliberately returns [] — see its comment.)
 *
 * HTML rename spans are computed by PARSING the template (same parser the
 * extension providers use), so only real binding expressions are edited —
 * never prose, comments, <script> content, or '@'-constant literals.
 *
 * Offsets are computed from DISK content, and tsserver's offset→position
 * conversion also reads disk — so a rename into an HTML file with unsaved
 * editor changes would land at stale positions and corrupt the buffer. The
 * extension pushes the set of dirty HTML files via `configurePlugin`
 * (`onConfigurationChanged` below); those files are skipped (fail-safe:
 * omitted from the rename rather than edited at wrong offsets).
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import { DecoratorAnalyzer, isParameterProperty } from '../core/decorator-analyzer';
import { parseTemplate, isEvaluatedBinding } from '../core/template-parser';
import { parseExpression } from '../core/expression-parser';
import { getAbsoluteMemberRange } from '../core/utils';
import { setLogger as setCoreLogger } from '../core/logger';

/**
 * Per-project analysis state. tsserver calls `create()` once per project —
 * module-level singletons made every project share (and clobber) one
 * analyzer, so in multi-project workspaces whichever project asked last
 * owned the analysis and the version-skip check compared versions across
 * unrelated projects. WeakMap keys release state when tsserver drops a project.
 */
interface ProjectState {
    analyzer: DecoratorAnalyzer;
    lastAnalysisVersion?: string;
}
const projectStates = new WeakMap<ts.server.Project, ProjectState>();

function getProjectState(project: ts.server.Project): ProjectState {
    let state = projectStates.get(project);
    if (!state) {
        state = { analyzer: new DecoratorAnalyzer() };
        projectStates.set(project, state);
    }
    return state;
}

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

/**
 * HTML files currently open with UNSAVED changes in the editor, pushed by the
 * extension via `configurePlugin('ts-plugin', { dirtyHtmlFiles: [...] })`.
 * Keys are normalized (lowercase, forward slashes). Rename locations are
 * never produced for these files — their disk content (which both our offset
 * computation and tsserver's offset→position conversion read) is stale, so
 * edits would land at wrong positions. When the extension isn't active the
 * set stays empty and behavior degrades to the pre-sync state.
 */
const dirtyHtmlFiles = new Set<string>();

function normalizeHtmlKey(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

function onConfigurationChanged(config: unknown): void {
    // tsserver forwards arbitrary JSON from the extension — never trust its
    // shape, and never throw (a throw here would surface inside tsserver).
    try {
        dirtyHtmlFiles.clear();
        const files = (config as { dirtyHtmlFiles?: unknown })?.dirtyHtmlFiles;
        if (Array.isArray(files)) {
            for (const f of files) {
                if (typeof f === 'string') dirtyHtmlFiles.add(normalizeHtmlKey(f));
            }
        }
    } catch (err) {
        pluginLog('onConfigurationChanged', err);
    }
}

function init(_modules: { typescript: typeof ts }): ts.server.PluginModule {
    // tsserver invokes init() exactly once per plugin load. Wrap defensively
    // so even a syntax error in the module above can't propagate up and
    // disable the entire tsserver process for the user.
    try {
        return { create: safeCreate, getExternalFiles: safeGetExternalFiles, onConfigurationChanged };
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
    let state: ProjectState;
    try {
        state = getProjectState(project);
    } catch (err) {
        pluginLog('create.getProjectState', err);
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

            const member = getMemberAtPosition(fileName, position, project, state.analyzer);
            if (!member) return originalLocations.length ? originalLocations : undefined;

            const htmlRefs = findHtmlMemberRefs(member, state.analyzer);
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
    const state = getProjectState(project);

    // Project version is an O(1) hash that bumps whenever any file changes.
    // Skipping re-analysis when it hasn't changed avoids per-request overhead
    // on hot paths like findRenameLocations. Tracked per project — comparing
    // versions across projects forced spurious full refreshes.
    const currentVersion = (project as any).getProjectVersion?.() as string | undefined;
    if (currentVersion !== undefined && currentVersion === state.lastAnalysisVersion) return;

    // Reuse the project's analyzer instance across calls and let the
    // LanguageService path do incremental updates: only files whose
    // `ts.SourceFile` reference changed since the previous call are
    // re-analyzed. Critically, the LanguageService gives us a working
    // `TypeChecker` on every update — so inferred member types stay correct
    // as the user edits, instead of collapsing to `any` (the regression we
    // shipped with the old `analyzeSourceText` path).
    try {
        const reanalyzed = state.analyzer.analyzeWithLanguageService(project.getLanguageService());
        // `undefined` = the analysis never ran (program/checker unavailable).
        // Stamping the version anyway would suppress re-analysis until the
        // NEXT project change — rename requests in between would see stale
        // (or empty) association data.
        if (reanalyzed !== undefined) {
            state.lastAnalysisVersion = currentVersion;
        }
    } catch (err) {
        // A single bad file shouldn't poison subsequent calls. Leave
        // lastAnalysisVersion unchanged so we retry on the next request.
        pluginLog('refreshAnalysis', err);
    }
}

/** A member rename target: the identifier plus its declaration coordinates. */
interface MemberRenameTarget {
    name: string;
    /** Absolute path of the file declaring the member. */
    declFilePath: string;
    /** Offset of the member NAME identifier in the declaring file. */
    declOffset: number;
}

/**
 * Find all references to a member in the HTML templates of every association
 * whose class shares the member's DECLARATION — the class itself plus any
 * subclass that inherits it. The template is PARSED (same parser the
 * extension providers use): only member references inside evaluated binding
 * expressions match, so prose, comments, <script> content, and '@'-constant
 * literals are never rewritten (the previous raw text search edited them all).
 */
function findHtmlMemberRefs(
    member: MemberRenameTarget,
    analyzer: DecoratorAnalyzer
): ts.ReferencedSymbolEntry[] {
    const result: ts.ReferencedSymbolEntry[] = [];
    const associations = analyzer.getAssociationsWithMember(member.name, member.declFilePath, member.declOffset);

    const visitedHtml = new Set<string>();
    for (const assoc of associations) {
        if (!assoc.htmlFilePath) continue;
        const htmlKey = normalizeHtmlKey(assoc.htmlFilePath);
        if (visitedHtml.has(htmlKey)) continue;
        visitedHtml.add(htmlKey);

        // The editor buffer for this template has unsaved changes — disk
        // offsets (ours AND tsserver's position conversion) would be stale.
        // Omit the file rather than corrupt it; the extension keeps this set
        // current via configurePlugin.
        if (dirtyHtmlFiles.has(htmlKey)) continue;

        const content = readFileContent(assoc.htmlFilePath);
        if (!content) continue;

        const parsed = parseTemplate(content);
        for (const binding of parsed.allBindings) {
            if (!isEvaluatedBinding(binding)) continue;
            const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
            for (const ref of exprInfo.memberReferences) {
                if (ref.rootMember !== member.name) continue;

                const range = getAbsoluteMemberRange(binding, ref);

                // Compute line context span
                const lineStart = content.lastIndexOf('\n', range.start) + 1;
                let lineEnd = content.indexOf('\n', range.end);
                if (lineEnd === -1) lineEnd = content.length;
                // Strip trailing \r if present
                const lineEndClean = (lineEnd > 0 && content[lineEnd - 1] === '\r') ? lineEnd - 1 : lineEnd;

                result.push({
                    fileName: assoc.htmlFilePath,
                    textSpan: {
                        start: range.start,
                        length: member.name.length,
                    },
                    contextSpan: {
                        start: lineStart,
                        length: lineEndClean - lineStart,
                    },
                    isWriteAccess: false,
                    isDefinition: false,
                });
            }
        }
    }

    return result;
}

function readFileContent(filePath: string): string | null {
    // HTML templates have no tsserver ScriptInfo (getExternalFiles returns [])
    // — disk is the only source. Files with dirty editor buffers are excluded
    // by the caller before this is reached.
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
    } catch {
        // ignore
    }
    return null;
}

function getMemberAtPosition(fileName: string, position: number, project: ts.server.Project, analyzer: DecoratorAnalyzer): MemberRenameTarget | null {
    const languageService = project.getLanguageService();
    const program = languageService.getProgram();
    if (!program) return null;

    const direct = memberDeclarationAt(program, fileName, position, analyzer);
    if (direct) return direct;

    // Rename can be initiated at a USAGE site (`this.foo` in a method body) —
    // arguably the more common gesture. Resolve to the declaration and re-run
    // the declaration checks there; without this, usage-site renames updated
    // all of TS but silently left every template on the old name (exactly the
    // breakage this plugin exists to prevent).
    let definitions: readonly ts.DefinitionInfo[] | undefined;
    try {
        definitions = languageService.getDefinitionAtPosition(fileName, position);
    } catch {
        definitions = undefined;
    }
    if (!definitions) return null;
    for (const def of definitions) {
        if (!isTypeScriptFile(def.fileName)) continue;
        const viaDeclaration = memberDeclarationAt(program, def.fileName, def.textSpan.start, analyzer);
        if (viaDeclaration) return viaDeclaration;
    }
    return null;
}

/**
 * The member rename target when the identifier at `position` IS a member
 * declaration name (property/method/accessor or constructor parameter
 * property) backed by some association's member list; null otherwise.
 */
function memberDeclarationAt(program: ts.Program, fileName: string, position: number, analyzer: DecoratorAnalyzer): MemberRenameTarget | null {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return null;

    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return null;

    // Some association's member list must be backed by exactly this
    // declaration (name + file + name-offset). This covers members of
    // decorated classes AND members declared on undecorated base classes
    // (subclass associations list them with `declaredIn` pointing here) —
    // the previous class-name gate skipped base-class renames entirely,
    // leaving subclass templates broken.
    const isSharedMemberDeclaration = (): boolean =>
        analyzer.getAssociationsWithMember(node.text, fileName, node.getStart()).length > 0;

    const parent = node.parent;
    if (
        ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent)
    ) {
        if (parent.name === node && ts.isClassDeclaration(parent.parent) && isSharedMemberDeclaration()) {
            return { name: node.text, declFilePath: fileName, declOffset: node.getStart() };
        }
    }

    // Constructor parameter property. `parent.name === node` is essential:
    // identifiers inside a default-value expression
    // (`constructor(public size = DEFAULT)`) also have the parameter as
    // their parent and must not be treated as a member rename.
    if (ts.isParameter(parent) && parent.name === node && ts.isConstructorDeclaration(parent.parent)) {
        if (ts.isClassDeclaration(parent.parent.parent)) {
            const mods = ts.getModifiers(parent);
            if (mods && isParameterProperty(mods) && isSharedMemberDeclaration()) {
                return { name: node.text, declFilePath: fileName, declOffset: node.getStart() };
            }
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
