/**
 * completion-provider.ts
 * Provides autocomplete suggestions in nb-* attribute values:
 * - this.member suggestions from associated TS class
 * - Event names for nb-event:
 * - Container/component/template/aspect names
 * - Injected parameters (item, index, etc. inside repeat scopes)
 */

import * as vscode from 'vscode';
import { logError } from '../core/logger';
import type { ParsedTemplate, TemplateAttribute } from '../core/template-parser';
import { findBindingAtOffset, isInRepeatScope, getAllLocalVars, findElementAtOffset } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import {
    getElementType, getEventType,
    getTagSpecificAttributes, getTagSpecificProperties,
    getAllEventMembers, getAllDomElementMembers, getAllElementManipulationMembers,
} from '../core/utils';
import {
    ALL_NB_ATTRIBUTES, PREFIX_ATTRIBUTES, COMMON_DOM_EVENTS,
    getHandlerInfo
} from '../core/attribute-registry';
import {
    getGlobalObjectMembers, getAllGlobalObjects,
    getAllGlobalFunctions, getAllGlobalConstants
} from '../core/globals-registry';
import { getAllModelInjections, getModelInjection } from '../core/model-injections-registry';

/**
 * Module-level regex matching `<prefixAttr>:<suffixSoFar>` at the end of a
 * line. Built from `PREFIX_ATTRIBUTES` once at load time rather than hard-coded
 * — sorted longest-first so e.g. `nb-in-ref` matches before `nb-in`. Captures:
 *   [1] base attribute name (e.g. `nb-event`)
 *   [2] the suffix typed so far (may be empty)
 */
const PREFIX_SUFFIX_REGEX = (() => {
    // Module-load IIFE: a throw here would prevent the extension from
    // activating at all. Use a never-matches fallback so completion still
    // loads (just without the prefix:suffix shortcut) if input is bad.
    try {
        const sortedAlternation = [...PREFIX_ATTRIBUTES]
            .sort((a, b) => b.length - a.length)
            .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        return new RegExp(`(${sortedAlternation}):(\\w*)$`);
    } catch {
        return /^(?!.*)$/;  // matches nothing
    }
})();

/**
 * Context bag passed to each value-completion strategy. Pre-computed once per
 * dispatch so individual strategies don't re-derive overlapping fields.
 */
interface ValueCompletionContext {
    document: vscode.TextDocument;
    parsed: ParsedTemplate;
    binding: TemplateAttribute;
    offset: number;
    /** Cursor offset within the binding *expression* (after any prefix char). */
    exprOffset: number;
    /** Substring of binding.value from index 0 up to the cursor. */
    valueUpToCursor: string;
}

export class nCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private analyzer: DecoratorAnalyzer) {}

    /**
     * Exclusive strategies — first match short-circuits and returns. Order
     * matters: more specific dotted-access patterns must be tried before
     * more general ones (e.g. `this.X.` before any bare `<word>.`).
     */
    private readonly exclusiveStrategies: Array<(ctx: ValueCompletionContext) => vscode.CompletionItem[] | undefined> = [
        ctx => this.strategyAfterThisDot(ctx),
        ctx => this.strategyModelInjectionChain(ctx),
        ctx => this.strategyTypedChain(ctx),
        ctx => this.strategyGlobalMemberAccess(ctx),
        ctx => this.strategyEventDotAccess(ctx),
        ctx => this.strategyElementDotAccess(ctx),
    ];

    /**
     * Additive strategies — every applicable one contributes items to the
     * merged result. List order only affects the initial completion-list
     * ordering; VSCode applies its own filtering/sort based on `sortText`.
     */
    private readonly additiveStrategies: Array<(ctx: ValueCompletionContext) => vscode.CompletionItem[]> = [
        ctx => this.strategyRepeatParams(ctx),
        ctx => this.strategyLocalVars(ctx),
        ctx => this.strategyHandlerParams(ctx),
        ctx => this.strategyEntityNames(ctx),
        ctx => this.strategyThisStarter(ctx),
        ctx => this.strategyTransformers(ctx),
        ctx => this.strategyGlobalsCatalog(ctx),
    ];

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionList | undefined {
        try {
            return this.computeCompletions(document, position, context);
        } catch (err) {
            // Swallow errors so a broken code path cannot poison VSCode's
            // language-service state (hover/completion would otherwise
            // remain stuck in a "Loading..." limbo across subsequent edits).
            logError(`completion(${document.uri?.fsPath ?? '<unknown>'}@${position.line}:${position.character})`, err);
            return undefined;
        }
    }

    /**
     * Three-stage dispatcher. Each stage owns a clearly-bounded context:
     *   1. attribute-name context  → suggest `nb-*` attributes (no parse needed)
     *   2. prefix:suffix context   → suggest event names / props / aspect names
     *   3. expression-value context → run an ordered strategy list
     * Stages 1 and 2 deliberately avoid `parseTemplate` — they only inspect
     * the line text immediately before/after the cursor, which is significantly
     * cheaper on large templates.
     */
    private computeCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.CompletionContext
    ): vscode.CompletionList | undefined {
        const text = document.getText();
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        if (associations.length === 0 && !this.isNTemplate(text)) return undefined;

        const lineText = document.lineAt(position).text;
        const charBefore = lineText.substring(0, position.character);
        const charAfter = lineText.substring(position.character);
        const offset = document.offsetAt(position);
        const textBeforeCursor = text.substring(0, offset);

        // Stage 1: attribute name (`<div nb-|`)
        if (this.isInAttributeNameContext(charBefore, textBeforeCursor)) {
            const hasTrailingEquals = this.detectTrailingEquals(charBefore, charAfter);
            return this.toList(this.provideAttributeNameCompletions(hasTrailingEquals));
        }

        // Stage 2: prefix:suffix (`nb-event:|`, `nb-prop:c|`)
        const prefixMatch = charBefore.match(PREFIX_SUFFIX_REGEX);
        if (prefixMatch) {
            const tagName = this.findEnclosingTagName(textBeforeCursor);
            const hasTrailingEquals = this.detectTrailingEquals(charBefore, charAfter, prefixMatch[1], tagName);
            return this.toList(this.provideSuffixCompletions(prefixMatch[1], prefixMatch[2], document, tagName, hasTrailingEquals));
        }

        // Stage 3: expression value — needs the parsed template
        return this.computeValueCompletions(document, offset);
    }

    /**
     * Run the ordered strategy list over an expression-value context.
     * Each strategy either short-circuits (`exclusive: true`) or contributes
     * additive items. The single-method dispatcher is split so each branch
     * can be unit-tested in isolation and reordered without rewriting flow.
     */
    private computeValueCompletions(
        document: vscode.TextDocument,
        offset: number,
    ): vscode.CompletionList | undefined {
        const parsed = parseTemplateCached(document);
        const hit = findBindingAtOffset(parsed, offset);
        if (!hit || !hit.inValue) return undefined;

        const { binding } = hit;
        const offsetInValue = offset - binding.valueSpan.start;
        const prefixLen = binding.expressionPrefix ? 1 : 0;
        const exprOffset = offsetInValue - prefixLen;
        const valueUpToCursor = binding.value.substring(0, offsetInValue);

        const ctx: ValueCompletionContext = {
            document, parsed, binding, offset, exprOffset, valueUpToCursor,
        };

        for (const strategy of this.exclusiveStrategies) {
            const items = strategy(ctx);
            if (items) return this.toList(items);
        }

        const items: vscode.CompletionItem[] = [];
        for (const strategy of this.additiveStrategies) {
            items.push(...strategy(ctx));
        }

        return items.length > 0 ? this.toList(items) : undefined;
    }

    // ─── Exclusive value-completion strategies ─────────────────────────────

    private strategyAfterThisDot(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (!/this\.\s*$/.test(ctx.valueUpToCursor)) return undefined;
        return this.provideMemberCompletions(ctx.document);
    }

    private strategyModelInjectionChain(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideModelInjectionMemberCompletions(ctx.valueUpToCursor);
    }

    private strategyTypedChain(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideChainedMemberCompletions(ctx.valueUpToCursor, ctx.document);
    }

    private strategyGlobalMemberAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideGlobalMemberCompletions(ctx.valueUpToCursor);
    }

    private strategyEventDotAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (ctx.binding.baseName !== 'nb-event') return undefined;
        if (!/\bevent\.\s*$/.test(ctx.valueUpToCursor)) return undefined;
        return this.provideEventMemberCompletions(ctx.binding.suffix);
    }

    private strategyElementDotAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (ctx.binding.baseName !== 'nb-event' && ctx.binding.baseName !== 'nb-bound') return undefined;
        const element = findElementAtOffset(ctx.parsed, ctx.binding.nameSpan.start);
        const items = this.provideElementMemberCompletions(ctx.valueUpToCursor, element?.tagName);
        return items.length > 0 ? items : undefined;
    }

    // ─── Additive value-completion strategies ──────────────────────────────

    private strategyRepeatParams(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        const scope = isInRepeatScope(ctx.parsed, ctx.offset);
        return scope ? this.provideRepeatParamCompletions(scope.prefix) : [];
    }

    private strategyLocalVars(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        return getAllLocalVars(ctx.parsed, ctx.offset).map(lv => {
            const item = new vscode.CompletionItem(lv.varName, vscode.CompletionItemKind.Variable);
            item.detail = `Local variable — nb-var:${lv.attr.suffix}`;
            item.documentation = new vscode.MarkdownString(
                `Injected by \`nb-var:${lv.attr.suffix}\`: \`${lv.attr.expression}\``
            );
            return item;
        });
    }

    private strategyHandlerParams(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        if (ctx.binding.baseName === 'nb-event') return this.provideEventParamCompletions();
        if (ctx.binding.baseName === 'nb-bound') return this.provideBoundParamCompletions();
        return [];
    }

    private strategyEntityNames(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        if (ctx.binding.expressionPrefix !== '@') return [];
        if (ctx.binding.baseName === 'nb-container') return this.provideEntityNameCompletions('container');
        if (ctx.binding.baseName === 'nb-template')  return this.provideEntityNameCompletions('template');
        if (ctx.binding.baseName === 'nb-component') return this.provideEntityNameCompletions('component');
        return [];
    }

    private strategyThisStarter(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        if (ctx.exprOffset < 0 || ctx.valueUpToCursor.includes('this.')) return [];
        const item = new vscode.CompletionItem('this.', vscode.CompletionItemKind.Keyword);
        item.documentation = 'Access the current context (Container/Component class instance)';
        item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
        return [item];
    }

    private strategyTransformers(_ctx: ValueCompletionContext): vscode.CompletionItem[] {
        return this.provideTransformerCompletions();
    }

    private strategyGlobalsCatalog(_ctx: ValueCompletionContext): vscode.CompletionItem[] {
        return this.provideGlobalCompletions();
    }

    /**
     * Wrap a set of items as a `CompletionList` with `isIncomplete: true`.
     * This forces VSCode to re-invoke this provider on every subsequent
     * keystroke instead of filtering a cached list client-side. Critical
     * for context-switches like `nb-event` → `nb-event:`, where the
     * relevant suggestions change completely once the user types the colon.
     */
    private toList(items: vscode.CompletionItem[]): vscode.CompletionList {
        return new vscode.CompletionList(items, true);
    }

    /**
     * Detect if ="" already follows the cursor for the current attribute.
     * Unlike a simple regex, this validates that word chars between the cursor
     * and the `=` sign belong to the same attribute (not an adjacent one)
     * by checking the combined word against known attribute/event/property names.
     */
    private detectTrailingEquals(charBefore: string, charAfter: string, baseName?: string, tagName?: string): boolean {
        const match = charAfter.match(/^([\w-]*)\s*=/);
        if (!match) return false;

        const remainingWord = match[1];
        // = directly follows cursor (possibly with whitespace) — unambiguous
        if (remainingWord.length === 0) return true;

        // Word chars exist between cursor and =.
        // Verify they belong to the same attribute by checking the combined word.
        const typedPrefixMatch = charBefore.match(/[\w-]+$/);
        const typedPrefix = typedPrefixMatch ? typedPrefixMatch[0] : '';
        const combinedWord = typedPrefix + remainingWord;

        // Attribute name context
        if (!baseName) {
            return ALL_NB_ATTRIBUTES.includes(combinedWord);
        }

        // Suffix context — check against context-appropriate known names
        if (baseName === 'nb-event') {
            return COMMON_DOM_EVENTS.some(e => e.name === combinedWord);
        }
        if (baseName === 'nb-attr') {
            const elementType = tagName ? getElementType(tagName) : undefined;
            const entries = elementType ? getTagSpecificAttributes(elementType) : getTagSpecificAttributes('');
            return entries.some(a => a.name === combinedWord);
        }
        if (baseName === 'nb-prop') {
            const elementType = tagName ? getElementType(tagName) : undefined;
            const entries = elementType ? getTagSpecificProperties(elementType) : getTagSpecificProperties('');
            return entries.some(p => p.name === combinedWord);
        }
        if (baseName === 'nb-aspect') {
            return this.analyzer.getEntitiesByType('aspect').some(a => {
                const name = a.className.charAt(0).toLowerCase() + a.className.slice(1);
                return name === combinedWord;
            });
        }

        // For user-defined suffixes (nb-var, nb-in, nb-in-ref, nb-repeat):
        // heuristic — if the combined word contains 'nb-', it likely spans into the next attribute
        return !combinedWord.includes('nb-');
    }

    /**
     * Walk back from the cursor to the `<` that opens the current tag and
     * return the tag name. Returns undefined if the cursor is not inside
     * a tag (i.e. a `>` appears between the cursor and the preceding `<`).
     *
     * Implemented as a string scan rather than a regex with `(?:\s|[^>])*$`
     * — that alternation is ambiguous (\s is a subset of [^>]) and produces
     * exponential backtracking on large templates, which was freezing the
     * entire extension when completion was triggered inside a big file.
     */
    private findEnclosingTagName(textBeforeCursor: string): string | undefined {
        const lastLt = textBeforeCursor.lastIndexOf('<');
        if (lastLt < 0) return undefined;
        const lastGt = textBeforeCursor.lastIndexOf('>');
        if (lastGt > lastLt) return undefined; // not inside an open tag

        const match = textBeforeCursor.substring(lastLt).match(/^<(\w[\w-]*)/);
        return match ? match[1] : undefined;
    }

    private isInAttributeNameContext(lineBeforeCursor: string, textBeforeCursor: string): boolean {
        // Check if we're inside an opening tag, typing an attribute name.
        // Use full text before cursor to handle multi-line tags.
        const lastLt = textBeforeCursor.lastIndexOf('<');
        const lastGt = textBeforeCursor.lastIndexOf('>');
        if (lastLt <= lastGt) return false;

        // Inside a tag — check we're not inside a quoted attribute value
        const afterTag = textBeforeCursor.substring(lastLt);
        const singleQuotes = (afterTag.match(/'/g) || []).length;
        const doubleQuotes = (afterTag.match(/"/g) || []).length;
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) return false;

        // Check if we're after whitespace or at the beginning of typing an attribute
        return /\s[\w-]*$/.test(afterTag);
    }

    private provideAttributeNameCompletions(hasTrailingEquals: boolean): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        for (const attr of ALL_NB_ATTRIBUTES) {
            const handler = getHandlerInfo(attr);
            if (!handler) continue;

            const item = new vscode.CompletionItem(attr, vscode.CompletionItemKind.Property);
            item.detail = handler.displayName;
            item.documentation = new vscode.MarkdownString(handler.description);
            item.sortText = `0_${attr}`; // sort before native HTML attributes
            item.preselect = true;

            if (handler.isPrefix && attr === 'nb-repeat') {
                // nb-repeat suffix is optional — treat like non-prefix
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(attr)
                    : new vscode.SnippetString(`${attr}="\${1}"`);
            } else if (handler.isPrefix && attr === 'nb-var') {
                // nb-var suffix is a user-defined variable name
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(`${attr}:\${1:name}`)
                    : new vscode.SnippetString(`${attr}:\${1:name}="\${2}"`);
            } else if (handler.isPrefix || attr === 'nb-value') {
                // For prefix attributes with known suffixes, insert colon and trigger suggest
                item.insertText = new vscode.SnippetString(`${attr}:`);
                item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            } else if (handler.attribute === 'nb-default') {
                // nb-default has no value
                item.insertText = attr;
            } else {
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(attr)
                    : new vscode.SnippetString(`${attr}="\${1}"`);
            }

            items.push(item);
        }

        return items;
    }

    private provideSuffixCompletions(baseName: string, currentSuffix: string, document: vscode.TextDocument, tagName?: string, hasTrailingEquals: boolean = false): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const elementType = tagName ? getElementType(tagName) : undefined;

        if (baseName === 'nb-event') {
            for (const event of COMMON_DOM_EVENTS) {
                const item = new vscode.CompletionItem(event.name, vscode.CompletionItemKind.Event);
                item.detail = `DOM Event: ${event.name}`;
                item.documentation = new vscode.MarkdownString(event.desc);
                item.sortText = `0_${event.name}`;
                item.preselect = true;
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(event.name)
                    : new vscode.SnippetString(`${event.name}="\${1}"`);
                items.push(item);
            }
        } else if (baseName === 'nb-aspect') {
            const aspects = this.analyzer.getEntitiesByType('aspect');
            for (const aspect of aspects) {
                const name = aspect.className.charAt(0).toLowerCase() + aspect.className.slice(1);
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
                item.detail = `Aspect: ${aspect.className}`;
                item.sortText = `0_${name}`;
                item.preselect = true;
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(name)
                    : new vscode.SnippetString(`${name}="\${1}"`);
                items.push(item);
            }
        } else if (baseName === 'nb-attr') {
            const attrEntries = elementType ? getTagSpecificAttributes(elementType) : getTagSpecificAttributes('');
            for (const entry of attrEntries) {
                const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Field);
                item.detail = `HTML Attribute`;
                item.documentation = new vscode.MarkdownString(entry.desc);
                item.sortText = `0_${entry.name}`;
                item.preselect = true;
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(entry.name)
                    : new vscode.SnippetString(`${entry.name}="\${1}"`);
                items.push(item);
            }
        } else if (baseName === 'nb-prop') {
            const propEntries = elementType ? getTagSpecificProperties(elementType) : getTagSpecificProperties('');
            for (const entry of propEntries) {
                const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Field);
                item.detail = `DOM Property`;
                item.documentation = new vscode.MarkdownString(entry.desc);
                item.sortText = `0_${entry.name}`;
                item.preselect = true;
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(entry.name)
                    : new vscode.SnippetString(`${entry.name}="\${1}"`);
                items.push(item);
            }
        } else if (baseName === 'nb-in' || baseName === 'nb-in-ref') {
            // Suggest properties of child containers/components
            const item = new vscode.CompletionItem('propertyName', vscode.CompletionItemKind.Field);
            item.detail = 'Input property name of the child container/component';
            item.sortText = '0_propertyName';
            item.preselect = true;
            item.insertText = hasTrailingEquals
                ? new vscode.SnippetString(`\${1:propertyName}`)
                : new vscode.SnippetString(`\${1:propertyName}="\${2}"`);
            items.push(item);
        }

        return items;
    }

    private provideMemberCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);

        for (const assoc of associations) {
            for (const member of assoc.members) {
                if (!member.isPublic) continue;

                const kind = member.kind === 'method'
                    ? vscode.CompletionItemKind.Method
                    : member.kind === 'getter'
                        ? vscode.CompletionItemKind.Property
                        : vscode.CompletionItemKind.Field;

                const item = new vscode.CompletionItem(member.name, kind);
                item.detail = `${member.type} — ${assoc.className}`;
                item.documentation = new vscode.MarkdownString(
                    `\`\`\`typescript\n(${member.kind}) ${member.name}: ${member.type}\n\`\`\`\nDefined in \`${assoc.className}\``
                );

                if (member.kind === 'method') {
                    item.insertText = new vscode.SnippetString(`${member.name}(\${1})`);
                }

                items.push(item);
            }
        }

        // Add model injections (changeDetector, elementManipulations, etc.)
        for (const injection of getAllModelInjections()) {
            const item = new vscode.CompletionItem(injection.name, vscode.CompletionItemKind.Property);
            item.detail = `${injection.type} — Model injection`;
            item.documentation = new vscode.MarkdownString(
                `\`\`\`typescript\n(injection) ${injection.name}: ${injection.type}\n\`\`\`\n${injection.desc}`
            );
            item.sortText = `1_${injection.name}`;
            item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            items.push(item);
        }

        return items;
    }

    private provideRepeatParamCompletions(prefix?: string): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const p = prefix ?? '';
        const names = prefix
            ? [
                { name: `${p}Item`, desc: 'Current iteration item' },
                { name: `${p}Index`, desc: 'Current iteration index (0-based)' },
                { name: `${p}Count`, desc: 'Total number of items' },
            ]
            : [
                { name: 'item', desc: 'Current iteration item' },
                { name: 'index', desc: 'Current iteration index (0-based)' },
                { name: 'count', desc: 'Total number of items' },
            ];

        for (const param of names) {
            const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Variable);
            item.detail = `Repeat parameter: ${param.desc}`;
            item.documentation = new vscode.MarkdownString(`Injected by \`nb-repeat\`: ${param.desc}`);
            items.push(item);
        }

        return items;
    }

    private provideEventParamCompletions(): vscode.CompletionItem[] {
        return injectedParamsToCompletions('nb-event', 'Event parameter');
    }

    private provideBoundParamCompletions(): vscode.CompletionItem[] {
        return injectedParamsToCompletions('nb-bound', 'Bound parameter');
    }

    private provideEntityNameCompletions(type: 'container' | 'component' | 'template'): vscode.CompletionItem[] {
        const entities = this.analyzer.getEntitiesByType(type);
        return entities.map(e => {
            const item = new vscode.CompletionItem(e.className, vscode.CompletionItemKind.Class);
            item.detail = `${type}: ${e.className}`;
            return item;
        });
    }

    private provideTransformerCompletions(): vscode.CompletionItem[] {
        const transformers = this.analyzer.getEntitiesByType('transformer');
        return transformers.map(e => {
            const name = e.className.charAt(0).toLowerCase() + e.className.slice(1);
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.detail = `Transformer: ${e.className}`;
            item.documentation = new vscode.MarkdownString(`Global transformer function from \`@Transformer()\` class \`${e.className}\`.`);
            item.insertText = new vscode.SnippetString(`${name}(\${1})`);
            return item;
        });
    }

    /**
     * Resolve chained member access like this.member. or this.a.b?.
     * Walks the chain, resolves the final type, and returns its members.
     */
    private provideChainedMemberCompletions(valueUpToCursor: string, document: vscode.TextDocument): vscode.CompletionItem[] | undefined {
        // Match this.foo. or this.foo?. or this.foo.bar. or this.foo.bar?.
        const chainMatch = valueUpToCursor.match(/this\.([\w]+(?:\??\.[\w]+)*)\??\.\s*$/);
        if (!chainMatch) return undefined;

        const chainStr = chainMatch[1];
        const parts = chainStr.split(/\??\./).filter(Boolean);
        if (parts.length === 0) return undefined;

        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        if (associations.length === 0) return undefined;

        // Resolve root member type
        let currentType: string | undefined;
        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, parts[0]);
            if (member) {
                currentType = member.type;
                break;
            }
        }
        if (!currentType) return undefined;

        // Walk intermediate chain
        for (let i = 1; i < parts.length; i++) {
            const found = this.analyzer.findMemberWithType(currentType, parts[i]);
            if (!found) return undefined;
            currentType = found.type;
        }

        // Get all members of the resolved type
        const typeMembers = this.analyzer.getTypeMembers(currentType);
        if (!typeMembers) return undefined;

        const ownerType = currentType.replace(/<.*>/, '').replace(/\[\]$/, '').replace(/\s*\|.*$/, '').trim();
        return typeMembers.filter(m => m.isPublic).map(m => {
            const kind = m.kind === 'method'
                ? vscode.CompletionItemKind.Method
                : m.kind === 'getter'
                    ? vscode.CompletionItemKind.Property
                    : vscode.CompletionItemKind.Field;

            const item = new vscode.CompletionItem(m.name, kind);
            item.detail = `${m.type} — ${ownerType}`;
            item.documentation = new vscode.MarkdownString(
                `\`\`\`typescript\n(${m.kind}) ${m.name}: ${m.type}\n\`\`\`\nDefined in \`${ownerType}\``
            );

            if (m.kind === 'method') {
                item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
            }

            return item;
        });
    }

    /**
     * Provide completions for model injection member access:
     * this.changeDetector. / this.elementManipulations. / this.elementManipulations.styles. / etc.
     */
    private provideModelInjectionMemberCompletions(valueUpToCursor: string): vscode.CompletionItem[] | undefined {
        // Match this.<injection>.<optional sub>.
        const injMatch = valueUpToCursor.match(/this\.([\w]+(?:\??\.[\w]+)*)\??\.\s*$/);
        if (!injMatch) return undefined;

        const parts = injMatch[1].split(/\??\./).filter(Boolean);
        if (parts.length === 0) return undefined;

        const injection = getModelInjection(parts[0]);
        if (!injection) return undefined;

        // Walk the chain to find the target members
        let members = injection.members;
        for (let i = 1; i < parts.length; i++) {
            const found = members.find(m => m.name === parts[i]);
            if (!found || !found.subMembers) return undefined;
            members = found.subMembers;
        }

        return members.map(m => {
            const kind = m.kind === 'method'
                ? vscode.CompletionItemKind.Method
                : vscode.CompletionItemKind.Property;

            const item = new vscode.CompletionItem(m.name, kind);
            item.detail = `${m.type} — ${injection.type}`;
            item.documentation = new vscode.MarkdownString(
                `\`\`\`typescript\n(${m.kind}) ${m.name}: ${m.type}\n\`\`\`\n${m.desc}`
            );

            if (m.kind === 'method') {
                item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
            }

            if (m.subMembers) {
                item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            }

            return item;
        });
    }

    /**
     * Provide completions for global object member access (e.g. console.log, Math.floor).
     */
    private provideGlobalMemberCompletions(valueUpToCursor: string): vscode.CompletionItem[] | undefined {
        const globalMatch = valueUpToCursor.match(/\b(\w+)\.\s*$/);
        if (!globalMatch) return undefined;

        const objName = globalMatch[1];
        const members = getGlobalObjectMembers(objName);
        if (!members) return undefined;

        return members.map(m => {
            const kind = m.kind === 'method'
                ? vscode.CompletionItemKind.Method
                : vscode.CompletionItemKind.Property;

            const item = new vscode.CompletionItem(m.name, kind);
            item.detail = `${m.type} — ${objName}`;
            item.documentation = new vscode.MarkdownString(m.desc);

            if (m.kind === 'method') {
                item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
            }

            return item;
        });
    }

    /**
     * Provide top-level global object, function, and constant suggestions.
     */
    private provideGlobalCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Global objects (console, Math, JSON, etc.)
        for (const g of getAllGlobalObjects()) {
            const item = new vscode.CompletionItem(g.name, vscode.CompletionItemKind.Module);
            item.detail = `${g.type} — Global`;
            item.documentation = new vscode.MarkdownString(g.desc);
            item.sortText = `2_${g.name}`;
            item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            items.push(item);
        }

        // Global functions (parseInt, setTimeout, fetch, etc.)
        for (const f of getAllGlobalFunctions()) {
            const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
            item.detail = `${f.type} — Global`;
            item.documentation = new vscode.MarkdownString(f.desc);
            item.sortText = `2_${f.name}`;
            item.insertText = new vscode.SnippetString(`${f.name}(\${1})`);
            items.push(item);
        }

        // Global constants (undefined, null, NaN, etc.)
        for (const c of getAllGlobalConstants()) {
            const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant);
            item.detail = `${c.type} — Global`;
            item.documentation = new vscode.MarkdownString(c.desc);
            item.sortText = `3_${c.name}`;
            items.push(item);
        }

        return items;
    }

    /**
     * Provide completions for event.* member access inside nb-event bindings.
     * Uses the shared `getAllEventMembers` registry so adding a new event
     * member to utils.ts is visible to both hover and completion automatically.
     */
    private provideEventMemberCompletions(eventSuffix?: string): vscode.CompletionItem[] {
        const eventType = eventSuffix ? getEventType(eventSuffix) : 'Event';
        return getAllEventMembers(eventType).map(m => {
            const kind = m.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property;
            const item = new vscode.CompletionItem(m.name, kind);
            item.detail = `${m.type} — ${eventType}`;
            item.documentation = new vscode.MarkdownString(m.desc);
            if (m.kind === 'method') {
                item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
            }
            return item;
        });
    }

    /**
     * Completions for `element.X`, `element.<sub>.X`, and `nativeElement.X`.
     * Sources data from the shared registries in utils.ts so it stays in sync
     * with hover documentation automatically.
     */
    private provideElementMemberCompletions(valueUpToCursor: string, tagName?: string): vscode.CompletionItem[] {
        // element.<sub>. → sub-API methods
        const subMatch = valueUpToCursor.match(/\belement\.(properties|attributes|styles|classes)\.\s*$/);
        if (subMatch) {
            const sub = subMatch[1];
            return getAllElementManipulationMembers(sub).map(m => {
                const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Method);
                item.detail = m.type;
                item.documentation = new vscode.MarkdownString(m.desc);
                item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
                return item;
            });
        }

        // element. → top-level ElementManipulations members
        if (valueUpToCursor.match(/\belement\.\s*$/)) {
            return getAllElementManipulationMembers().map(m => {
                const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Property);
                item.detail = m.type;
                item.documentation = new vscode.MarkdownString(m.desc);
                item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
                return item;
            });
        }

        // nativeElement. → DOM Element members + tag-specific members
        if (valueUpToCursor.match(/\bnativeElement\.\s*$/)) {
            const elementType = tagName ? getElementType(tagName) : 'HTMLElement';
            return getAllDomElementMembers(elementType).map(m => {
                const kind = m.kind === 'method' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property;
                const item = new vscode.CompletionItem(m.name, kind);
                item.detail = m.type;
                item.documentation = new vscode.MarkdownString(`${m.desc}  \n*${elementType}*`);
                if (m.kind === 'method') {
                    item.insertText = new vscode.SnippetString(`${m.name}(\${1})`);
                }
                return item;
            });
        }

        return [];
    }

    private isNTemplate(text: string): boolean {
        return /\bnb-\w/.test(text);
    }
}

/**
 * Build completion items from a handler's `injectedParams` registry entry, so
 * the names/types/descriptions stay in sync with hover documentation.
 */
function injectedParamsToCompletions(handlerName: string, label: string): vscode.CompletionItem[] {
    const handler = getHandlerInfo(handlerName);
    if (!handler) return [];
    return handler.injectedParams.map(p => {
        const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Variable);
        item.detail = `${p.type} — ${label}`;
        item.documentation = new vscode.MarkdownString(`Injected by \`${handlerName}\`: ${p.description}`);
        return item;
    });
}
