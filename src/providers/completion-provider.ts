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
import type { ParsedTemplate, TemplateAttribute, TemplateElement } from '../core/template-parser';
import { findBindingAtOffset, getAllLocalVars, getAllRepeatScopes, findElementAtOffset, camelToKebabCase } from '../core/template-parser';
import { parseTemplateCached } from '../core/template-parser-cache';
import { parseExpression, maskNonCode } from '../core/expression-parser';
import { DecoratorAnalyzer } from '../core/decorator-analyzer';
import {
    getElementType, getEventType,
    getTagSpecificAttributes, getTagSpecificProperties,
    getAllEventMembers, getAllDomElementMembers, getAllElementManipulationMembers,
    resolveChainType, inferItemType,
} from '../core/utils';
import {
    ALL_NB_ATTRIBUTES, PREFIX_ATTRIBUTES, COMMON_DOM_EVENTS,
    getHandlerInfo, isNAttribute
} from '../core/attribute-registry';
import {
    getGlobalObjectMembers, getAllGlobalObjects,
    getAllGlobalFunctions, getAllGlobalConstants
} from '../core/globals-registry';
import { getAllModelInjections, getModelInjection, getModelInjectionByType } from '../core/model-injections-registry';

/**
 * Module-level regex matching `<prefixAttr>:<suffixSoFar>` — or the W3C form
 * `data-<prefixAttr>--<suffixSoFar>` — at the end of a line. Built from
 * `PREFIX_ATTRIBUTES` once at load time rather than hard-coded — sorted
 * longest-first so e.g. `nb-in-ref` matches before `nb-in`. Captures:
 *   [1] base attribute name (e.g. `nb-event`), default mode
 *   [2] base attribute name including the `data-` prefix, W3C mode
 *   [3] the suffix typed so far (may be empty)
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
        // Suffix may contain '-' — aspect names are kebab-case
        // ('nb-aspect:drag-handle'), as are nb-var/nb-in property names
        // ('nb-in:user-id'). A '\w*'-only capture made suggestions vanish
        // the moment the user typed the first hyphen.
        // The leading lookbehind keeps a larger word ending in a prefix
        // attribute name ('foo-nb-event:') from counting as that attribute.
        return new RegExp(`(?<![\\w-])(?:(${sortedAlternation}):|(data-(?:${sortedAlternation}))--)([\\w-]*)$`);
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
    /**
     * Substring of the binding value from index 0 up to the cursor, taken
     * from a `maskNonCode` copy (string/template-literal text, comments and
     * regex literals blanked; offsets preserved). Strategies pattern-match
     * this to decide the cursor context — on the RAW text a dotted access
     * inside a string literal (`this.go('element.')`) triggered member
     * completions for prose (round-7 audit, R7-2).
     */
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
        // Injected repeat items / nb-var locals shadow globals at runtime,
        // so their dotted access must be tried before the globals catalog.
        ctx => this.strategyItemVarChain(ctx),
        ctx => this.strategyGlobalMemberAccess(ctx),
        ctx => this.strategyEventDotAccess(ctx),
        ctx => this.strategyRouterDotAccess(ctx),
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
     *   1. attribute-name context  → suggest `nb-*` attributes
     *   2. prefix:suffix context   → suggest event names / props / aspect names
     *   3. expression-value context → run an ordered strategy list
     * All stages share one `parseTemplateCached` parse per document version —
     * the tag/quote context for stages 1–2 is decided against the PARSED
     * template. (The previous `lastIndexOf('<')`/`'>'` line scan was derailed
     * by a quoted '>' or '<' inside an attribute value — `nb-if="a > b"`
     * silently killed stages 1–2 for the rest of the tag.)
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

        const parsed = parseTemplateCached(document);
        const enclosingTag = findOpenTagAtOffset(parsed, offset);
        const inAttrNameTerritory = enclosingTag !== undefined &&
            !isInsideAttributeValue(parsed, enclosingTag, offset);

        // Stage 1: prefix:suffix (`nb-event:|`, `nb-prop:c|`, W3C `data-nb-event--|`).
        // Must run BEFORE the attribute-name stage: the W3C form's `--`
        // separator consists of word/dash characters, so `data-nb-event--cl`
        // also LOOKS like an attribute name still being typed — the suffix
        // interpretation is the correct one whenever the pattern matches.
        // Gated on attribute-name position: without the guard, text content
        // or a quoted attribute value merely ENDING in `nb-event:cl` popped
        // event-name completions.
        const prefixMatch = charBefore.match(PREFIX_SUFFIX_REGEX);
        if (prefixMatch && inAttrNameTerritory) {
            // Normalize the W3C `data-nb-x` capture back to the canonical
            // `nb-x` handler name — suffix data (event names, aspect names,
            // attribute/property names) is mode-independent.
            const baseName = prefixMatch[1] ?? prefixMatch[2].substring(5);
            const tagName = enclosingTag.tagName;
            const hasTrailingEquals = this.detectTrailingEquals(charBefore, charAfter, baseName, tagName);
            return this.toList(this.provideSuffixCompletions(baseName, prefixMatch[3], document, tagName, hasTrailingEquals));
        }

        // Stage 2: attribute name (`<div nb-|`, W3C `<div data-nb-|`).
        // The cursor must sit after whitespace (possibly mid-word) — start of
        // line counts for multi-line tags.
        if (inAttrNameTerritory && /(\s|^)[\w-]*$/.test(charBefore)) {
            const hasTrailingEquals = this.detectTrailingEquals(charBefore, charAfter);
            // W3C compliance mode uses `data-nb-*` names with `--` meta
            // separators. Emit that form only when the user is actually
            // typing it — always offering both would double the list with
            // noise for the (default) non-W3C projects.
            const typedAttr = charBefore.match(/[\w-]*$/)?.[0] ?? '';
            const w3cForm = typedAttr.startsWith('d') && 'data-'.startsWith(typedAttr.substring(0, 5));
            return this.toList(this.provideAttributeNameCompletions(hasTrailingEquals, w3cForm));
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
        const exprOffset = offsetInValue - binding.expressionOffset;
        // Masked (offset-preserving) so string/comment content can't fake a
        // completion context — see the ValueCompletionContext field doc.
        const valueUpToCursor = maskNonCode(binding.value).substring(0, offsetInValue);

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
        // The lookbehind is load-bearing: without it, identifiers ENDING in
        // 'this' (`mythis.`) and chained `x.this.` triggered class-member
        // completions for a context that isn't the component instance.
        if (!/(?<![\w$.])this\.\s*$/.test(ctx.valueUpToCursor)) return undefined;
        return this.provideMemberCompletions(ctx.document);
    }

    private strategyModelInjectionChain(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideModelInjectionMemberCompletions(ctx.valueUpToCursor, ctx.document);
    }

    private strategyTypedChain(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideChainedMemberCompletions(ctx.valueUpToCursor, ctx.document);
    }

    /**
     * Member completions for dotted access on a repeat `item` (plain or
     * prefixed) or an `nb-var` local — `item.`, `outerItem.name.`,
     * `myVar.user.`. The item type is inferred from the nb-repeat collection
     * exactly like hover does; nb-var types resolve through the var's own
     * expression. Without this, hover knew the item type but completion
     * offered nothing after `item.`.
     */
    private strategyItemVarChain(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        const chainMatch = ctx.valueUpToCursor.match(/(?<![\w$.])([A-Za-z_$][\w$]*)((?:\??\.[A-Za-z_$][\w$]*)*)\??\.\s*$/);
        if (!chainMatch) return undefined;

        const base = chainMatch[1];
        const rest = chainMatch[2] ? chainMatch[2].split(/\??\./).filter(Boolean) : [];
        const associations = this.analyzer.getAssociationsForHtml(ctx.document.uri.fsPath);

        const resolveExprType = (expression: string, prefix?: string): string | undefined => {
            const exprInfo = parseExpression(expression, prefix);
            for (const ref of exprInfo.memberReferences) {
                const resolved = resolveChainType(
                    ref.chain,
                    associations,
                    (assoc, name) => this.analyzer.findMember(assoc, name),
                    (typeName, memberName) => this.analyzer.findMemberWithType(typeName, memberName)
                );
                if (resolved) return resolved;
            }
            return undefined;
        };

        let baseType: string | undefined;

        for (const scope of getAllRepeatScopes(ctx.parsed, ctx.offset, ownRepeatScopeExclusion(ctx.binding))) {
            const itemName = scope.prefix ? `${scope.prefix}Item` : 'item';
            if (base !== itemName) continue;
            const collectionType = resolveExprType(scope.repeatAttr.expression, scope.repeatAttr.expressionPrefix);
            if (collectionType) baseType = inferItemType(collectionType);
            break;
        }

        if (!baseType) {
            for (const lv of getAllLocalVars(ctx.parsed, ctx.offset, ctx.binding)) {
                if (base !== lv.varName) continue;
                baseType = resolveExprType(lv.attr.expression, lv.attr.expressionPrefix);
                break;
            }
        }

        if (!baseType || baseType === 'any') return undefined;

        // Walk the remaining chain segments to the type under the cursor
        let currentType: string = baseType;
        for (const part of rest) {
            const found = this.analyzer.findMemberWithType(currentType, part);
            if (!found) return undefined;
            currentType = found.type;
        }

        return this.typeMembersToCompletionItems(currentType);
    }

    private strategyGlobalMemberAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        return this.provideGlobalMemberCompletions(ctx.valueUpToCursor);
    }

    private strategyEventDotAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (ctx.binding.baseName !== 'nb-event') return undefined;
        if (!/\bevent\.\s*$/.test(ctx.valueUpToCursor)) return undefined;
        return this.provideEventMemberCompletions(ctx.binding.suffix);
    }

    /**
     * Member completions for the bare `router` param injected into nb-event
     * expressions (`router.go(…)`). `this.router.` chains resolve by declared
     * type elsewhere — this covers the injected identifier itself.
     */
    private strategyRouterDotAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (ctx.binding.baseName !== 'nb-event') return undefined;
        if (!/(?<![\w$.])router\.\s*$/.test(ctx.valueUpToCursor)) return undefined;
        const injection = getModelInjection('router');
        if (!injection) return undefined;
        return injection.members.map(m => {
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
            return item;
        });
    }

    private strategyElementDotAccess(ctx: ValueCompletionContext): vscode.CompletionItem[] | undefined {
        if (ctx.binding.baseName !== 'nb-event' && ctx.binding.baseName !== 'nb-bound') return undefined;
        const element = findElementAtOffset(ctx.parsed, ctx.binding.nameSpan.start);
        const items = this.provideElementMemberCompletions(ctx.valueUpToCursor, element?.tagName);
        return items.length > 0 ? items : undefined;
    }

    // ─── Additive value-completion strategies ──────────────────────────────

    private strategyRepeatParams(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        // ALL enclosing scopes contribute — in nested repeats the outer
        // prefixed params (outerItem, …) are just as valid as the inner ones.
        // For nested UNPREFIXED repeats the inner scope shadows the outer,
        // so duplicate names are suggested once (innermost wins).
        const items: vscode.CompletionItem[] = [];
        const seen = new Set<string>();
        for (const scope of getAllRepeatScopes(ctx.parsed, ctx.offset, ownRepeatScopeExclusion(ctx.binding))) {
            for (const item of this.provideRepeatParamCompletions(scope.prefix)) {
                const label = typeof item.label === 'string' ? item.label : item.label.label;
                if (seen.has(label)) continue;
                seen.add(label);
                items.push(item);
            }
        }
        return items;
    }

    private strategyLocalVars(ctx: ValueCompletionContext): vscode.CompletionItem[] {
        return getAllLocalVars(ctx.parsed, ctx.offset, ctx.binding).map(lv => {
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
        // No entity names for nb-component: it is a framework-managed MARKER
        // attribute — the runtime never reads a value from it (components are
        // wired by their custom-element tag), so suggesting names here would
        // invite dead markup.
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

        // Attribute name context — isNAttribute also resolves the W3C
        // `data-nb-*` / `--` form, which a plain ALL_NB_ATTRIBUTES lookup missed.
        if (!baseName) {
            return isNAttribute(combinedWord);
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
            // Completions insert the kebab-case spelling (the only one that
            // survives browser lowercasing) — match it as well as the raw name.
            return entries.some(p => p.name === combinedWord || camelToKebabCase(p.name) === combinedWord);
        }
        if (baseName === 'nb-aspect') {
            // Aspect suffixes are the runtime-registered (kebab-case) names —
            // the framework registers `DragHandle` as `drag-handle`, never
            // `dragHandle`.
            return this.analyzer.getEntitiesByType('aspect').some(a => a.name === combinedWord);
        }

        // For user-defined suffixes (nb-var, nb-in, nb-in-ref, nb-repeat):
        // heuristic — if the combined word contains 'nb-', it likely spans into the next attribute
        return !combinedWord.includes('nb-');
    }

    private provideAttributeNameCompletions(hasTrailingEquals: boolean, w3cForm: boolean = false): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        // W3C compliance mode: names carry the data- prefix and the meta
        // separator flips from ':' to '--' (mirrors Constants in the framework).
        const sep = w3cForm ? '--' : ':';

        for (const attr of ALL_NB_ATTRIBUTES) {
            const handler = getHandlerInfo(attr);
            if (!handler) continue;

            const label = w3cForm ? `data-${attr}` : attr;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
            item.detail = handler.displayName;
            item.documentation = new vscode.MarkdownString(handler.description);
            item.sortText = `0_${label}`; // sort before native HTML attributes
            item.preselect = true;

            if (handler.isPrefix && attr === 'nb-repeat') {
                // nb-repeat suffix is optional — treat like non-prefix
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(label)
                    : new vscode.SnippetString(`${label}="\${1}"`);
            } else if (handler.isPrefix && attr === 'nb-var') {
                // nb-var suffix is a user-defined variable name
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(`${label}${sep}\${1:name}`)
                    : new vscode.SnippetString(`${label}${sep}\${1:name}="\${2}"`);
            } else if (handler.isPrefix) {
                // For prefix attributes with known suffixes, insert the meta
                // separator and trigger suffix suggestions. (nb-value is NOT
                // a prefix attribute — routing it here produced an invalid
                // `nb-value:` insertion.)
                item.insertText = new vscode.SnippetString(`${label}${sep}`);
                item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
            } else if (handler.attribute === 'nb-default') {
                // nb-default has no value
                item.insertText = label;
            } else {
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(label)
                    : new vscode.SnippetString(`${label}="\${1}"`);
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
                // Suggest the runtime-registered name (kebab-case for names
                // without '-') — camelCasing the class name produced
                // suggestions the framework cannot resolve.
                const name = aspect.name;
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
                // The suffix must be authored in KEBAB-CASE: the browser
                // lowercases attribute names, and the runtime only converts
                // kebab→camel — `nb-prop:tabIndex` reaches the runtime as
                // `tabindex` and sets a useless expando. Only the kebab
                // spelling (`tab-index`) round-trips to the real `tabIndex`.
                const kebab = camelToKebabCase(entry.name);
                const item = new vscode.CompletionItem(kebab, vscode.CompletionItemKind.Field);
                item.detail = `DOM Property: ${entry.name}`;
                item.documentation = new vscode.MarkdownString(entry.desc);
                item.sortText = `0_${kebab}`;
                item.preselect = true;
                // Keep the camelCase property name findable while typing.
                item.filterText = `${kebab} ${entry.name}`;
                item.insertText = hasTrailingEquals
                    ? new vscode.SnippetString(kebab)
                    : new vscode.SnippetString(`${kebab}="\${1}"`);
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
        let hasAnalyzedMembers = false;

        for (const assoc of associations) {
            for (const member of assoc.members) {
                hasAnalyzedMembers = true;
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
                } else if (getModelInjectionByType(member.type)) {
                    // Members whose declared type is a framework injection
                    // (ChangeDetector, Router, …) have known sub-members —
                    // chain straight into them.
                    item.command = { command: 'editor.action.triggerSuggest', title: 'Trigger Suggest' };
                }

                items.push(item);
            }
        }

        // Model injections by conventional name — ONLY as a fallback when no
        // analysis data exists. DI is constructor-param based: the instance
        // property is whatever the user named the param, so with real member
        // data these fixed names are noise that contradicts diagnostics
        // (the typed param already appears as a regular member above).
        if (!hasAnalyzedMembers) {
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
            // Suggest the runtime-registered name — for components that's the
            // kebab-case form, for custom-named entities the custom name.
            const item = new vscode.CompletionItem(e.name, vscode.CompletionItemKind.Class);
            item.detail = `${type}: ${e.className}`;
            return item;
        });
    }

    private provideTransformerCompletions(): vscode.CompletionItem[] {
        const transformers = this.analyzer.getEntitiesByType('transformer');
        return transformers.map(e => {
            // The analyzer computes the runtime function name (custom names
            // from @Transformer('name') included) — don't re-derive it here.
            const name = e.transformerFunctionName ?? e.name;
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
        // The lookbehind keeps `mythis.foo.` / `x.this.foo.` from matching as
        // `this.foo.` (round-7 audit, R7-3 — same guard strategyAfterThisDot has).
        const chainMatch = valueUpToCursor.match(/(?<![\w$.])this\.([\w]+(?:\??\.[\w]+)*)\??\.\s*$/);
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

        return this.typeMembersToCompletionItems(currentType);
    }

    /** Enumerate a resolved type's public members as completion items. */
    private typeMembersToCompletionItems(currentType: string): vscode.CompletionItem[] | undefined {
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
    private provideModelInjectionMemberCompletions(valueUpToCursor: string, document: vscode.TextDocument): vscode.CompletionItem[] | undefined {
        // Match this.<injection>.<optional sub>. — with the same lookbehind
        // as provideChainedMemberCompletions (R7-3): `mythis.cd.` is not a
        // `this.cd.` chain.
        const injMatch = valueUpToCursor.match(/(?<![\w$.])this\.([\w]+(?:\??\.[\w]+)*)\??\.\s*$/);
        if (!injMatch) return undefined;

        const parts = injMatch[1].split(/\??\./).filter(Boolean);
        if (parts.length === 0) return undefined;

        // Resolve the injection by the root member's declared TYPE — DI is
        // ctor-param based, so `constructor(private cd: ChangeDetector)`
        // makes `this.cd.` the real chain. The conventional-name lookup is
        // kept only as a fallback when no analysis data exists.
        const associations = this.analyzer.getAssociationsForHtml(document.uri.fsPath);
        let injection: ReturnType<typeof getModelInjection>;
        for (const assoc of associations) {
            const member = this.analyzer.findMember(assoc, parts[0]);
            if (member) {
                injection = getModelInjectionByType(member.type);
                break;
            }
        }
        if (!injection && associations.length === 0) {
            injection = getModelInjection(parts[0]);
        }
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
 * The element whose OPENING tag contains the offset, or undefined. Decided
 * against the parsed template so quoted '<' / '>' inside attribute values
 * can't confuse the answer (the state-machine parser tracks quotes).
 */
function findOpenTagAtOffset(parsed: ParsedTemplate, offset: number): TemplateElement | undefined {
    const el = findElementAtOffset(parsed, offset);
    if (!el) return undefined;
    // findElementAtOffset's end is inclusive so typing at the very end of an
    // UNCLOSED tag (mid-edit, EOF) counts as inside — but for a closed tag,
    // tagSpan.end sits just past '>', which is outside.
    if (offset === el.tagSpan.end && parsed.text[el.tagSpan.end - 1] === '>') return undefined;
    // Positions inside '<tagName' itself are tag-name territory, not
    // attribute territory.
    if (offset < el.tagSpan.start + 1 + el.tagName.length) return undefined;
    return el;
}

/**
 * True when the offset sits inside an attribute VALUE of the element's
 * opening tag (quoted or unquoted). A value-less attribute's zero-length
 * span is anchored at the end of its name — that's still name territory.
 */
function isInsideAttributeValue(parsed: ParsedTemplate, el: TemplateElement, offset: number): boolean {
    for (const info of el.allAttributes.values()) {
        // No '=' was parsed: valueSpan is the zero-length anchor at the name
        // end. (With '=', valueSpan.start moves past '='/quote even when the
        // value itself is empty.)
        const hasValue = info.valueSpan.start > info.nameSpan.end || info.valueSpan.end > info.valueSpan.start;
        if (!hasValue) continue;
        if (offset >= info.valueSpan.start && offset <= info.valueSpan.end) return true;
    }
    return false;
}

/**
 * The binding itself when it is an `nb-repeat` — its own collection
 * expression is evaluated with the PARENT params at runtime (its item/index/
 * count don't exist yet), so the scope it creates must be excluded when
 * resolving names inside that expression.
 */
function ownRepeatScopeExclusion(binding: TemplateAttribute): TemplateAttribute | undefined {
    return binding.baseName === 'nb-repeat' ? binding : undefined;
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
