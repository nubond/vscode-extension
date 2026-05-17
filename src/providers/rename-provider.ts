/**
 * rename-provider.ts
 * Cross-file rename: renaming this.X in HTML updates the identifier across
 * all templates associated with the same TS class.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { logError } from '../core/logger';
import { parseTemplate, findBindingAtOffset } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { buildLineIndex, offsetToLineChar, getAbsoluteMemberRange } from '../core/utils';

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
        const offsetInValue = offset - binding.valueSpan.start;
        const prefixLen = binding.expressionPrefix ? 1 : 0;
        const exprOffset = offsetInValue - prefixLen;
        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);
        if (!memberRef) return undefined;

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
    ): vscode.WorkspaceEdit | undefined {
        if (!/^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(newName)) return undefined;
        try {
            return this.computeRenameEdits(document, position, newName);
        } catch (err) {
            logError(`renameEdits(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character} → ${newName})`, err);
            return undefined;
        }
    }

    private computeRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): vscode.WorkspaceEdit | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;
        const offsetInValue = offset - binding.valueSpan.start;
        const prefixLen = binding.expressionPrefix ? 1 : 0;
        const exprOffset = offsetInValue - prefixLen;
        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);
        if (!memberRef) return undefined;

        const memberName = memberRef.rootMember;
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        const edit = new vscode.WorkspaceEdit();

        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, memberName);
            if (!member) continue;

            // Rename in the TS file (declaration)
            const tsUri = vscode.Uri.file(assoc.tsFilePath);
            edit.replace(
                tsUri,
                new vscode.Range(
                    new vscode.Position(member.line, member.character),
                    new vscode.Position(member.line, member.character + memberName.length)
                ),
                newName
            );

            // Rename all occurrences in this HTML template
            this.addHtmlRenamesForContent(edit, document.uri, document.getText(), memberName, newName);

            // Also rename in other HTML templates for the same TS class
            const otherAssocs = this.analyzer.getAssociationsForTs(assoc.tsFilePath);
            for (const otherAssoc of otherAssocs) {
                if (otherAssoc.htmlFilePath && otherAssoc.htmlFilePath !== document.uri.fsPath) {
                    let content: string;
                    try {
                        content = fs.readFileSync(otherAssoc.htmlFilePath, 'utf-8');
                    } catch {
                        continue;
                    }
                    this.addHtmlRenamesForContent(edit, vscode.Uri.file(otherAssoc.htmlFilePath), content, memberName, newName);
                }
            }
        }

        return edit.size > 0 ? edit : undefined;
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
