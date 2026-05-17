/**
 * definition-provider.ts
 * Go-to-definition from HTML template → TS class member.
 * Ctrl+Click / F12 on this.property or this.method() navigates to the TS declaration.
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import { findBindingAtOffset, getAllLocalVars, getAllRepeatScopes, findElementAtOffset, findEnclosingElement } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, findMemberAtOffset, getIdentifierAtOffset, MemberReference } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import { getChainIndexAtOffset } from '../core/utils';

export class nDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Definition | undefined {
        try {
            return this.computeDefinition(document, position);
        } catch (err) {
            // Swallow errors so a single broken code path cannot poison
            // VSCode's language-service state (which would cause go-to-def,
            // hover and TS navigation to hang or stop working across edits).
            logError(`definition(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    private computeDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        const offset = document.offsetAt(position);
        const parsed = parseTemplateCached(document);

        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;

        // Handle @EntityName navigation for container/component/template
        if (binding.expressionPrefix === '@') {
            const entityName = binding.expression.trim();
            if (entityName && (binding.baseName === 'nb-container' || binding.baseName === 'nb-component' || binding.baseName === 'nb-template')) {
                return this.navigateToEntity(entityName, binding.baseName);
            }
        }

        const offsetInValue = offset - binding.valueSpan.start;
        const prefixLen = binding.expressionPrefix ? 1 : 0;
        const exprOffset = offsetInValue - prefixLen;

        if (exprOffset < 0) return undefined;

        const exprInfo = parseExpression(binding.expression, binding.expressionPrefix);
        const memberRef = findMemberAtOffset(exprInfo, exprOffset);

        // If not on a this.X member, check if on an nb-var or nb-repeat variable
        if (!memberRef) {
            const ident = getIdentifierAtOffset(binding.expression, exprOffset);
            if (ident) {
                // Check nb-var locals
                const localVars = getAllLocalVars(parsed, binding.nameSpan.start);
                const matchedVar = localVars.find(v => v.varName === ident.word);
                if (matchedVar) {
                    const pos = new vscode.Position(matchedVar.attr.nameSpan.line, matchedVar.attr.nameSpan.character);
                    return new vscode.Location(document.uri, pos);
                }

                // Check nb-repeat context params (item/index/count with optional prefix)
                const repeatScopes = getAllRepeatScopes(parsed, binding.nameSpan.start);
                for (const scope of repeatScopes) {
                    const prefix = scope.prefix ?? '';
                    const params = [
                        prefix + 'item', prefix + 'index', prefix + 'count',
                        ...(prefix ? [prefix + 'Item', prefix + 'Index', prefix + 'Count'] : []),
                    ];
                    if (params.includes(ident.word)) {
                        const pos = new vscode.Position(scope.repeatAttr.nameSpan.line, scope.repeatAttr.nameSpan.character);
                        return new vscode.Location(document.uri, pos);
                    }
                }

                // Check nb-bound / nb-event injected params — navigate to the declaring attribute
                const boundEventParams: Record<string, string[]> = {
                    'element': ['nb-bound', 'nb-event'],
                    'nativeElement': ['nb-bound', 'nb-event'],
                    'event': ['nb-event'],
                    'data': ['nb-event'],
                    'unSubscribe': ['nb-event'],
                    'router': ['nb-event'],
                };
                const targetBases = boundEventParams[ident.word];
                if (targetBases) {
                    // First: if the current binding itself is one of the targets, navigate to it
                    if (targetBases.includes(binding.baseName)) {
                        const pos = new vscode.Position(binding.nameSpan.line, binding.nameSpan.character);
                        return new vscode.Location(document.uri, pos);
                    }
                    // Otherwise: walk up the element tree to find a matching attribute
                    const el = findElementAtOffset(parsed, binding.nameSpan.start) ?? findEnclosingElement(parsed, binding.nameSpan.start);
                    let current = el;
                    while (current) {
                        for (const targetBase of targetBases) {
                            const attr = current.nbAttributes.find(a => a.baseName === targetBase);
                            if (attr) {
                                const pos = new vscode.Position(attr.nameSpan.line, attr.nameSpan.character);
                                return new vscode.Location(document.uri, pos);
                            }
                        }
                        current = current.parent;
                    }
                }

                // Check transformer function names — navigate to the transform() method
                const transformer = this.analyzer.getTransformerByFunctionName(ident.word);
                if (transformer) {
                    const transformMethod = this.analyzer.findMemberInType(transformer.className, 'transform');
                    if (transformMethod) {
                        return new vscode.Location(
                            vscode.Uri.file(transformMethod.filePath),
                            new vscode.Position(transformMethod.line, transformMethod.character)
                        );
                    }
                    // Fallback: navigate to the transformer class file
                    return new vscode.Location(
                        vscode.Uri.file(transformer.tsFilePath),
                        new vscode.Position(0, 0)
                    );
                }
            }
            return undefined;
        }

        // Look up the member declaration in the associated TS class
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        // Determine which chain segment the cursor is on
        const chainIndex = getChainIndexAtOffset(memberRef.chain, memberRef.start, exprOffset, memberRef.separators);

        // If cursor is on a chained member (not root), try type-based navigation
        if (chainIndex > 0) {
            const targetMember = memberRef.chain[chainIndex];
            // Walk the chain to resolve the type at the previous level
            let currentType: string | undefined;
            for (const assoc of associations) {
                const rootMember = this.analyzer.findMember(assoc, memberRef.rootMember);
                if (rootMember) {
                    currentType = rootMember.type;
                    break;
                }
            }
            // Walk through intermediate chain members to get the type
            for (let i = 1; i < chainIndex && currentType; i++) {
                const found = this.analyzer.findMemberWithType(currentType, memberRef.chain[i]);
                if (!found) { currentType = undefined; break; }
                currentType = found.type;
            }
            if (currentType) {
                const found = this.analyzer.findMemberInType(currentType, targetMember);
                if (found) {
                    return new vscode.Location(
                        vscode.Uri.file(found.filePath),
                        new vscode.Position(found.line, found.character)
                    );
                }
            }
        }

        // Default: navigate to root member
        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, memberRef.rootMember);
            if (member) {
                const uri = vscode.Uri.file(assoc.tsFilePath);
                const pos = new vscode.Position(member.line, member.character);
                return new vscode.Location(uri, pos);
            }
        }

        return undefined;
    }

    private navigateToEntity(entityName: string, attrName: string): vscode.Location | undefined {
        const typeMap: Record<string, string> = {
            'nb-container': 'container',
            'nb-component': 'component',
            'nb-template': 'template',
        };
        const entityType = typeMap[attrName];
        if (!entityType) return undefined;

        const entities = this.analyzer.getEntitiesByType(entityType as any);
        // Match by class name (case-insensitive first char for registered name convention)
        const entity = entities.find(e =>
            e.className === entityName ||
            e.className.toLowerCase() === entityName.toLowerCase() ||
            e.name === entityName
        );

        if (entity) {
            // Navigate to the class in the TS file
            const allAssocs = this.analyzer.getAllAssociations();
            const assoc = allAssocs.find(a =>
                a.className === entity.className && a.tsFilePath === entity.tsFilePath
            );
            if (assoc) {
                return new vscode.Location(
                    vscode.Uri.file(assoc.tsFilePath),
                    new vscode.Position(assoc.classLine, assoc.classCharacter)
                );
            }
            // Fallback: just open the file at the beginning
            return new vscode.Location(
                vscode.Uri.file(entity.tsFilePath),
                new vscode.Position(0, 0)
            );
        }

        return undefined;
    }
}
