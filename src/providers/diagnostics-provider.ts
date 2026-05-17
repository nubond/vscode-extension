/**
 * diagnostics-provider.ts
 * Validates nb-* attribute expressions and produces diagnostics (squiggles):
 * - Unknown nb-* attribute names (typos)
 * - References to non-existent class members (this.nonExistent)
 * - nb-case / nb-default without parent nb-switch
 * - Repeat params used outside nb-repeat scope
 */

import * as vscode from 'vscode';
import { ParsedTemplate, isInRepeatScope, getAllLocalVars } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression } from '../core/expression-parser';
import { isNAttribute, getHandlerInfo } from '../core/attribute-registry';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { logError } from '../core/logger';
import { Constants } from '../constants';

export class nDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];
    private changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    static readonly DEBOUNCE_MS = 300;

    constructor(private analyzer: DecoratorAnalyzer) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(Constants.INTERNAL_NAME);
        this.disposables.push(this.diagnosticCollection);

        // Event listeners that VS Code invokes on doc lifecycle events. Each
        // wrap is mandatory: if a listener throws uncaught, VS Code disposes
        // the subscription silently — leaving us deaf to all subsequent
        // events of that kind for the rest of the session.
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => {
                try { this.validate(doc); } catch (err) { logError('diagnostics.onDidOpenTextDocument', err); }
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                try { this.scheduleValidation(e.document); } catch (err) { logError('diagnostics.onDidChangeTextDocument', err); }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                try { this.cancelPending(doc.uri.toString()); } catch (err) { logError('diagnostics.onDidCloseTextDocument.cancelPending', err); }
                try { this.diagnosticCollection.delete(doc.uri); } catch (err) { logError('diagnostics.onDidCloseTextDocument.delete', err); }
            })
        );

        // Validate all currently-open HTML documents. A throw on one
        // document must not prevent us validating the rest.
        for (const doc of vscode.workspace.textDocuments) {
            try { this.validate(doc); } catch (err) { logError('diagnostics.initialValidateAll', err); }
        }
    }

    private scheduleValidation(document: vscode.TextDocument): void {
        if (document.languageId !== 'html') return;
        const key = document.uri.toString();
        this.cancelPending(key);
        this.changeTimers.set(
            key,
            setTimeout(() => {
                this.changeTimers.delete(key);
                this.validate(document);
            }, nDiagnosticsProvider.DEBOUNCE_MS)
        );
    }

    private cancelPending(key: string): void {
        const existing = this.changeTimers.get(key);
        if (typeof(existing) !== 'undefined') {
            clearTimeout(existing);
            this.changeTimers.delete(key);
        }
    }

    validate(document: vscode.TextDocument): void {
        // Outer guard catches anything the inner block can't — config-read
        // failures, diagnosticCollection mutation errors, etc. Whatever
        // happens, this method must never propagate up to a VS Code listener.
        try {
            if (document.languageId !== 'html') return;

            const config = vscode.workspace.getConfiguration(Constants.INTERNAL_NAME);
            if (!config.get('diagnostics.enable', true)) {
                try { this.diagnosticCollection.delete(document.uri); } catch (err) {
                    logError('diagnostics.validate.deleteOnDisable', err);
                }
                return;
            }

            try {
                this.computeDiagnostics(document);
            } catch (err) {
                // A single broken file shouldn't wedge diagnostics for every
                // open document. Clear stale diagnostics so nothing misleading
                // is left behind, but log so the underlying bug is visible.
                logError(`diagnostics.computeDiagnostics(${document.uri.fsPath})`, err);
                try { this.diagnosticCollection.delete(document.uri); } catch (err2) {
                    logError('diagnostics.validate.deleteAfterFailure', err2);
                }
            }
        } catch (err) {
            logError(`diagnostics.validate(${document.uri?.fsPath ?? 'unknown'})`, err);
        }
    }

    private computeDiagnostics(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const parsed = parseTemplateCached(document);
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        for (const binding of parsed.allBindings) {
            // 1. Check for unknown nb-* attribute names
            if (!isNAttribute(binding.baseName)) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(
                        document.positionAt(binding.nameSpan.start),
                        document.positionAt(binding.nameSpan.end)
                    ),
                    `Unknown ${Constants.DISPLAY_NAME} attribute: '${binding.baseName}'. Did you mean one of the known nb-* attributes?`,
                    vscode.DiagnosticSeverity.Warning
                ));
                continue;
            }

            // 2. Check nb-case / nb-default without parent nb-switch
            if (binding.baseName === 'nb-case' || binding.baseName === 'nb-default') {
                if (!this.hasParentSwitch(parsed, binding.nameSpan.start)) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(
                            document.positionAt(binding.nameSpan.start),
                            document.positionAt(binding.nameSpan.end)
                        ),
                        `'${binding.baseName}' must be a child of an element with 'nb-switch'.`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }

            // 3. Validate member references if we have TS class associations
            if (associations.length > 0 && binding.expression) {
                const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);

                for (const ref of exprInfo.memberReferences) {
                    const found = associations.some(assoc =>
                        assoc.members.some(m => m.name === ref.rootMember)
                    );

                    if (!found) {
                        const prefixLen = binding.expressionPrefix ? 1 : 0;
                        const absoluteStart = binding.valueSpan.start + prefixLen + ref.start;
                        const absoluteEnd = binding.valueSpan.start + prefixLen + ref.end;

                        const classNames = associations.map(a => a.className).join(' | ');
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(
                                document.positionAt(absoluteStart),
                                document.positionAt(absoluteEnd)
                            ),
                            `Property '${ref.rootMember}' does not exist on '${classNames}'.`,
                            vscode.DiagnosticSeverity.Warning
                        ));
                    }
                }
            }

            // 4. Check for repeat params used outside nb-repeat scope
            if (associations.length > 0 && binding.expression) {
                const repeatScope = isInRepeatScope(parsed, binding.valueSpan.start);
                if (!repeatScope) {
                    // Check if expression uses repeat-specific params as actual variable references
                    const repeatParams = ['item', 'index', 'count'];
                    // Extract only the code parts (not template literal text)
                    const codeParts = extractCodeParts(binding.expression);
                    // Collect nb-var local variable names visible at this binding
                    const localVarNames = new Set(getAllLocalVars(parsed, binding.nameSpan.start).map(v => v.varName));
                    for (const paramName of repeatParams) {
                        const paramRegex = new RegExp(`(?<![\\w.])${paramName}(?!\\w)`);
                        if (paramRegex.test(codeParts)) {
                            // Only warn if it's not also a class member or nb-var local
                            const isClassMember = associations.some(assoc =>
                                assoc.members.some(m => m.name === paramName)
                            );
                            if (!isClassMember && !localVarNames.has(paramName)) {
                                diagnostics.push(new vscode.Diagnostic(
                                    new vscode.Range(
                                        document.positionAt(binding.valueSpan.start),
                                        document.positionAt(binding.valueSpan.end)
                                    ),
                                    `'${paramName}' is a repeat parameter but this element is not inside an 'nb-repeat' scope.`,
                                    vscode.DiagnosticSeverity.Information
                                ));
                            }
                        }
                    }
                }
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private hasParentSwitch(parsed: ParsedTemplate, offset: number): boolean {
        // Find the element containing this attribute and walk up to find nb-switch
        for (const el of parsed.elements) {
            if (offset >= el.tagSpan.start && offset <= el.tagSpan.end) {
                let current = el.parent;
                while (current) {
                    for (const attr of current.nbAttributes) {
                        if (attr.baseName === 'nb-switch') return true;
                    }
                    current = current.parent;
                }
                return false;
            }
        }
        return false;
    }

    refresh(): void {
        for (const doc of vscode.workspace.textDocuments) {
            this.validate(doc);
        }
    }

    dispose(): void {
        // Best-effort tear-down — keep going on individual failures so we
        // don't leak listeners on extension deactivate / restart.
        // clearTimeout failures are too noisy to log (timers may already be
        // expired); disposable failures are worth knowing about.
        for (const timer of this.changeTimers.values()) {
            try { clearTimeout(timer); } catch { /* benign */ }
        }
        this.changeTimers.clear();
        for (const d of this.disposables) {
            try { d.dispose(); } catch (err) {
                logError('diagnostics.dispose.disposable', err);
            }
        }
    }
}

/**
 * Extract only the "code" parts of an expression, skipping template literal
 * plain text and string literals. For template literals, only ${...} contents
 * are returned. For non-template expressions, returns the full expression.
 */
function extractCodeParts(expression: string): string {
    const parts: string[] = [];
    let i = 0;

    while (i < expression.length) {
        const ch = expression[i];

        // Skip single-quoted strings (handle escaped quotes)
        if (ch === "'") {
            i++;
            while (i < expression.length && expression[i] !== "'") {
                if (expression[i] === '\\') i++; // skip escaped character
                i++;
            }
            i++; // skip closing quote
            continue;
        }

        // Skip double-quoted strings (handle escaped quotes)
        if (ch === '"') {
            i++;
            while (i < expression.length && expression[i] !== '"') {
                if (expression[i] === '\\') i++; // skip escaped character
                i++;
            }
            i++; // skip closing quote
            continue;
        }

        // Skip block comments /* ... */
        if (ch === '/' && i + 1 < expression.length && expression[i + 1] === '*') {
            i += 2;
            while (i < expression.length - 1 && !(expression[i] === '*' && expression[i + 1] === '/')) i++;
            i += 2; // skip closing */
            continue;
        }

        // Template literal: only extract ${...} contents
        if (ch === '`') {
            i++; // skip opening backtick
            while (i < expression.length && expression[i] !== '`') {
                if (expression[i] === '\\') {
                    i += 2; // skip escaped character (including \`)
                    continue;
                }
                if (expression[i] === '$' && i + 1 < expression.length && expression[i + 1] === '{') {
                    i += 2; // skip ${
                    let depth = 1;
                    const interpStart = i;
                    while (i < expression.length && depth > 0) {
                        if (expression[i] === '{') depth++;
                        else if (expression[i] === '}') depth--;
                        if (depth > 0) i++;
                    }
                    parts.push(expression.substring(interpStart, i));
                    i++; // skip closing }
                } else {
                    i++; // skip template literal plain text char
                }
            }
            i++; // skip closing backtick
            continue;
        }

        parts.push(ch);
        i++;
    }

    return parts.join('');
}
