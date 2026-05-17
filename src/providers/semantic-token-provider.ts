/**
 * semantic-token-provider.ts
 * Provides semantic tokens for nb-var local variables and nb-repeat parameters
 * used inside nExpressions, so VS Code highlights them like TS variables.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { getAllLocalVars, getAllRepeatScopes, ParsedTemplate, TemplateAttribute } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';

const TOKEN_TYPE_VARIABLE = 0;
const TOKEN_TYPE_FUNCTION = 1;

export const SEMANTIC_TOKEN_LEGEND = new vscode.SemanticTokensLegend(
    ['variable', 'function'],
    ['declaration']
);

export class nSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.SemanticTokens | undefined {
        if (token.isCancellationRequested) return undefined;

        try {
            return this.computeTokens(document, token);
        } catch (err) {
            // Swallow errors so stale or incomplete markup can't disable
            // semantic highlighting across the whole file.
            logError(`semanticTokens(${document.uri?.fsPath ?? '<unknown>'})`, err);
            return undefined;
        }
    }

    private computeTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.SemanticTokens | undefined {
        const parsed = parseTemplateCached(document);
        const builder = new vscode.SemanticTokensBuilder(SEMANTIC_TOKEN_LEGEND);

        for (const binding of parsed.allBindings) {
            if (token.isCancellationRequested) return undefined;
            this.tokenizeBinding(document, parsed, binding, builder);
        }

        return builder.build();
    }

    private tokenizeBinding(
        document: vscode.TextDocument,
        parsed: ParsedTemplate,
        binding: TemplateAttribute,
        builder: vscode.SemanticTokensBuilder
    ): void {
        const prefixLen = binding.expressionPrefix ? 1 : 0;
        // Skip @literal and %slot expressions — they contain no variable references
        if (binding.expressionPrefix === '@' || binding.expressionPrefix === '%') return;

        const expression = binding.expression;
        const exprStart = binding.valueSpan.start + prefixLen;

        // Collect all variable names visible at this binding's location
        const varNames = new Set<string>();

        // nb-var locals
        const localVars = getAllLocalVars(parsed, binding.nameSpan.start);
        for (const v of localVars) {
            // Skip empty names — a mid-edit `nb-var:` with no suffix would
            // otherwise cause `expression.indexOf('', …)` below to return 0
            // on every iteration and spin in an infinite loop.
            if (v.varName) varNames.add(v.varName);
        }

        // nb-repeat params
        const repeatScopes = getAllRepeatScopes(parsed, binding.nameSpan.start);
        for (const scope of repeatScopes) {
            const prefix = scope.prefix ?? '';
            varNames.add(prefix + 'item');
            varNames.add(prefix + 'index');
            varNames.add(prefix + 'count');
            if (prefix) {
                varNames.add(prefix + 'Item');
                varNames.add(prefix + 'Index');
                varNames.add(prefix + 'Count');
            }
        }

        // Collect transformer function names
        const transformerNames = new Set<string>();
        for (const t of this.analyzer.getEntitiesByType('transformer')) {
            if (t.transformerFunctionName) {
                transformerNames.add(t.transformerFunctionName);
            }
        }

        // Detect arrow function parameters: identifier => ...
        const arrowParamRegex = /(?<![.\w$])([a-zA-Z_$][\w$]*)\s*=>/g;
        let arrowMatch: RegExpExecArray | null;
        while ((arrowMatch = arrowParamRegex.exec(expression)) !== null) {
            varNames.add(arrowMatch[1]);
        }

        // Find all bare identifier occurrences in the expression
        // Pattern: word boundary, identifier, word boundary — but NOT preceded by a dot
        const allNames = new Map<string, number>(); // name → token type index
        for (const v of varNames) {
            allNames.set(v, TOKEN_TYPE_VARIABLE);
        }
        for (const t of transformerNames) {
            if (!allNames.has(t)) {
                allNames.set(t, TOKEN_TYPE_FUNCTION);
            }
        }

        if (allNames.size === 0) return;

        for (const [name, tokenType] of allNames) {
            if (!name) continue; // defensive: indexOf('', …) never advances
            let searchFrom = 0;
            while (searchFrom < expression.length) {
                const idx = expression.indexOf(name, searchFrom);
                if (idx === -1) break;

                const endIdx = idx + name.length;

                // Check word boundaries
                const charBefore = idx > 0 ? expression[idx - 1] : ' ';
                const charAfter = endIdx < expression.length ? expression[endIdx] : ' ';

                // Must not be preceded by dot (property access) or be part of a larger identifier
                if (!isIdentChar(charBefore) && charBefore !== '.' && !isIdentChar(charAfter)) {
                    const absoluteOffset = exprStart + idx;
                    const pos = document.positionAt(absoluteOffset);
                    builder.push(pos.line, pos.character, name.length, tokenType, 0);
                }

                searchFrom = endIdx;
            }
        }
    }
}

function isIdentChar(ch: string): boolean {
    return /[\w$]/.test(ch);
}
