/**
 * reference-provider.ts
 * Find all references to a symbol from HTML templates.
 * When triggered on a this.X expression in HTML, shows all usages in both HTML and TS.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { logError } from '../core/logger';
import { parseTemplate, findBindingAtOffset } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset, MemberReference } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { buildLineIndex, offsetToLineChar, getAbsoluteMemberRange, arePathsEqual } from '../core/utils';

export class nReferenceProvider implements vscode.ReferenceProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        _token: vscode.CancellationToken
    ): vscode.Location[] | undefined {
        try {
            return this.computeReferences(document, position, context);
        } catch (err) {
            logError(`references(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computeReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext
    ): vscode.Location[] | undefined {
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

        const locations: vscode.Location[] = [];
        const memberName = memberRef.rootMember;

        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        // Track HTML files we've already searched (normalized) to avoid
        // duplicates when multiple TS classes point to the same template,
        // or when forward/backward-slash variants of the same path collide.
        const visitedHtml = new Set<string>();
        const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();

        for (const assoc of associations) {
            // Include TS declaration as reference
            if (context.includeDeclaration) {
                const member = this.analyzer.findMember(assoc, memberName);
                if (member) {
                    locations.push(new vscode.Location(
                        vscode.Uri.file(assoc.tsFilePath),
                        new vscode.Position(member.line, member.character)
                    ));
                }
            }

            // Find references in the current HTML template AND in any other
            // HTMLs associated with the same TS class — symmetric with rename.
            // Without this, find-references reports fewer hits than rename
            // would actually edit, which is surprising and error-prone.
            const tsAssocs = this.analyzer.getAssociationsForTs(assoc.tsFilePath);
            const htmlPaths: string[] = [document.uri.fsPath];
            for (const a of tsAssocs) {
                if (a.htmlFilePath) htmlPaths.push(a.htmlFilePath);
            }

            for (const htmlPath of htmlPaths) {
                const key = normalize(htmlPath);
                if (visitedHtml.has(key)) continue;
                visitedHtml.add(key);
                if (arePathsEqual(htmlPath, document.uri.fsPath)) {
                    locations.push(...findReferencesInDocument(document, memberName));
                } else {
                    locations.push(...findReferencesInOtherHtml(htmlPath, memberName));
                }
            }
        }

        return locations.length > 0 ? locations : undefined;
    }
}

function findReferencesInDocument(document: vscode.TextDocument, memberName: string): vscode.Location[] {
    const parsed = parseTemplateCached(document);
    const locations: vscode.Location[] = [];

    for (const binding of parsed.allBindings) {
        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);

        for (const ref of exprInfo.memberReferences) {
            if (ref.rootMember === memberName) {
                const range = getAbsoluteMemberRange(binding, ref);
                locations.push(new vscode.Location(
                    document.uri,
                    new vscode.Range(
                        document.positionAt(range.start),
                        document.positionAt(range.end)
                    )
                ));
            }
        }
    }

    return locations;
}

function findReferencesInOtherHtml(htmlPath: string, memberName: string): vscode.Location[] {
    // Prefer the open-buffer text if the file is loaded; fall back to disk.
    const openDoc = vscode.workspace.textDocuments.find(d => arePathsEqual(d.uri.fsPath, htmlPath));
    let content: string | undefined;
    if (openDoc) {
        content = openDoc.getText();
    } else {
        try {
            content = fs.readFileSync(htmlPath, 'utf-8');
        } catch {
            return [];
        }
    }

    const parsed = parseTemplate(content);
    const lineIdx = buildLineIndex(content);
    const uri = vscode.Uri.file(htmlPath);
    const locations: vscode.Location[] = [];

    for (const binding of parsed.allBindings) {
        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);

        for (const ref of exprInfo.memberReferences) {
            if (ref.rootMember === memberName) {
                const range = getAbsoluteMemberRange(binding, ref);
                const startPos = offsetToLineChar(lineIdx, range.start);
                const endPos = offsetToLineChar(lineIdx, range.end);
                locations.push(new vscode.Location(
                    uri,
                    new vscode.Range(
                        new vscode.Position(startPos.line, startPos.character),
                        new vscode.Position(endPos.line, endPos.character)
                    )
                ));
            }
        }
    }

    return locations;
}
