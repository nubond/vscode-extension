/**
 * document-symbols-provider.ts
 * Provides Outline panel symbols for nHTML templates.
 * Shows containers, components, repeat blocks, if/switch blocks, and templates.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { TemplateElement } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';

export class nDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] | undefined {
        if (document.languageId !== 'html') return undefined;
        try {
            return this.computeSymbols(document);
        } catch (err) {
            logError(`documentSymbols(${document.uri?.fsPath ?? '<unknown>'})`, err);
            return undefined;
        }
    }

    private computeSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] | undefined {
        const parsed = parseTemplateCached(document);
        const symbols: vscode.DocumentSymbol[] = [];

        for (const element of parsed.elements) {
            // Only create symbols for top-level elements (no parent)
            if (!element.parent) {
                const childSymbols = this.buildSymbols(document, element);
                symbols.push(...childSymbols);
            }
        }

        return symbols.length > 0 ? symbols : undefined;
    }

    private buildSymbols(document: vscode.TextDocument, element: TemplateElement): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];

        for (const attr of element.nbAttributes) {
            const meta = describeAttribute(attr);
            if (!meta) continue;

            const fullRange = new vscode.Range(
                document.positionAt(element.tagSpan.start),
                document.positionAt(element.tagSpan.end)
            );
            const selectionRange = new vscode.Range(
                document.positionAt(attr.nameSpan.start),
                document.positionAt(attr.nameSpan.end)
            );
            symbols.push(new vscode.DocumentSymbol(
                meta.name,
                meta.detail ?? '',
                meta.kind,
                fullRange,
                selectionRange
            ));
        }

        // Build child symbols once. If this element produced any nb-* symbols,
        // attach them to the FIRST symbol so they appear nested in the outline.
        // Previously, child symbols were appended to every symbol, producing
        // duplicates when an element carried multiple nb-* attributes
        // (e.g. nb-repeat + nb-if).
        const childSymbols: vscode.DocumentSymbol[] = [];
        for (const child of element.children) {
            childSymbols.push(...this.buildSymbols(document, child));
        }

        if (symbols.length > 0) {
            symbols[0].children.push(...childSymbols);
        } else {
            symbols.push(...childSymbols);
        }

        return symbols;
    }
}

/** Map an nb-* attribute to a document-symbol description, or undefined to skip. */
function describeAttribute(attr: { baseName: string; suffix?: string; value: string; expression: string; expressionPrefix?: string }):
    { name: string; kind: vscode.SymbolKind; detail?: string } | undefined {
    switch (attr.baseName) {
        case 'nb-container':
            return {
                name: `Container: ${attr.expression || attr.value}`,
                kind: vscode.SymbolKind.Module,
                detail: attr.expressionPrefix === '%' ? '(route slot)' : '',
            };
        case 'nb-component':
            return { name: `Component: ${attr.expression || attr.value}`, kind: vscode.SymbolKind.Class };
        case 'nb-repeat':
            return {
                name: attr.suffix ? `Repeat:${attr.suffix}` : 'Repeat',
                kind: vscode.SymbolKind.Array,
                detail: attr.expression,
            };
        case 'nb-if':
            return { name: `If: ${attr.expression}`, kind: vscode.SymbolKind.Boolean };
        case 'nb-switch':
            return { name: `Switch: ${attr.expression}`, kind: vscode.SymbolKind.Enum };
        case 'nb-case':
            return { name: `Case: ${attr.value}`, kind: vscode.SymbolKind.EnumMember };
        case 'nb-default':
            return { name: 'Default', kind: vscode.SymbolKind.EnumMember };
        case 'nb-template':
            return { name: `Template: ${attr.expression || attr.value}`, kind: vscode.SymbolKind.Field };
        case 'nb-aspect':
            return { name: `Aspect: ${attr.suffix || attr.expression}`, kind: vscode.SymbolKind.Interface };
        case 'nb-projection':
            return {
                name: attr.expression ? `Projection: ${attr.expression}` : 'Projection',
                kind: vscode.SymbolKind.Namespace,
            };
        default:
            return undefined;
    }
}
