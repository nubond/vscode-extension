/**
 * expression-parser.ts
 * Parses JavaScript expressions found in nb-* attribute values.
 * Extracts member access references (this.X, this.X.Y, this.method()) for
 * go-to-definition, references, and autocompletion.
 */

import { THIS_PREFIX_LEN } from './utils';

export interface MemberReference {
    /** The full member access chain e.g. "this.foo.bar" */
    fullExpression: string;
    /** The root member name after 'this.' e.g. "foo" */
    rootMember: string;
    /** Whether this appears to be a method call */
    isMethodCall: boolean;
    /** Offset within the expression string where 'this.' starts */
    start: number;
    /** Offset where 'this.member' ends (before the dot of next member or end) */
    end: number;
    /** The full chain of member accesses ["foo", "bar"] */
    chain: string[];
    /** Width of each separator between chain segments (1 for '.', 2 for '?.') */
    separators: number[];
}

export interface ExpressionInfo {
    /** Raw expression string (after prefix stripping) */
    raw: string;
    /** Expression prefix: '#', '@', '%' or undefined */
    prefix?: string;
    /** All this.X member references found */
    memberReferences: MemberReference[];
    /** Whether this is a template literal */
    isTemplateLiteral: boolean;
    /** All sub-expressions if comma-separated */
    subExpressions: string[];
}

/**
 * Parse an expression from an nb-* attribute value, extracting all
 * `this.member` references.
 */
export function parseExpression(rawValue: string, prefix?: string): ExpressionInfo {
    const expression = rawValue;
    const memberReferences = extractMemberReferences(expression);
    const isTemplateLiteral = expression.includes('`');
    const subExpressions = splitExpressions(expression);

    return {
        raw: expression,
        prefix,
        memberReferences,
        isTemplateLiteral,
        subExpressions,
    };
}

/**
 * Replace non-code spans of an expression with spaces, preserving length and
 * offsets: string literal contents, template-literal text (the `${ … }`
 * interiors stay live — they are code), block comments, and line comments.
 * `this.x` inside a string literal is prose, not a member reference —
 * extracting it produced false diagnostics and rename edits inside strings.
 *
 * Exported so providers doing their own identifier scans (semantic tokens)
 * share the exact same notion of "code" instead of re-implementing it.
 */
export function maskNonCode(expression: string): string {
    const chars = expression.split('');
    const n = expression.length;
    const blank = (from: number, to: number): void => {
        for (let k = from; k < to && k < n; k++) {
            if (chars[k] !== '\n') chars[k] = ' ';
        }
    };

    // Template-literal state. `${ … }` interiors are code and can themselves
    // contain strings, comments, and whole nested templates — the previous
    // brace-depth-only skip left those inner literals unmasked (phantom
    // member references) and miscounted braces inside strings. Each stack
    // entry is the '{' depth of one open interpolation, so a '}' is
    // attributed to either the interpolation close or an object literal
    // inside it.
    const interpolationDepths: number[] = [];
    let inTemplateText = false;

    let i = 0;
    while (i < n) {
        const ch = expression[i];

        if (inTemplateText) {
            if (ch === '\\') {
                chars[i] = ' ';
                if (i + 1 < n && chars[i + 1] !== '\n') chars[i + 1] = ' ';
                i += 2;
                continue;
            }
            if (ch === '`') { inTemplateText = false; i++; continue; }
            if (ch === '$' && expression[i + 1] === '{') {
                interpolationDepths.push(0);
                inTemplateText = false;
                i += 2;
                continue;
            }
            if (chars[i] !== '\n') chars[i] = ' ';
            i++;
            continue;
        }

        if (ch === "'" || ch === '"') {
            const start = i;
            i++;
            while (i < n && expression[i] !== ch) {
                if (expression[i] === '\\') i++;
                i++;
            }
            i++; // closing quote (or past end)
            blank(start + 1, Math.min(i - 1, n));
            continue;
        }

        if (ch === '/' && expression[i + 1] === '*') {
            const start = i;
            const close = expression.indexOf('*/', i + 2);
            const end = close === -1 ? n : close + 2;
            blank(start, end);
            i = end;
            continue;
        }

        if (ch === '/' && expression[i + 1] === '/') {
            const start = i;
            let end = expression.indexOf('\n', i);
            if (end === -1) end = n;
            blank(start, end);
            i = end;
            continue;
        }

        // Regex literal. A '/' that isn't a comment is either division or a
        // regex — decided (like JS lexers do) by what precedes it: after a
        // value (identifier, ')', ']', number…) it's division; after an
        // operator/opening bracket/start it's a regex. Without this, a quote
        // or '//' INSIDE a regex ( /['"]/ ) derailed the string/comment
        // scanners and blanked live code after the literal.
        if (ch === '/' && regexCanStartHere(chars, i)) {
            const close = findRegexEnd(expression, i);
            if (close !== -1) {
                blank(i + 1, close); // keep the delimiters, blank the pattern
                // Blank the flags too — 'g'/'i' would read as identifiers.
                let k = close + 1;
                while (k < n && /[a-z]/i.test(expression[k])) { chars[k] = ' '; k++; }
                i = k;
                continue;
            }
        }

        if (ch === '`') {
            inTemplateText = true;
            i++;
            continue;
        }

        if (interpolationDepths.length > 0 && (ch === '{' || ch === '}')) {
            const top = interpolationDepths.length - 1;
            if (ch === '{') {
                interpolationDepths[top]++;
            } else if (interpolationDepths[top] === 0) {
                // Interpolation closed — back to masking the template's text
                interpolationDepths.pop();
                inTemplateText = true;
            } else {
                interpolationDepths[top]--;
            }
            i++;
            continue;
        }

        i++;
    }

    return chars.join('');
}

/**
 * True when a '/' at index `i` can begin a regex literal: at expression start
 * or after an operator / opening bracket / separator. After a value token
 * (identifier char, ')', ']', quote) it's division. Checked against the
 * masked-so-far `chars` so already-blanked regions read as spaces.
 */
function regexCanStartHere(chars: string[], i: number): boolean {
    for (let k = i - 1; k >= 0; k--) {
        const c = chars[k];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
        return '([{,;=:!&|?+-*%^~<>'.includes(c);
    }
    return true; // start of expression
}

/**
 * Index of the unescaped closing '/' of a regex literal starting at `start`,
 * honoring character classes ('/' inside [...] does not terminate). Returns
 * -1 when unterminated (or broken by a newline) — the caller then treats the
 * '/' as division rather than masking to end-of-input.
 */
function findRegexEnd(expression: string, start: number): number {
    let inClass = false;
    for (let j = start + 1; j < expression.length; j++) {
        const c = expression[j];
        if (c === '\\') { j++; continue; }
        if (c === '\n') return -1;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) return j;
    }
    return -1;
}

/**
 * Extract all `this.X` member access references from an expression.
 */
function extractMemberReferences(expression: string): MemberReference[] {
    const refs: MemberReference[] = [];
    // Run the scan over a masked copy (same length, so all offsets are valid
    // in the original): string/template-literal text and comments blanked.
    const masked = maskNonCode(expression);

    // Match `this.` followed by identifier chains (supports both `.` and `?.` separators)
    const regex = /\bthis\.([$\w]+(?:\?\.[$\w]+|(?<!\?)(?:\.[$\w]+))*)\s*(\()?/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(masked)) !== null) {
        const fullChain = match[1];
        const isMethodCall = match[2] === '(';  // Note: match[2] is now capture group 2
        // Split on `?.` or `.` while tracking separator widths
        const chain: string[] = [];
        const separators: number[] = [];
        const segRegex = /(\?\.|\.)/g;
        let lastIdx = 0;
        let segMatch: RegExpExecArray | null;
        while ((segMatch = segRegex.exec(fullChain)) !== null) {
            chain.push(fullChain.substring(lastIdx, segMatch.index));
            separators.push(segMatch[1].length); // 1 for '.', 2 for '?.'
            lastIdx = segMatch.index + segMatch[1].length;
        }
        chain.push(fullChain.substring(lastIdx));

        const rootMember = chain[0];
        const start = match.index;
        const end = match.index + THIS_PREFIX_LEN + fullChain.length;

        refs.push({
            fullExpression: 'this.' + fullChain,
            rootMember,
            isMethodCall,
            start,
            end,
            chain,
            separators,
        });
    }

    return refs;
}

/**
 * Split comma-separated expressions (multi-statement).
 * Respects parentheses, brackets, template literals, and string boundaries.
 */
function splitExpressions(expression: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inString: string | null = null;
    let inTemplate = false;
    let templateDepth = 0;

    for (let i = 0; i < expression.length; i++) {
        const ch = expression[i];

        if (inString) {
            current += ch;
            if (ch === inString) {
                // Count consecutive backslashes before this quote
                let backslashes = 0;
                for (let j = i - 1; j >= 0 && expression[j] === '\\'; j--) backslashes++;
                if (backslashes % 2 === 0) {
                    inString = null;
                }
            }
            continue;
        }

        if (inTemplate) {
            current += ch;
            if (ch === '`') {
                // Count consecutive backslashes before the backtick
                let backslashes = 0;
                for (let j = i - 1; j >= 0 && expression[j] === '\\'; j--) backslashes++;
                if (backslashes % 2 === 0) {
                    inTemplate = false;
                }
            } else if (ch === '$' && i + 1 < expression.length && expression[i + 1] === '{') {
                templateDepth++;
            } else if (ch === '}' && templateDepth > 0) {
                templateDepth--;
            }
            continue;
        }

        if (ch === '\'' || ch === '"') {
            inString = ch;
            current += ch;
            continue;
        }

        if (ch === '`') {
            inTemplate = true;
            current += ch;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            current += ch;
            continue;
        }

        if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            current += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

/**
 * Find the member reference at a specific offset within an expression's value span.
 * offsetInValue is relative to the start of the attribute value.
 */
export function findMemberAtOffset(expression: ExpressionInfo, offsetInValue: number): MemberReference | undefined {
    for (const ref of expression.memberReferences) {
        if (offsetInValue >= ref.start && offsetInValue < ref.end) {
            return ref;
        }
    }
    return undefined;
}

/**
 * Get the word/identifier at a given offset within the expression.
 * Used for determining what member name the cursor is on.
 */
export function getIdentifierAtOffset(expression: string, offset: number): { word: string; start: number; end: number } | undefined {
    if (offset < 0 || offset >= expression.length) return undefined;

    // Walk backward to find the start of the identifier
    let start = offset;
    while (start > 0 && isIdentChar(expression[start - 1])) {
        start--;
    }

    // Walk forward to find the end
    let end = offset;
    while (end < expression.length && isIdentChar(expression[end])) {
        end++;
    }

    if (start === end) return undefined;

    return {
        word: expression.substring(start, end),
        start,
        end,
    };
}

function isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_$]/.test(ch);
}


