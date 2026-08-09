/**
 * extension.ts
 * Main entry point for the Language Service VS Code extension.
 * Registers all providers, commands, file watchers, and initializes the DecoratorAnalyzer.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DecoratorAnalyzer, clearTsConfigCache } from './core/decorator-analyzer';
import { WorkspaceLanguageService } from './core/workspace-language-service';
import { setLogger, logError } from './core/logger';
import { nHoverProvider } from './providers/hover-provider';
import { nDefinitionProvider } from './providers/definition-provider';
import { nReferenceProvider } from './providers/reference-provider';
import { nCompletionProvider } from './providers/completion-provider';
import { nDiagnosticsProvider } from './providers/diagnostics-provider';
import { nRenameProvider } from './providers/rename-provider';
import { nCodeLensProvider } from './providers/codelens-provider';
import { nDocumentSymbolProvider } from './providers/document-symbols-provider';
import { nDocumentHighlightProvider } from './providers/document-highlight-provider';
import { nSemanticTokenProvider, SEMANTIC_TOKEN_LEGEND } from './providers/semantic-token-provider';
import { isNubondLanguageServiceEnabled } from './core/workspace-detection';
import { Constants } from './constants';

const HTML_SELECTOR: vscode.DocumentSelector = { language: 'html', scheme: 'file' };
const TS_SELECTOR: vscode.DocumentSelector = { language: 'typescript', scheme: 'file' };

let analyzer: DecoratorAnalyzer;
let workspaceLS: WorkspaceLanguageService;
let diagnosticsProvider: nDiagnosticsProvider;
let codeLensProvider: nCodeLensProvider;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
    // Top-level try around the ENTIRE activation, including config read and
    // output-channel creation. If anything throws, we leave VS Code's native
    // HTML / TS / CSS features intact — our extension simply remains inert.
    try {
        const config = vscode.workspace.getConfiguration(Constants.INTERNAL_NAME);
        if (!config.get('enable', true)) return;

        outputChannel = vscode.window.createOutputChannel(`${Constants.DISPLAY_NAME} Language Service`);
        context.subscriptions.push(outputChannel);

        // Wire core modules' diagnostic logger to our output channel so that
        // swallowed exceptions in decorator-analyzer / workspace-LS / etc. are
        // visible in the "Language Service" output panel rather than
        // silently lost. Reset on dispose to avoid the activated logger
        // outliving the extension session in jest test environments.
        setLogger(log);
        context.subscriptions.push({ dispose: () => setLogger(() => { /* silent */ }) });

        // Content-level activation gate. The `workspaceContains` activation event
        // only narrows us to workspaces where `node_modules/nubond` exists; it
        // can't read a JSON property. So confirm a package.json explicitly opts
        // in via `"nubond": { "languageService": true }`. If none does, stay
        // inert (like the `enable === false` path) — native HTML/TS features in
        // unrelated projects are left completely untouched.
        if (!isNubondLanguageServiceEnabled()) {
            log(`No workspace package.json opts in to the ${Constants.DISPLAY_NAME} language service ` +
                `("${Constants.INTERNAL_NAME}": { "languageService": true }) — staying inert.`);
            return;
        }

        log(`Activating ${Constants.DISPLAY_NAME} Language Service...`);

        activateInternal(context);
    } catch (err) {
        // Best-effort log, but never re-throw out of activate().
        try {
            log(`Activation failed — ${Constants.DISPLAY_NAME} language features disabled.`);
            logError('activate', err);
        } catch { /* nothing left to do */ }
    }
}

function activateInternal(context: vscode.ExtensionContext): void {
    // Initialize the decorator analyzer + the workspace LanguageService that
    // owns the per-tsconfig ts.LanguageService instances. Using a single
    // long-lived LanguageService (instead of re-running ts.createProgram per
    // edit) gives us incremental, type-correct analysis on every keystroke —
    // the path that fixes the inferred-type-collapses-to-`any` regression.
    analyzer = new DecoratorAnalyzer();
    workspaceLS = new WorkspaceLanguageService();
    context.subscriptions.push({ dispose: () => workspaceLS.dispose() });

    // --- Register ALL providers FIRST (before scan, so they exist even if scan fails) ---

    codeLensProvider = new nCodeLensProvider(analyzer);
    diagnosticsProvider = new nDiagnosticsProvider(analyzer);

    // Watcher / doc-change callbacks are invoked by VS Code's event loop.
    // An uncaught exception inside any of them causes VS Code to dispose
    // the listener silently — leaving the workspace deaf to that event
    // type until reload. Wrap every callback at the boundary.
    const tsWatcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
    tsWatcher.onDidChange(uri => { try { onTsFileChanged(uri); } catch (err) { logError('tsWatcher.onDidChange', err); } });
    tsWatcher.onDidCreate(uri => { try { onTsFileChanged(uri); } catch (err) { logError('tsWatcher.onDidCreate', err); } });
    tsWatcher.onDidDelete(uri => { try { onTsFileDeleted(uri); } catch (err) { logError('tsWatcher.onDidDelete', err); } });

    const htmlWatcher = vscode.workspace.createFileSystemWatcher('**/*.html');
    htmlWatcher.onDidChange(() => { try { refreshDiagnostics(); } catch (err) { logError('htmlWatcher.onDidChange', err); } });
    htmlWatcher.onDidCreate(() => { try { refreshDiagnostics(); } catch (err) { logError('htmlWatcher.onDidCreate', err); } });
    htmlWatcher.onDidDelete(uri => {
        try {
            // Drop any diagnostics still attached to the deleted file —
            // refresh() only re-validates open documents and would leave
            // stale squiggles listed in the Problems panel.
            diagnosticsProvider?.clearDocument(uri);
            refreshDiagnostics();
        } catch (err) { logError('htmlWatcher.onDidDelete', err); }
    });

    // Re-analyze TS files on buffer edits (not just disk saves) so CodeLens positions stay current
    const tsDocChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
        try {
            if (e.document.languageId === 'typescript' && e.document.uri.scheme === 'file' && e.contentChanges.length > 0) {
                onTsFileChanged(e.document.uri);
            }
        } catch (err) {
            logError('onDidChangeTextDocument', err);
        }
    });

    context.subscriptions.push(
        tsDocChangeDisposable,
        // CodeLens provider implements Disposable to release its EventEmitter
        // — VS Code's `register*Provider` disposable only unregisters, doesn't
        // dispose the provider instance itself.
        codeLensProvider,
        // HTML providers
        vscode.languages.registerHoverProvider(HTML_SELECTOR, new nHoverProvider(analyzer)),
        vscode.languages.registerDefinitionProvider(HTML_SELECTOR, new nDefinitionProvider(analyzer)),
        vscode.languages.registerReferenceProvider(HTML_SELECTOR, new nReferenceProvider(analyzer)),
        vscode.languages.registerCompletionItemProvider(
            HTML_SELECTOR,
            new nCompletionProvider(analyzer),
            '.', ':', '"', '='  // trigger characters
        ),
        vscode.languages.registerRenameProvider(HTML_SELECTOR, new nRenameProvider(analyzer)),
        vscode.languages.registerDocumentHighlightProvider(HTML_SELECTOR, new nDocumentHighlightProvider()),
        vscode.languages.registerDocumentSemanticTokensProvider(HTML_SELECTOR, new nSemanticTokenProvider(analyzer), SEMANTIC_TOKEN_LEGEND),
        vscode.languages.registerDocumentSymbolProvider(HTML_SELECTOR, new nDocumentSymbolProvider()),
        // TS providers
        vscode.languages.registerCodeLensProvider(TS_SELECTOR, codeLensProvider),
        // Diagnostics
        diagnosticsProvider,
        // File watchers
        tsWatcher,
        htmlWatcher,
        // Commands
        vscode.commands.registerCommand(`${Constants.INTERNAL_NAME}.goToTemplate`, goToTemplate),
        vscode.commands.registerCommand(`${Constants.INTERNAL_NAME}.goToComponent`, goToComponent),
        vscode.commands.registerCommand(`${Constants.INTERNAL_NAME}.restartServer`, restartServer),
    );

    // --- Run initial scan AFTER all providers are registered (async, non-blocking) ---
    initialScan().then(
        () => log(`${Constants.DISPLAY_NAME} Language Service activated.`),
        err => logError('initialScan.rejected', err)
    );

    // Keep the ts-plugin informed about HTML files with unsaved changes
    // (async, non-blocking — the TS extension may still be activating).
    initTsPluginDirtyHtmlBridge(context).catch(err => logError('initTsPluginDirtyHtmlBridge', err));
}

// ---- ts-plugin bridge: dirty HTML tracking ----
//
// The ts-plugin folds HTML template rename locations into TS-side renames.
// Both its offsets and tsserver's offset→position conversion read the HTML
// from DISK — for a template with unsaved editor changes the positions are
// stale and applying them would corrupt the buffer. The plugin therefore
// skips files we report as dirty; this bridge pushes that set through the
// TS extension's `configurePlugin` API whenever it changes.

const dirtyHtmlFiles = new Set<string>();
let tsPluginConfigApi: { configurePlugin(pluginId: string, configuration: unknown): void } | undefined;

async function initTsPluginDirtyHtmlBridge(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Accessed defensively — test environments mock 'vscode' without the
        // `extensions` namespace, and the guard keeps activation resilient.
        const extensionsNs = (vscode as any).extensions as typeof vscode.extensions | undefined;
        const tsExtension = extensionsNs?.getExtension('vscode.typescript-language-features');
        if (!tsExtension) return;
        const exports: any = await tsExtension.activate();
        const api = exports?.getAPI?.(0);
        if (!api || typeof api.configurePlugin !== 'function') return;
        tsPluginConfigApi = api;
        context.subscriptions.push({ dispose: () => { tsPluginConfigApi = undefined; } });

        const syncDocument = (doc: vscode.TextDocument): void => {
            if (doc.languageId !== 'html' || doc.uri.scheme !== 'file') return;
            const key = doc.uri.fsPath;
            const changed = doc.isDirty ? !dirtyHtmlFiles.has(key) : dirtyHtmlFiles.delete(key);
            if (doc.isDirty) dirtyHtmlFiles.add(key);
            if (changed) pushDirtyHtmlFiles();
        };

        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                try { syncDocument(e.document); } catch (err) { logError('dirtyHtmlBridge.onDidChangeTextDocument', err); }
            }),
            vscode.workspace.onDidSaveTextDocument(doc => {
                try { syncDocument(doc); } catch (err) { logError('dirtyHtmlBridge.onDidSaveTextDocument', err); }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                // A closed document's buffer is gone — disk is authoritative again.
                try {
                    if (dirtyHtmlFiles.delete(doc.uri.fsPath)) pushDirtyHtmlFiles();
                } catch (err) { logError('dirtyHtmlBridge.onDidCloseTextDocument', err); }
            })
        );

        // Seed with documents that are already dirty at activation time.
        let seeded = false;
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'html' && doc.uri.scheme === 'file' && doc.isDirty) {
                dirtyHtmlFiles.add(doc.uri.fsPath);
                seeded = true;
            }
        }
        if (seeded) pushDirtyHtmlFiles();
    } catch (err) {
        // The TS extension is missing or exposes no plugin API — the plugin
        // keeps its fail-open default (empty dirty set). Log and move on.
        logError('initTsPluginDirtyHtmlBridge.setup', err);
    }
}

function pushDirtyHtmlFiles(): void {
    try {
        tsPluginConfigApi?.configurePlugin('ts-plugin', { dirtyHtmlFiles: Array.from(dirtyHtmlFiles) });
    } catch (err) {
        logError('pushDirtyHtmlFiles', err);
    }
}

export function deactivate(): void {
    // VS Code awaits this on shutdown; an exception here would block the
    // shutdown sequence for the extension host. Always succeed silently.
    // Pending debounced re-analyses must not fire into disposed state
    // (restartServer already clears them — deactivation has to as well).
    try {
        for (const timer of tsChangeTimers.values()) { clearTimeout(timer); }
        tsChangeTimers.clear();
    } catch { /* ignore */ }
    try { log(`${Constants.DISPLAY_NAME} Language Service deactivated.`); } catch { /* ignore */ }
}

// ---- Initial project scan ----

async function initialScan(): Promise<void> {
    log('Starting initial project scan...');
    try {
        const tsUris = await vscode.workspace.findFiles('**/*.ts', '{**/node_modules/**,**/dist/**,**/.git/**}');
        const tsFiles = tsUris
            .map(uri => uri.fsPath)
            .filter(f => !f.endsWith('.d.ts'));

        if (tsFiles.length > 0) {
            log(`Found ${tsFiles.length} TypeScript files, analyzing...`);

            // Build LanguageService groups (one per tsconfig.json) and run
            // the analyzer's incremental, type-checked path against each.
            // This replaces the previous one-shot ts.createProgram per group:
            // the LanguageService persists between calls so subsequent edits
            // re-analyze in single-digit-millisecond range instead of seconds.
            workspaceLS.initialize(tsFiles);
            for (const ls of workspaceLS.getAllLanguageServices()) {
                analyzer.analyzeWithLanguageService(ls);
            }

            const assocCount = analyzer.getAllAssociations().length;
            log(`Analysis complete. Found ${assocCount} template associations.`);

            // Log associations for debugging
            for (const assoc of analyzer.getAllAssociations()) {
                log(`  ${assoc.decoratorType} ${assoc.className}: ${assoc.htmlFilePath ?? '(inline)'} [${assoc.members.length} members]`);
            }
        } else {
            log('No TypeScript files found in workspace.');
        }

        codeLensProvider?.refresh();
        diagnosticsProvider?.refresh();
    } catch (err) {
        logError('initialScan', err);
    }
}

// ---- File change handlers ----

const tsChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TS_CHANGE_DEBOUNCE_MS = 500;
const TS_EXCLUDED_PATHS = [
    `${path.sep}node_modules${path.sep}`,
    `${path.sep}dist${path.sep}`,
    `${path.sep}.git${path.sep}`,
];

function onTsFileChanged(uri: vscode.Uri): void {
    const filePath = uri.fsPath;

    // Skip files in build artifacts and dependency directories
    if (TS_EXCLUDED_PATHS.some(excluded => filePath.includes(excluded))) {
        return;
    }

    // Declaration files are excluded from the initial scan too — the analyzer
    // skips them anyway; feeding them to the LanguageService as root files
    // just grows its root set for nothing.
    if (filePath.endsWith('.d.ts')) {
        return;
    }

    // Debounce per file: rapid edits only trigger one re-analysis per file.
    const existingTimer = tsChangeTimers.get(filePath);
    if (typeof(existingTimer) !== 'undefined') {
        clearTimeout(existingTimer);
        tsChangeTimers.delete(filePath);
    }

    tsChangeTimers.set(filePath, setTimeout(() => {
        // Outermost try: this is a setTimeout callback — uncaught throws
        // here become unhandled exceptions on the extension host's event
        // loop, which the host logs noisily. Keep the whole body wrapped.
        try {
            tsChangeTimers.delete(filePath);
            log(`TS file changed: ${filePath}`);

            try {
                // Prefer open document buffer over disk to avoid stale line
                // positions (the disk version may lag behind the editor buffer).
                const openDoc = vscode.workspace.textDocuments.find(
                    d => d.uri.fsPath === filePath
                );
                const content = openDoc ? openDoc.getText() : fs.readFileSync(filePath, 'utf-8');

                // Push the new content into the LanguageService — bumps its
                // version so the next getProgram() re-parses just this file.
                workspaceLS.setFile(filePath, content);

                // Run the incremental analyzer pass against the file's group.
                // Critically, this path always has a working TypeChecker, so
                // inferred member types stay correct after edits (the regression
                // from the old `analyzeSourceText` path that downgraded them to `any`).
                const ls = workspaceLS.getLanguageServiceForFile(filePath);
                if (ls) {
                    analyzer.analyzeWithLanguageService(ls);
                }
            } catch {
                // ignore — a single bad file shouldn't poison the whole flow
            }

            try { codeLensProvider?.refresh(); } catch (err) { logError('onTsFileChanged.timer.codeLensProvider.refresh', err); }
            try { refreshDiagnostics(); } catch (err) { logError('onTsFileChanged.timer.refreshDiagnostics', err); }
        } catch (err) {
            // Truly unexpected — the inner try/catches above should already
            // contain everything. If we get here something is deeply wrong.
            try { logError('onTsFileChanged.timer.outer', err); } catch { /* nothing left to do */ }
        }
    }, TS_CHANGE_DEBOUNCE_MS));
}

function onTsFileDeleted(uri: vscode.Uri): void {
    // Watcher callbacks must never throw — VS Code's file-system-watcher
    // disposes the subscription on uncaught errors, which would leave the
    // workspace silently un-watched until the user reloads. Wrap every step,
    // and log so the failure isn't invisible if it ever happens.
    const fp = uri?.fsPath ?? '<unknown>';
    // Cancel any pending debounced re-analysis for the deleted file — letting
    // it fire would re-register the path from a stale open buffer.
    try {
        const pending = tsChangeTimers.get(uri.fsPath);
        if (typeof(pending) !== 'undefined') {
            clearTimeout(pending);
            tsChangeTimers.delete(uri.fsPath);
        }
    } catch (err) { logError(`onTsFileDeleted.cancelTimer(${fp})`, err); }
    try { analyzer.removeFile(uri.fsPath); } catch (err) { logError(`onTsFileDeleted.analyzer.removeFile(${fp})`, err); }
    try { workspaceLS.removeFile(uri.fsPath); } catch (err) { logError(`onTsFileDeleted.workspaceLS.removeFile(${fp})`, err); }
    try { codeLensProvider?.refresh(); } catch (err) { logError('onTsFileDeleted.codeLensProvider.refresh', err); }
    try { refreshDiagnostics(); } catch (err) { logError('onTsFileDeleted.refreshDiagnostics', err); }
}

function refreshDiagnostics(): void {
    diagnosticsProvider?.refresh();
}

// ---- Commands ----

async function goToTemplate(): Promise<void> {
    // Command handlers must convert errors to a friendly info message instead
    // of letting them bubble up to VS Code's red error toast — uncaught
    // command errors are shown to the user as "command failed" notifications.
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'typescript') {
            vscode.window.showInformationMessage('Open a TypeScript file with a @Container or @Component decorator.');
            return;
        }

        const associations = analyzer.getAssociationsForTs(editor.document.uri.fsPath);
        if (associations.length === 0) {
            vscode.window.showInformationMessage(`No ${Constants.DISPLAY_NAME} template association found for this file.`);
            return;
        }

        if (associations.length === 1 && associations[0].htmlFilePath) {
            const doc = await vscode.workspace.openTextDocument(associations[0].htmlFilePath);
            await vscode.window.showTextDocument(doc);
            return;
        }

        // Multiple associations — show quick pick
        const items = associations
            .filter(a => a.htmlFilePath)
            .map(a => ({
                label: a.className,
                description: a.htmlFilePath!,
                assoc: a
            }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select template to open'
        });

        if (picked?.assoc.htmlFilePath) {
            const doc = await vscode.workspace.openTextDocument(picked.assoc.htmlFilePath);
            await vscode.window.showTextDocument(doc);
        }
    } catch (err) {
        logError('goToTemplate', err);
        // Showing a friendly message is best-effort — if it fails, the user
        // already sees no navigation happen, which is feedback enough.
        try { vscode.window.showInformationMessage(`${Constants.DISPLAY_NAME}: could not navigate to template.`); } catch { /* benign */ }
    }
}

async function goToComponent(): Promise<void> {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'html') {
            vscode.window.showInformationMessage('Open an HTML template file.');
            return;
        }

        const associations = analyzer.getAssociationsForHtml(editor.document.uri.fsPath);
        if (associations.length === 0) {
            vscode.window.showInformationMessage(`No ${Constants.DISPLAY_NAME} class association found for this template.`);
            return;
        }

        if (associations.length === 1) {
            const assoc = associations[0];
            const doc = await vscode.workspace.openTextDocument(assoc.tsFilePath);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(assoc.classLine, assoc.classCharacter);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            return;
        }

        // Multiple associations — show quick pick
        const items = associations.map(a => ({
            label: a.className,
            description: `${a.decoratorType} — ${a.tsFilePath}`,
            assoc: a
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select class to navigate to'
        });

        if (picked) {
            const assoc = picked.assoc;
            const doc = await vscode.workspace.openTextDocument(assoc.tsFilePath);
            const ed = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(assoc.classLine, assoc.classCharacter);
            ed.selection = new vscode.Selection(pos, pos);
            ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
    } catch (err) {
        logError('goToComponent', err);
        try { vscode.window.showInformationMessage(`${Constants.DISPLAY_NAME}: could not navigate to component.`); } catch { /* benign */ }
    }
}

function restartServer(): void {
    log(`Restarting ${Constants.DISPLAY_NAME} Language Service...`);
    // Command handlers must not throw uncaught — VS Code surfaces uncaught
    // errors from commands as red toast notifications and they pollute the
    // user's workspace state. Wrap each tear-down step independently so a
    // failure mid-restart still ends in a clean (if empty) state.
    try { analyzer.clear(); } catch (err) { logError('restartServer.analyzer.clear', err); }
    // Forget memoized tsconfig options — the whole point of a restart is to
    // pick up project-level changes (e.g. an edited tsconfig.json) without a
    // window reload.
    try { clearTsConfigCache(); } catch (err) { logError('restartServer.clearTsConfigCache', err); }
    // Cancel pending debounced re-analyses — they belong to the old state.
    try {
        for (const timer of tsChangeTimers.values()) { clearTimeout(timer); }
        tsChangeTimers.clear();
    } catch (err) { logError('restartServer.clearTimers', err); }
    try { workspaceLS.dispose(); } catch (err) { logError('restartServer.workspaceLS.dispose', err); }
    try { workspaceLS = new WorkspaceLanguageService(); } catch (err) {
        logError('restartServer.WorkspaceLanguageService.reinit', err);
        // No LS to scan with — abort the restart silently. The user can try
        // the command again or reload VS Code.
        return;
    }
    initialScan().then(
        () => {
            try { codeLensProvider?.refresh(); } catch (err) { logError('restartServer.codeLensProvider.refresh', err); }
            try { diagnosticsProvider?.refresh(); } catch (err) { logError('restartServer.diagnosticsProvider.refresh', err); }
            // showInformationMessage failure is benign — the user already
            // sees the result via working IntelliSense. Don't log noise.
            try { vscode.window.showInformationMessage(`${Constants.DISPLAY_NAME} Language Service restarted.`); } catch { /* benign */ }
        },
        err => logError('restartServer.initialScan.rejected', err)
    );
}

// ---- Logging ----

function log(message: string): void {
    // log() is called from many error paths — including catch blocks of the
    // top-level activation guards. It must NEVER throw, or our error handlers
    // become error sources. Each step is independently guarded.
    try {
        const timestamp = new Date().toISOString();
        outputChannel?.appendLine(`[${timestamp}] ${message}`);
    } catch { /* ignore */ }

    try {
        const config = vscode.workspace.getConfiguration(Constants.INTERNAL_NAME);
        const traceLevel = config.get<string>('trace.server', 'off');
        if (traceLevel === 'verbose' || traceLevel === 'messages') {
            console.log(`[${Constants.DISPLAY_NAME}] ${message}`);
        }
    } catch { /* ignore */ }
}
