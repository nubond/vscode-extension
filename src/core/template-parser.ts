/**
 * template-parser.ts
 * Parses nHTML templates into a structured AST of nb-* bindings.
 */

import { buildLineIndex, offsetToLineChar } from './utils';

export interface TemplateAttribute {
    /** Full attribute name as-is: "nb-event:click:300" */
    fullName: string;
    /** Base handler name: "nb-event" */
    baseName: string;
    /** Suffix after colon: "click" for "nb-event:click" */
    suffix?: string;
    /** Extra suffix: "300" for "nb-event:click:300" */
    extraSuffix?: string;
    /** Raw attribute value (expression string) */
    value: string;
    /** Expression prefix character if present: '#', '@' — or '%' on nb-container only */
    expressionPrefix?: string;
    /** Expression after stripping the prefix */
    expression: string;
    /**
     * Offset of `expression` within `value` (0 without a prefix; the index
     * just past the prefix char otherwise). The runtime TRIMS attribute
     * values before prefix detection, so a prefix may sit after leading
     * whitespace — span math must use this offset, not `prefix ? 1 : 0`.
     */
    expressionOffset: number;
    /** Source span in the HTML document */
    nameSpan: SourceSpan;
    /** Source span of the attribute value */
    valueSpan: SourceSpan;
}

export interface TemplateElement {
    /** Tag name */
    tagName: string;
    /** nAttributes on this element */
    nbAttributes: TemplateAttribute[];
    /** All attributes (including non-nb) */
    allAttributes: Map<string, { value: string; nameSpan: SourceSpan; valueSpan: SourceSpan }>;
    /** Source span of the opening tag */
    tagSpan: SourceSpan;
    /** Position after the closing tag (or end of opening tag for void/self-closing elements) */
    elementEnd: number;
    /** Children elements */
    children: TemplateElement[];
    /** Parent element */
    parent?: TemplateElement;
}

export interface SourceSpan {
    start: number;
    end: number;
    line: number;
    character: number;
}

export interface ParsedTemplate {
    elements: TemplateElement[];
    /** Flat list of all nb-* attribute bindings for quick searching */
    allBindings: TemplateAttribute[];
    /** Raw HTML text */
    text: string;
}

const NB_PREFIX = 'nb-';
const DATA_NB_PREFIX = 'data-nb-';
// '%' (route slot) is honored by the framework's Container handler ONLY —
// ExpressionDetails recognizes just '#' and '@'. Stripping '%' on every
// attribute classified e.g. nb-value="%foo" as a non-evaluated route slot,
// hiding its real (evaluated, erroring) runtime behavior from diagnostics.
const EXPRESSION_PREFIXES = ['#', '@'];
const CONTAINER_EXPRESSION_PREFIXES = ['#', '@', '%'];

/**
 * Parse an HTML template string into a structured representation of nBindings.
 */
export function parseTemplate(html: string): ParsedTemplate {
    const elements: TemplateElement[] = [];
    const allBindings: TemplateAttribute[] = [];
    const lineIdx = buildLineIndex(html);

    /** Convert offset to SourceSpan-compatible line/character using pre-built index. */
    function lc(offset: number): { line: number; character: number } {
        return offsetToLineChar(lineIdx, offset);
    }

    // Use a state-machine-based parser that handles '>' inside quoted attribute values
    const commentRanges: { start: number; end: number }[] = [];
    // Raw-text element content (<script>/<style>). JS like `i<arr.length`
    // would otherwise parse `<arr` as an opening tag, and `{{ … }}` inside
    // inline scripts would become phantom nb-value bindings — notably in
    // @AppRoot's index.html, which almost always carries <script> tags.
    const rawTextRanges: { start: number; end: number }[] = [];
    const lowerHtml = html.toLowerCase();
    let i = 0;
    while (i < html.length) {
        // Find next '<' that starts a tag (skip comments, doctypes)
        if (html[i] !== '<') { i++; continue; }
        if (html.startsWith('<!--', i)) {
            // Skip the ENTIRE comment — previously only the '<' was stepped
            // over, so commented-out markup produced live bindings (phantom
            // diagnostics, outline entries, rename hits from dead code).
            const close = html.indexOf('-->', i + 4);
            const end = close === -1 ? html.length : close + 3;
            commentRanges.push({ start: i, end });
            i = end;
            continue;
        }
        if (html[i + 1] === '!') {
            // Doctype / CDATA-ish construct — skip to the closing '>'
            const gt = html.indexOf('>', i);
            i = gt === -1 ? html.length : gt + 1;
            continue;
        }
        if (html[i + 1] === '/') { i++; continue; }

        const tagStart = i;
        i++; // skip '<'

        // Read tag name
        const tagNameStart = i;
        while (i < html.length && /[\w-]/.test(html[i])) i++;
        const tagName = html.substring(tagNameStart, i);
        if (!tagName) continue;

        const tagPos = lc(tagStart);

        const element: TemplateElement = {
            tagName,
            nbAttributes: [],
            allAttributes: new Map(),
            tagSpan: { start: tagStart, end: tagStart, line: tagPos.line, character: tagPos.character },
            elementEnd: tagStart,
            children: [],
        };

        // Parse attributes
        while (i < html.length) {
            // Skip whitespace
            while (i < html.length && /\s/.test(html[i])) i++;

            // End of tag?
            if (i >= html.length) break;
            if (html[i] === '>') { i++; break; }
            if (html[i] === '/' && html[i + 1] === '>') { i += 2; break; }

            // Read attribute name
            const attrNameStart = i;
            while (i < html.length && /[\w:.-]/.test(html[i])) i++;
            const attrName = html.substring(attrNameStart, i);
            if (!attrName) { i++; continue; }

            const attrNamePos = lc(attrNameStart);
            const nameSpan: SourceSpan = {
                start: attrNameStart,
                end: attrNameStart + attrName.length,
                line: attrNamePos.line,
                character: attrNamePos.character,
            };

            // Skip whitespace
            while (i < html.length && /\s/.test(html[i])) i++;

            // Check for '='. A value-less attribute's (empty) span is
            // anchored at the end of the name — leaving it at the current
            // scan position (whitespace already skipped) put it ON the next
            // attribute's first character, which findBindingAtOffset's
            // inclusive end matched: hover/completion had a one-character
            // dead spot after every value-less nb-attribute.
            let attrValue = '';
            let valueOffset = nameSpan.end;
            if (i < html.length && html[i] === '=') {
                i++; // skip '='
                // Skip whitespace
                while (i < html.length && /\s/.test(html[i])) i++;

                if (i < html.length && (html[i] === '"' || html[i] === "'")) {
                    const quote = html[i];
                    i++; // skip opening quote
                    valueOffset = i;
                    const valueStart = i;
                    while (i < html.length && html[i] !== quote) i++;
                    attrValue = html.substring(valueStart, i);
                    if (i < html.length) i++; // skip closing quote
                } else {
                    // Unquoted value. Stop before a closing '/>' — consuming
                    // the '/' into the value hid the self-closing marker and
                    // turned `<my-tag value=foo/>` into an unclosed element.
                    valueOffset = i;
                    const valueStart = i;
                    while (i < html.length && !/[\s>]/.test(html[i]) &&
                           !(html[i] === '/' && html[i + 1] === '>')) i++;
                    attrValue = html.substring(valueStart, i);
                }
            }

            const valuePos = lc(valueOffset);
            const valueSpan: SourceSpan = {
                start: valueOffset,
                end: valueOffset + attrValue.length,
                line: valuePos.line,
                character: valuePos.character,
            };

            element.allAttributes.set(attrName, { value: attrValue, nameSpan, valueSpan });

            // Check if this is an nb-* attribute
            const normalizedName = normalizeAttributeName(attrName);
            if (normalizedName) {
                const parsed = parseNbAttribute(normalizedName, attrValue, nameSpan, valueSpan, attrName);
                if (parsed) {
                    element.nbAttributes.push(parsed);
                    allBindings.push(parsed);
                }
            }
        }

        element.tagSpan.end = i;
        element.elementEnd = i; // default; buildTree will update for non-void elements
        elements.push(element);

        // Raw-text elements: skip straight to the matching close tag so their
        // content is never scanned for tags or interpolations. (Like real HTML
        // parsing, a literal "</script>" inside a JS string ends the element.)
        const lowerTag = tagName.toLowerCase();
        if ((lowerTag === 'script' || lowerTag === 'style') &&
            !html.substring(tagStart, i).endsWith('/>')) {
            const closeIdx = findRawTextClose(lowerHtml, lowerTag, i);
            const contentEnd = closeIdx === -1 ? html.length : closeIdx;
            if (contentEnd > i) {
                rawTextRanges.push({ start: i, end: contentEnd });
            }
            i = contentEnd;
        }
    }

    // Build parent-child relationships from HTML structure
    buildTree(elements, html, commentRanges, rawTextRanges);

    // Scan for {{expression}} interpolations in text content.
    // '>' is allowed inside the expression ({{ a > b }} is valid), and so is
    // '<' when it does NOT start a real tag — HTML's own text rules only end
    // a text node at '<' followed by a letter, '/' or '!', so `{{ a < b }}`
    // is live at runtime (posthtml keeps it one text node) and must be
    // modeled. A real tag start still terminates the scan so a binding can
    // never span markup.
    const INTERP_CHAR = String.raw`(?:[^}<]|<(?![a-zA-Z/!]))`;
    const interpolationRegex = new RegExp(
        String.raw`\{\{(${INTERP_CHAR}*(?:\}${INTERP_CHAR}${INTERP_CHAR}*)*)\}\}`, 'g');
    let intMatch: RegExpExecArray | null;
    let tagScanIdx = 0; // elements are in document order; advance monotonically
    while ((intMatch = interpolationRegex.exec(html)) !== null) {
        const fullMatchStart = intMatch.index;
        // Skip if inside a comment or raw-text (<script>/<style>) content
        if (commentRanges.some(r => fullMatchStart >= r.start && fullMatchStart < r.end)) continue;
        if (rawTextRanges.some(r => fullMatchStart >= r.start && fullMatchStart < r.end)) continue;
        // Skip if inside an opening tag (attribute value). Checked against the
        // parsed elements' quote-aware tag spans — the previous backward
        // character scan was confused by '>' inside quoted attribute values.
        while (tagScanIdx < elements.length && elements[tagScanIdx].tagSpan.end <= fullMatchStart) {
            tagScanIdx++;
        }
        const enclosing = elements[tagScanIdx];
        if (enclosing && fullMatchStart >= enclosing.tagSpan.start && fullMatchStart < enclosing.tagSpan.end) {
            continue;
        }

        const exprRaw = intMatch[1];
        const valueStart = fullMatchStart + 2; // after {{

        const { expressionPrefix, expression, expressionOffset } =
            detectExpressionPrefix(exprRaw, EXPRESSION_PREFIXES);

        const valuePos = lc(valueStart);
        const namePos = lc(fullMatchStart);

        const binding: TemplateAttribute = {
            fullName: 'nb-value',
            baseName: 'nb-value',
            suffix: undefined,
            extraSuffix: undefined,
            value: exprRaw,
            expressionPrefix,
            expression,
            expressionOffset,
            nameSpan: { start: fullMatchStart, end: fullMatchStart + 2, line: namePos.line, character: namePos.character },
            valueSpan: { start: valueStart, end: valueStart + exprRaw.length, line: valuePos.line, character: valuePos.character },
        };

        allBindings.push(binding);
    }

    return { elements, allBindings, text: html };
}

/**
 * True when a binding's value is evaluated as an expression at runtime.
 * '@' (constant literal) and '%' (route slot) values are never evaluated —
 * member references found inside them are literal text, not code. Every
 * provider that extracts member references must honor this, or literals get
 * counted as references and rewritten by rename.
 */
export function isEvaluatedBinding(binding: Pick<TemplateAttribute, 'expressionPrefix'>): boolean {
    return binding.expressionPrefix !== '@' && binding.expressionPrefix !== '%';
}

/**
 * Normalize attribute name: strip data- prefix, handle W3C mode.
 * Returns null if not an nb-* attribute.
 */
export function normalizeAttributeName(name: string): string | null {
    if (name.startsWith(NB_PREFIX)) {
        return name;
    }
    if (name.startsWith(DATA_NB_PREFIX)) {
        // Convert data-nb-event--click to nb-event:click
        const withoutData = name.substring(5);
        return withoutData.replace(/--/g, ':');
    }
    return null;
}

/**
 * Parse an nb-* attribute into structured form.
 *
 * `rawName` is the attribute name as written in the source (W3C form
 * included) — needed because normalization conflates ':' and '--', which
 * the runtime treats as DIFFERENT characters inside an nb-attr suffix.
 */
function parseNbAttribute(name: string, value: string, nameSpan: SourceSpan, valueSpan: SourceSpan, rawName: string = name): TemplateAttribute | null {
    const parts = name.split(':');
    const baseName = parts[0];
    let suffix: string | undefined = parts[1];
    let extraSuffix: string | undefined = parts[2];
    let fullName = name;

    // The runtime's Attributes handler takes the ENTIRE raw remainder after
    // the prefix+separator as the attribute name, VERBATIM — `nb-attr:xlink:href`
    // targets the namespaced attribute `xlink:href`, and in W3C mode
    // `data-nb-attr--xlink--href` targets the LITERAL attribute `xlink--href`
    // (the runtime never converts '--' back to ':'; the ':' spelling
    // `data-nb-attr--xlink:href` is how `xlink:href` is addressed there).
    // The remainder must therefore come from the RAW source name, not the
    // normalized one. Only nb-event uses a second separator segment
    // (debounce ms).
    if (baseName === 'nb-attr' && suffix !== undefined) {
        const rawPrefix = rawName.startsWith(DATA_NB_PREFIX) ? 'data-nb-attr--' : 'nb-attr:';
        if (rawName.startsWith(rawPrefix)) {
            suffix = rawName.substring(rawPrefix.length);
            extraSuffix = undefined;
            fullName = 'nb-attr:' + suffix;
        }
    }

    const prefixes = baseName === 'nb-container' ? CONTAINER_EXPRESSION_PREFIXES : EXPRESSION_PREFIXES;
    const { expressionPrefix, expression, expressionOffset } = detectExpressionPrefix(value, prefixes);

    return {
        fullName,
        baseName,
        suffix,
        extraSuffix,
        value,
        expressionPrefix,
        expression,
        expressionOffset,
        nameSpan,
        valueSpan,
    };
}

/**
 * Detect an expression prefix the way the runtime does: attribute values are
 * TRIMMED before prefix detection (`Attributes`' constructor trims, and
 * `ExpressionDetails` trims again), so `" @Version 2"` is a constant literal
 * at runtime, not an evaluated expression. The prefix is therefore checked at
 * the first non-whitespace character; `expressionOffset` records where the
 * remaining expression starts inside the raw value so span math stays exact.
 */
function detectExpressionPrefix(
    value: string,
    prefixes: string[]
): { expressionPrefix: string | undefined; expression: string; expressionOffset: number } {
    let ws = 0;
    while (ws < value.length && /\s/.test(value[ws])) ws++;
    if (ws < value.length && prefixes.includes(value[ws])) {
        return {
            expressionPrefix: value[ws],
            expression: value.substring(ws + 1),
            expressionOffset: ws + 1,
        };
    }
    return { expressionPrefix: undefined, expression: value, expressionOffset: 0 };
}



/**
 * Simple tree building based on matching opening/closing tags.
 */
function buildTree(
    elements: TemplateElement[],
    html: string,
    commentRanges: { start: number; end: number }[] = [],
    rawTextRanges: { start: number; end: number }[] = []
): void {
    // Build a map of closing tag positions for each tag name
    // Then assign parent pointers by matching open/close tag nesting
    const VOID_ELEMENTS = new Set([
        'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'
    ]);

    // Elements whose unclosed previous sibling of the same tag is implicitly
    // closed by the next sibling's start tag (`<li>a<li>b`). Minimal subset of
    // the HTML implied-close rules — enough to keep nb-var / nb-repeat scopes
    // from leaking across siblings written without explicit close tags.
    const IMPLIED_SIBLING_CLOSE = new Set(['li', 'option', 'tr', 'td', 'th', 'dt', 'dd', 'p']);

    // Find all closing tags: </tagName> — ignoring any inside HTML comments
    // (a commented-out `</div>` must not steal the close of a live element).
    const closingTagRegex = /<\/([a-zA-Z][\w-]*)\s*>/g;
    const closingTags: { tagName: string; start: number; end: number }[] = [];
    let closeMatch: RegExpExecArray | null;
    while ((closeMatch = closingTagRegex.exec(html)) !== null) {
        const idx = closeMatch.index;
        if (commentRanges.some(r => idx >= r.start && idx < r.end)) continue;
        // A literal "</div>" inside <script>/<style> content must not steal
        // the close of a live element. (The raw-text element's own close tag
        // sits exactly AT the range end, so it is kept.)
        if (rawTextRanges.some(r => idx >= r.start && idx < r.end)) continue;
        closingTags.push({
            tagName: closeMatch[1].toLowerCase(),
            start: idx,
            end: idx + closeMatch[0].length,
        });
    }

    // For each opening tag, find its matching closing tag to determine true element end
    // Use a simple stack-based approach for nesting
    // Process elements in order, assigning closing positions
    const elementEnds = new Map<TemplateElement, number>();

    // Use a copy of closing tags as a queue
    let closeIdx = 0;

    // Simple approach: process opening tags in order, use a nesting stack
    const openStack: { el: TemplateElement; tagName: string }[] = [];

    /**
     * Match a closing tag against the open stack. Unclosed descendants above
     * the matching entry (e.g. `<ul><li>…</ul>` — the `li` never closed) are
     * implicitly closed at the closing tag's start, so they don't swallow
     * later siblings as children.
     */
    function consumeClosingTag(ct: { tagName: string; start: number; end: number }): void {
        for (let j = openStack.length - 1; j >= 0; j--) {
            if (openStack[j].tagName === ct.tagName) {
                for (let k = openStack.length - 1; k > j; k--) {
                    elementEnds.set(openStack[k].el, ct.start);
                }
                elementEnds.set(openStack[j].el, ct.end);
                openStack.splice(j);
                break;
            }
        }
    }

    for (const el of elements) {
        const tagNameLower = el.tagName.toLowerCase();

        // First, consume any closing tags that appear before this element
        while (closeIdx < closingTags.length && closingTags[closeIdx].start < el.tagSpan.start) {
            consumeClosingTag(closingTags[closeIdx]);
            closeIdx++;
        }

        // Implied close: a new <li> (etc.) closes a still-open sibling <li>
        const top = openStack[openStack.length - 1];
        if (top && IMPLIED_SIBLING_CLOSE.has(tagNameLower) && top.tagName === tagNameLower) {
            elementEnds.set(top.el, el.tagSpan.start);
            openStack.pop();
        }

        if (!VOID_ELEMENTS.has(tagNameLower)) {
            // Check for self-closing (tag ends with />)
            const tagText = html.substring(el.tagSpan.start, el.tagSpan.end);
            if (!tagText.endsWith('/>')) {
                openStack.push({ el, tagName: tagNameLower });
            }
        }
    }

    // Consume remaining closing tags
    while (closeIdx < closingTags.length) {
        consumeClosingTag(closingTags[closeIdx]);
        closeIdx++;
    }

    // Elements still open at EOF (no closing tag anywhere — mid-typing, or
    // fragment templates without a closing root) extend to the end of input.
    // Leaving them at the default tagSpan.end collapsed their scope: children
    // were orphaned and nb-repeat / nb-var lookups inside them found nothing.
    for (const entry of openStack) {
        if (!elementEnds.has(entry.el)) {
            elementEnds.set(entry.el, html.length);
        }
    }

    // Now build parent-child with proper element end positions
    const parentStack: { el: TemplateElement; end: number }[] = [];
    for (const el of elements) {
        const elEnd = elementEnds.get(el) ?? el.tagSpan.end;

        // Pop elements that have ended before this one starts
        while (parentStack.length > 0 && parentStack[parentStack.length - 1].end <= el.tagSpan.start) {
            parentStack.pop();
        }

        if (parentStack.length > 0) {
            el.parent = parentStack[parentStack.length - 1].el;
            parentStack[parentStack.length - 1].el.children.push(el);
        }

        el.elementEnd = elEnd;
        parentStack.push({ el, end: elEnd });
    }
}

/**
 * Find the nb-* attribute at a given offset in the HTML text.
 * Returns the attribute and whether the position is in the name or value portion.
 */
export function findBindingAtOffset(parsed: ParsedTemplate, offset: number): { binding: TemplateAttribute; inValue: boolean } | undefined {
    for (const binding of parsed.allBindings) {
        if (offset >= binding.nameSpan.start && offset < binding.nameSpan.end) {
            return { binding, inValue: false };
        }
        if (offset >= binding.valueSpan.start && offset <= binding.valueSpan.end) {
            return { binding, inValue: true };
        }
    }
    return undefined;
}

/**
 * Find the element whose opening tag contains the given offset.
 */
export function findElementAtOffset(parsed: ParsedTemplate, offset: number): TemplateElement | undefined {
    for (const el of parsed.elements) {
        if (offset >= el.tagSpan.start && offset <= el.tagSpan.end) {
            return el;
        }
    }
    return undefined;
}

/**
 * Find the deepest element that encloses the given offset (including text content between tags).
 */
export function findEnclosingElement(parsed: ParsedTemplate, offset: number): TemplateElement | undefined {
    let best: TemplateElement | undefined;
    for (const el of parsed.elements) {
        if (offset >= el.tagSpan.start && offset < el.elementEnd) {
            if (!best || el.tagSpan.start >= best.tagSpan.start) {
                best = el;
            }
        }
    }
    return best;
}

/**
 * Check if a position is inside an nb-repeat scope (has an ancestor with nb-repeat).
 *
 * `excludeAttr`: the binding whose expression is being analyzed, when that
 * binding is itself an `nb-repeat`. The repeat's OWN collection expression is
 * evaluated with the parent params — its own item/index/count don't exist yet
 * — so the scope contributed by that same attribute must not count.
 */
export function isInRepeatScope(parsed: ParsedTemplate, offset: number, excludeAttr?: TemplateAttribute): { repeatAttr: TemplateAttribute; prefix?: string } | undefined {
    return getAllRepeatScopes(parsed, offset, excludeAttr)[0];
}

/**
 * Collect ALL nb-repeat scopes from the element at offset up through ancestors.
 * Returns array from innermost to outermost. See `isInRepeatScope` for the
 * `excludeAttr` semantics (a repeat's own expression is outside its own scope).
 */
export function getAllRepeatScopes(parsed: ParsedTemplate, offset: number, excludeAttr?: TemplateAttribute): { repeatAttr: TemplateAttribute; prefix?: string }[] {
    const element = findElementAtOffset(parsed, offset) ?? findEnclosingElement(parsed, offset);
    if (!element) return [];

    const scopes: { repeatAttr: TemplateAttribute; prefix?: string }[] = [];
    let current: TemplateElement | undefined = element;
    while (current) {
        for (const attr of current.nbAttributes) {
            if (attr.baseName === 'nb-repeat' && attr !== excludeAttr) {
                // The browser ASCII-lowercases attribute names, and the
                // runtime uses the lowercased remainder VERBATIM as the
                // prefix (`Repeat.ts` + `getContextParameterName`):
                // `nb-repeat:myList` injects `mylistItem`, never
                // `myListItem`. Model the runtime name, not the source text.
                scopes.push({ repeatAttr: attr, prefix: attr.suffix?.toLowerCase() });
            }
        }
        current = current.parent;
    }
    return scopes;
}

/**
 * Reserved context names (mirror of the framework's
 * `Constants.RESERVED_CONTEXT_NAMES`, lowercased). The Variables handler
 * refuses to CREATE an nb-var with one of these names — such a var never
 * exists at runtime, so scope helpers must not report it as a live local.
 */
export const RESERVED_CONTEXT_NAMES: ReadonlySet<string> = new Set<string>([
    'item', 'index', 'count', 'nativeelement', 'element', 'event',
    'unsubscribe', 'router', 'data',
]);

/**
 * Collect ALL nb-var local variables visible at the given offset.
 * Walks up from the element at offset through ancestors, collecting nb-var
 * attributes. Returns array from innermost to outermost scope.
 *
 * Names the runtime refuses to create (reserved context names) are excluded.
 * (Transformer-name collisions are also refused at runtime but need analyzer
 * data — the diagnostics provider applies that extra filter itself.)
 *
 * `consumer`: the binding whose expression is being analyzed. The runtime
 * bind sequence is `repeat → variables → everything else`, and switch cases
 * are evaluated with the parent switch's params, so visibility depends on
 * WHICH handler consumes the expression:
 * - `nb-repeat`: the collection expression runs BEFORE the element's own
 *   vars exist — own-element vars are excluded (ancestors stay).
 * - `nb-case` / `nb-default`: evaluated inside the parent switch's bind with
 *   the SWITCH element's params — the case element's own vars are excluded.
 * - `nb-var`: the FIRST var on an element evaluates with the untouched
 *   parent params (no sibling vars, not even itself); from the second var on
 *   the whole pre-seeded var map applies (all sibling names defined, later
 *   ones still `undefined`) — mirroring `Variables.bind`.
 * Every other handler binds after `variables` and sees all own-element vars.
 */
export function getAllLocalVars(
    parsed: ParsedTemplate,
    offset: number,
    consumer?: TemplateAttribute
): { varName: string; attr: TemplateAttribute }[] {
    const element = findElementAtOffset(parsed, offset) ?? findEnclosingElement(parsed, offset);
    if (!element) return [];

    const vars: { varName: string; attr: TemplateAttribute }[] = [];
    let current: TemplateElement | undefined = element;
    while (current) {
        const ownsConsumer = consumer !== undefined && current.nbAttributes.includes(consumer);
        let skipElement = false;
        if (ownsConsumer) {
            if (consumer!.baseName === 'nb-repeat' ||
                consumer!.baseName === 'nb-case' ||
                consumer!.baseName === 'nb-default') {
                skipElement = true;
            } else if (consumer!.baseName === 'nb-var') {
                // First CREATED var on the element → sees no sibling vars.
                // (Approximation: "first" is by document order among vars the
                // runtime creates; the analyzer-dependent transformer filter
                // is applied only by diagnostics.)
                const createdVars = current.nbAttributes.filter(a =>
                    a.baseName === 'nb-var' && a.suffix &&
                    !RESERVED_CONTEXT_NAMES.has(kebabToCamelCase(a.suffix).toLowerCase()));
                skipElement = createdVars.length > 0 && createdVars[0] === consumer;
            }
        }

        if (!skipElement) {
            for (const attr of current.nbAttributes) {
                if (attr.baseName === 'nb-var' && attr.suffix) {
                    const varName = kebabToCamelCase(attr.suffix);
                    if (RESERVED_CONTEXT_NAMES.has(varName.toLowerCase())) continue;
                    vars.push({ varName, attr });
                }
            }
        }
        current = current.parent;
    }
    return vars;
}

/**
 * Find the close tag of a raw-text element (<script>/<style>). The tag name
 * must be followed by '>', '/', whitespace, or EOF — a plain indexOf matched
 * tag-name PREFIXES, so a literal `</scripty>` inside a script terminated the
 * raw-text range early (matches HTML's real raw-text scanning rule).
 */
function findRawTextClose(lowerHtml: string, lowerTag: string, from: number): number {
    const needle = '</' + lowerTag;
    let idx = lowerHtml.indexOf(needle, from);
    while (idx !== -1) {
        const after = lowerHtml[idx + needle.length];
        if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
            return idx;
        }
        idx = lowerHtml.indexOf(needle, idx + 1);
    }
    return -1;
}

/**
 * Convert kebab-case to camelCase (e.g. "date-time" → "dateTime").
 * Mirror of the framework's `Helpers.fromKebabToCamelCase` as applied to
 * nb-var suffixes: the browser lowercases HTML attribute names (hence the
 * toLowerCase), then the framework only rewrites `-` followed by a LETTER —
 * a digit-initial segment keeps its dash (`user-2fa` stays `user-2fa`), and
 * a trailing dash survives. Exported so providers that need per-attribute
 * var names (not just the aggregated getAllLocalVars view) share the mapping.
 */
export function kebabToCamelCase(value: string): string {
    return value.toLowerCase().replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Convert camelCase to kebab-case (e.g. "tabIndex" → "tab-index").
 * Mirror of the framework's `Helpers.fromCamelToKebabCase`: every uppercase
 * letter becomes `-` + lowercase, except at position 0 where it is just
 * lowercased. This is the AUTHORING direction for attribute suffixes — the
 * browser lowercases attribute names, so a camelCase suffix written in HTML
 * never reaches the runtime; only its kebab-case spelling round-trips back
 * to the intended camelCase name via `fromKebabToCamelCase`.
 */
export function camelToKebabCase(value: string): string {
    return value.replace(/[A-Z]/g, (match, index: number) =>
        index > 0 ? '-' + match.toLowerCase() : match.toLowerCase());
}
