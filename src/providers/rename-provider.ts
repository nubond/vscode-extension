/**
 * rename-provider.ts
 * Cross-file rename: renaming this.X in HTML updates the identifier across
 * all templates associated with the same TS class, plus the TS side.
 *
 * TS-side strategy: delegate to VS Code's rename provider for the TS
 * document (`vscode.executeDocumentRenameProvider` at the member's
 * declaration). That covers the declaration AND every TS usage —
 * editing only the declaration left `this.member` references in method
 * bodies pointing at the old name, silently breaking compilation. Only the
 * .ts/.tsx entries of the delegated edit are merged; HTML occurrences are
 * computed here from live buffers (the ts-plugin's text-search offsets can
 * be stale for unsaved HTML). If delegation fails (no TS provider available),
 * fall back to editing the declaration alone.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { logError } from '../core/logger';
import { parseTemplate, findBindingAtOffset, isEvaluatedBinding } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { buildLineIndex, offsetToLineChar, getAbsoluteMemberRange, getChainIndexAtOffset, arePathsEqual } from '../core/utils';

/**
 * A user-facing rename rejection. Thrown out of prepareRename so VS Code
 * shows the message in the rename box instead of a generic "cannot rename".
 */
class RenameNotSupportedError extends Error {}

export class nRenameProvider implements vscode.RenameProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Range | { range: vscode.Range; placeholder: string } | undefined {
        try {
            return this.computePrepareRename(document, position);
        } catch (err) {
            // Deliberate rejections carry a message for the rename UI —
            // rethrow so VS Code displays it. Everything else is a bug:
            // log and decline quietly.
            if (err instanceof RenameNotSupportedError) throw err;
            logError(`prepareRename(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computePrepareRename(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Range | { range: vscode.Range; placeholder: string } | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;
        // '@' constants and '%' route slots are literal text at runtime —
        // a `this.member` inside them is prose, not a renameable reference.
        if (!isEvaluatedBinding(binding)) return undefined;

        const offsetInValue = offset - binding.valueSpan.start;
        const exprOffset = offsetInValue - binding.expressionOffset;
        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);
        if (!memberRef) return undefined;

        // Rename only supports the ROOT member. Silently renaming the root
        // while the cursor sits on `bar` in `this.foo.bar` renamed the wrong
        // symbol — reject with an explanation instead. The message must not
        // promise that a TS-declaration rename updates templates: chained
        // members live on interfaces/aliases the ts-plugin does not fold in,
        // so template usages need manual edits (diagnostics flag them).
        const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);
        if (chainIndex > 0) {
            throw new RenameNotSupportedError(
                `Renaming a chained member ('${memberRef.chain[chainIndex]}') from the template is not supported. ` +
                `Rename it at its TypeScript declaration, then update template usages manually (diagnostics will flag them).`
            );
        }

        // Check that a TS class member exists
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, memberRef.rootMember);
            if (member) {
                const range = getAbsoluteMemberRange(binding, memberRef);
                return {
                    range: new vscode.Range(
                        document.positionAt(range.start),
                        document.positionAt(range.end)
                    ),
                    placeholder: memberRef.rootMember
                };
            }
        }

        return undefined;
    }

    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        if (!/^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(newName)) return undefined;
        return this.computeRenameEdits(document, position, newName).catch(err => {
            logError(`renameEdits(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character} → ${newName})`, err);
            return undefined;
        });
    }

    private async computeRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): Promise<vscode.WorkspaceEdit | undefined> {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;
        // '@' constants and '%' route slots are never evaluated — refuse to
        // rename "references" inside literal text.
        if (!isEvaluatedBinding(binding)) return undefined;

        const offsetInValue = offset - binding.valueSpan.start;
        const exprOffset = offsetInValue - binding.expressionOffset;
        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);
        if (!memberRef) return undefined;

        // Only the ROOT member is renameable from a template (see
        // computePrepareRename) — never rename the root when the cursor sits
        // on a chained member.
        const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);
        if (chainIndex > 0) return undefined;

        const memberName = memberRef.rootMember;
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        const edit = new vscode.WorkspaceEdit();

        // Each HTML file and each TS declaration must be edited exactly once,
        // however many associations point at them. Paths come from two worlds
        // (analyzer: forward-slash-normalized; uri.fsPath: native separators)
        // — comparing them verbatim added the current document's edits twice
        // on Windows, producing overlapping edits VS Code refuses to apply.
        const visitedHtml = new Set<string>();
        const visitedTsDecls = new Set<string>();
        const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();

        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, memberName);
            if (!member) continue;

            // --- TS side: declaration + all TS usages ---
            const declFilePath = member.declaredIn ?? assoc.tsFilePath;
            const declKey = `${normalize(declFilePath)}:${member.line}:${member.character}`;
            if (!visitedTsDecls.has(declKey)) {
                visitedTsDecls.add(declKey);
                const tsUri = vscode.Uri.file(declFilePath);
                const declPos = new vscode.Position(member.line, member.character);
                const delegated = await this.tryDelegateTsRename(edit, tsUri, declPos, newName);
                if (!delegated) {
                    // Fallback: rename the declaration only. member.line /
                    // member.character point at the identifier itself.
                    edit.replace(
                        tsUri,
                        new vscode.Range(declPos, new vscode.Position(member.line, member.character + memberName.length)),
                        newName
                    );
                }
            }

            // --- HTML side: this template + every template whose class shares
            // this member DECLARATION (same class's other templates, and any
            // subclass that inherits the member from a common base). Fanning
            // out only over the current class's templates left sibling
            // subclasses' templates referencing the old name — silently broken
            // at runtime after the TS-side rename went through.
            const htmlPaths: string[] = [document.uri.fsPath];
            for (const a of this.analyzer.getAssociationsWithMember(memberName, declFilePath, member.offset)) {
                if (a.htmlFilePath) htmlPaths.push(a.htmlFilePath);
            }

            for (const htmlPath of htmlPaths) {
                const key = normalize(htmlPath);
                if (visitedHtml.has(key)) continue;
                visitedHtml.add(key);

                if (arePathsEqual(htmlPath, document.uri.fsPath)) {
                    this.addHtmlRenamesForContent(edit, document.uri, document.getText(), memberName, newName);
                } else {
                    // Prefer the open editor buffer: a WorkspaceEdit applies to
                    // the BUFFER, so ranges computed from stale disk content
                    // would land at wrong positions in a dirty document —
                    // silently corrupting the template (same failure mode the
                    // ts-plugin's dirty-file skip guards against).
                    const openDoc = vscode.workspace.textDocuments.find(d => arePathsEqual(d.uri.fsPath, htmlPath));
                    let content: string;
                    let uri: vscode.Uri;
                    if (openDoc) {
                        content = openDoc.getText();
                        uri = openDoc.uri;
                    } else {
                        try {
                            content = fs.readFileSync(htmlPath, 'utf-8');
                        } catch {
                            continue;
                        }
                        uri = vscode.Uri.file(htmlPath);
                    }
                    this.addHtmlRenamesForContent(edit, uri, content, memberName, newName);
                }
            }
        }

        return edit.size > 0 ? edit : undefined;
    }

    /**
     * Run VS Code's rename provider for the TS document at the member's
     * declaration and merge its .ts/.tsx edits into `target`. Returns false
     * when no usable TS rename result was produced (caller falls back to a
     * declaration-only edit). HTML entries are deliberately dropped — this
     * provider computes HTML edits itself from live buffer content.
     */
    private async tryDelegateTsRename(
        target: vscode.WorkspaceEdit,
        tsUri: vscode.Uri,
        declPos: vscode.Position,
        newName: string
    ): Promise<boolean> {
        try {
            const tsEdit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                'vscode.executeDocumentRenameProvider',
                tsUri,
                declPos,
                newName
            );
            if (!tsEdit) return false;

            let copied = false;
            for (const [uri, edits] of tsEdit.entries()) {
                if (!/\.tsx?$/i.test(uri.fsPath)) continue;
                for (const e of edits) {
                    target.replace(uri, e.range, e.newText);
                    copied = true;
                }
            }
            return copied;
        } catch {
            // No TS rename available (or it rejected) — fall back.
            return false;
        }
    }

    private addHtmlRenamesForContent(
        edit: vscode.WorkspaceEdit,
        uri: vscode.Uri,
        content: string,
        oldName: string,
        newName: string
    ): void {
        const parsed = parseTemplate(content);
        const lineIdx = buildLineIndex(content);

        for (const binding of parsed.allBindings) {
            // '@' constants / '%' route slots are literal text — editing a
            // `this.member` inside them changes the runtime output string.
            if (!isEvaluatedBinding(binding)) continue;
            const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);

            for (const ref of exprInfo.memberReferences) {
                if (ref.rootMember === oldName) {
                    const range = getAbsoluteMemberRange(binding, ref);
                    const startPos = offsetToLineChar(lineIdx, range.start);
                    const endPos = offsetToLineChar(lineIdx, range.end);
                    edit.replace(
                        uri,
                        new vscode.Range(
                            new vscode.Position(startPos.line, startPos.character),
                            new vscode.Position(endPos.line, endPos.character)
                        ),
                        newName
                    );
                }
            }
        }
    }
}
