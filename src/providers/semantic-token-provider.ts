/**
 * semantic-token-provider.ts
 * Provides semantic tokens for nb-var local variables and nb-repeat parameters
 * used inside nExpressions, so VS Code highlights them like TS variables.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { getAllLocalVars, getAllRepeatScopes, ParsedTemplate, TemplateAttribute } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { maskNonCode } from '../core/expression-parser';
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
        // Skip @literal and %slot expressions — they contain no variable references
        if (binding.expressionPrefix === '@' || binding.expressionPrefix === '%') return;

        const expression = binding.expression;
        // Scan a masked copy (same length, so every index maps 1:1 into the
        // original): string/template-literal text and comments must not
        // produce variable tokens — `'no item here'` highlighted `item`.
        const searchText = maskNonCode(expression);
        const exprStart = binding.valueSpan.start + binding.expressionOffset;

        // Collect all variable names visible at this binding's location
        const varNames = new Set<string>();

        // nb-var locals. The consumer-aware overload applies the runtime
        // gating rules — an nb-repeat's own expression and nb-case/nb-default
        // expressions never see the element's own vars, and the first nb-var
        // on an element sees no sibling vars, so those names must not be
        // highlighted as live variables there.
        const localVars = getAllLocalVars(parsed, binding.nameSpan.start, binding);
        for (const v of localVars) {
            // Skip empty names — a mid-edit `nb-var:` with no suffix would
            // otherwise cause `expression.indexOf('', …)` below to return 0
            // on every iteration and spin in an infinite loop.
            if (v.varName) varNames.add(v.varName);
        }

        // nb-repeat params. Prefixed scopes inject ONLY the camelCase
        // prefixed names — highlighting 'outeritem' would mark an identifier
        // that doesn't exist at runtime as a known variable. An nb-repeat's
        // OWN expression runs with the parent params, so its own scope's
        // names are not live there.
        const ownRepeat = binding.baseName === 'nb-repeat' ? binding : undefined;
        const repeatScopes = getAllRepeatScopes(parsed, binding.nameSpan.start, ownRepeat);
        for (const scope of repeatScopes) {
            const prefix = scope.prefix;
            if (prefix) {
                varNames.add(prefix + 'Item');
                varNames.add(prefix + 'Index');
                varNames.add(prefix + 'Count');
            } else {
                varNames.add('item');
                varNames.add('index');
                varNames.add('count');
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
        while ((arrowMatch = arrowParamRegex.exec(searchText)) !== null) {
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
            while (searchFrom < searchText.length) {
                const idx = searchText.indexOf(name, searchFrom);
                if (idx === -1) break;

                const endIdx = idx + name.length;

                // Check word boundaries
                const charBefore = idx > 0 ? searchText[idx - 1] : ' ';
                const charAfter = endIdx < searchText.length ? searchText[endIdx] : ' ';

                // Must not be preceded by dot (property access) or be part of a larger identifier
                if (!isIdentChar(charBefore) && charBefore !== '.' && !isIdentChar(charAfter) &&
                    !isObjectKeyPosition(searchText, idx, endIdx)) {
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

/**
 * True when the identifier at [idx, endIdx) is in object-literal KEY position
 * (`{item: 1}`, `{a, item: 2}`, nb-class's `{active: x; item: y}`) — a
 * property name, not a use of the variable. Ternaries stay highlighted: in
 * `cond ? item : other` the char before `item` is `?`, not a key delimiter.
 * Same rule the diagnostics provider's findIdentifierValueIndex applies.
 */
function isObjectKeyPosition(code: string, idx: number, endIdx: number): boolean {
    const after = code.substring(endIdx).match(/^\s*(.)/)?.[1];
    if (after !== ':') return false;
    const before = code.substring(0, idx).match(/(\S)\s*$/)?.[1];
    return before === undefined || before === '{' || before === ',' || before === ';';
}
