/**
 * document-highlight-provider.ts
 * Highlights all occurrences of a this.member reference within the current HTML template
 * when the cursor is on one of them.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { findBindingAtOffset, isEvaluatedBinding } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset } from '../core/expression-parser';
import { getAbsoluteMemberRange, getChainIndexAtOffset } from '../core/utils';

export class nDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
    provideDocumentHighlights(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.DocumentHighlight[] | undefined {
        try {
            return this.computeHighlights(document, position);
        } catch (err) {
            logError(`documentHighlights(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computeHighlights(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.DocumentHighlight[] | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;
        // '@' constants / '%' route slots are literal text — nothing to highlight
        if (!isEvaluatedBinding(binding)) return undefined;

        const offsetInValue = offset - binding.valueSpan.start;
        const exprOffset = offsetInValue - binding.expressionOffset;
        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);
        if (!memberRef) return undefined;

        // Highlights are root-member based. With the cursor on a CHAINED
        // segment (`name` in this.user.name), highlighting every root
        // occurrence marked the wrong symbol — decline instead.
        const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);
        if (chainIndex > 0) return undefined;

        const memberName = memberRef.rootMember;
        const highlights: vscode.DocumentHighlight[] = [];

        for (const b of parsed.allBindings) {
            // Skip '@' constants / '%' route slots — literal text
            if (!isEvaluatedBinding(b)) continue;
            const info = parseExpression(b.expression, b.expressionPrefix);

            for (const ref of info.memberReferences) {
                if (ref.rootMember === memberName) {
                    const abs = getAbsoluteMemberRange(b, ref);
                    const range = new vscode.Range(
                        document.positionAt(abs.start),
                        document.positionAt(abs.end)
                    );
                    highlights.push(new vscode.DocumentHighlight(range, vscode.DocumentHighlightKind.Read));
                }
            }
        }

        return highlights.length > 0 ? highlights : undefined;
    }
}
