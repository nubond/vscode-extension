/**
 * codelens-provider.ts
 * Shows "N template references" above TS class members that are used in HTML templates.
 * Clicking a CodeLens navigates to the usages in the HTML file.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseTemplate } from '../core/template-parser';
import { parseExpression } from '../core/expression-parser';
import { DecoratorAnalyzer, TemplateAssociation } from '../core/decorator-analyzer';
import { buildLineIndex, offsetToLineChar, getAbsoluteMemberRange, arePathsEqual } from '../core/utils';
import { logError } from '../core/logger';
import { Constants } from '../constants';

export class nCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(private analyzer: DecoratorAnalyzer) {}

    /** Release the EventEmitter when the extension deactivates. Without this,
     *  the emitter survives the registration disposable and leaks on reload. */
    dispose(): void {
        try { this._onDidChangeCodeLenses.dispose(); } catch (err) {
            logError('codelens.dispose', err);
        }
    }

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] | undefined {
        if (document.languageId !== 'typescript') return undefined;

        const config = vscode.workspace.getConfiguration(Constants.INTERNAL_NAME);
        if (!config.get('codeLens.enable', true)) return undefined;

        try {
            return this.computeCodeLenses(document);
        } catch (err) {
            // Swallow errors so a broken template can't disable CodeLens on
            // the TS file — which is also what VSCode surfaces to users.
            logError(`codeLens(${document.uri?.fsPath ?? '<unknown>'})`, err);
            return undefined;
        }
    }

    private computeCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] | undefined {
        const associations = this.analyzer.getAssociationsForTs(document.uri.fsPath);
        if (associations.length === 0) return undefined;

        const lenses: vscode.CodeLens[] = [];

        for (const assoc of associations) {
            // Add a CodeLens on the class declaration
            const classLens = this.createClassCodeLens(document, assoc);
            if (classLens) lenses.push(classLens);

            if (!assoc.htmlFilePath) continue;

            const publicMembers = assoc.members.filter(m => m.isPublic);
            if (publicMembers.length === 0) continue;

            // Parse the HTML template ONCE for all members (avoids N×readSync per member)
            const allRefs = this.findAllTemplateReferences(
                assoc.htmlFilePath,
                publicMembers.map(m => m.name)
            );

            for (const member of publicMembers) {
                const templateRefs = allRefs.get(member.name);
                if (!templateRefs || templateRefs.length === 0) continue;

                const range = new vscode.Range(
                    new vscode.Position(member.line, member.character),
                    new vscode.Position(member.line, member.character + member.name.length)
                );

                const noun = templateRefs.length === 1 ? 'reference' : 'references';
                lenses.push(new vscode.CodeLens(range, {
                    title: `$(references) ${templateRefs.length} template ${noun}`,
                    command: 'editor.action.showReferences',
                    arguments: [
                        document.uri,
                        new vscode.Position(member.line, member.character),
                        templateRefs
                    ]
                }));
            }
        }

        return lenses.length > 0 ? lenses : undefined;
    }

    resolveCodeLens(
        codeLens: vscode.CodeLens,
        _token: vscode.CancellationToken
    ): vscode.CodeLens | undefined {
        // CodeLens commands are set during provideCodeLenses
        return codeLens;
    }

    refresh(): void {
        // refresh() is called from many paths (file watchers, commands).
        // EventEmitter.fire() can synchronously invoke subscribers — if any
        // throws, we'd leak that up to whoever triggered refresh.
        try { this._onDidChangeCodeLenses.fire(); } catch (err) {
            logError('codelens.refresh', err);
        }
    }

    private createClassCodeLens(document: vscode.TextDocument, assoc: TemplateAssociation): vscode.CodeLens | undefined {
        if (!assoc.htmlFilePath) return undefined;

        const range = new vscode.Range(
            new vscode.Position(assoc.classLine, assoc.classCharacter),
            new vscode.Position(assoc.classLine, assoc.classCharacter + assoc.className.length)
        );

        return new vscode.CodeLens(range, {
            title: `$(file-code) Template: ${this.getRelativePath(assoc.htmlFilePath)}`,
            command: 'vscode.open',
            arguments: [vscode.Uri.file(assoc.htmlFilePath)]
        });
    }

    /** Reads and parses the HTML template ONCE, then finds all member references in a single pass. */
    private findAllTemplateReferences(htmlFilePath: string, memberNames: string[]): Map<string, vscode.Location[]> {
        const content = readHtmlContent(htmlFilePath);
        if (content === undefined) return new Map();

        const parsed = parseTemplate(content);
        const result = new Map<string, vscode.Location[]>();
        const uri = vscode.Uri.file(htmlFilePath);
        const lineIdx = buildLineIndex(content);
        const memberSet = new Set(memberNames);

        for (const binding of parsed.allBindings) {
            const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
            for (const ref of exprInfo.memberReferences) {
                if (memberSet.has(ref.rootMember)) {
                    const range = getAbsoluteMemberRange(binding, ref);
                    const { line, character } = offsetToLineChar(lineIdx, range.start);
                    const pos = new vscode.Position(line, character);
                    const loc = new vscode.Location(uri, new vscode.Range(pos, new vscode.Position(line, character + ref.rootMember.length)));
                    const existing = result.get(ref.rootMember);
                    if (existing) {
                        existing.push(loc);
                    } else {
                        result.set(ref.rootMember, [loc]);
                    }
                }
            }
        }

        return result;
    }

    private getRelativePath(filePath: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const folderPath = folder.uri.fsPath;
                if (filePath.startsWith(folderPath)) {
                    return filePath.substring(folderPath.length + 1).replace(/\\/g, '/');
                }
            }
        }
        return path.basename(filePath);
    }
}

/**
 * Read HTML content for an off-screen file. Prefers the live editor buffer
 * (so CodeLens counts reflect unsaved edits) and falls back to disk.
 * Returns undefined if the file is neither open nor readable.
 */
function readHtmlContent(filePath: string): string | undefined {
    // Path comparison must be slash-agnostic and (on Windows) case-insensitive
    // — analyzer paths are forward-slash-normalized but uri.fsPath is native.
    const openDoc = vscode.workspace.textDocuments.find(
        d => arePathsEqual(d.uri.fsPath, filePath)
    );
    if (openDoc) return openDoc.getText();
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}
