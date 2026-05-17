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
 * Extract all `this.X` member access references from an expression.
 */
function extractMemberReferences(expression: string): MemberReference[] {
    const refs: MemberReference[] = [];
    // Build a set of ranges covered by block comments to skip
    const commentRanges: { start: number; end: number }[] = [];
    let ci = 0;
    while (ci < expression.length - 1) {
        if (expression[ci] === '/' && expression[ci + 1] === '*') {
            const closeIdx = expression.indexOf('*/', ci + 2);
            const end = closeIdx >= 0 ? closeIdx + 2 : expression.length;
            commentRanges.push({ start: ci, end });
            ci = end;
        } else {
            ci++;
        }
    }

    // Match `this.` followed by identifier chains (supports both `.` and `?.` separators)
    const regex = /\bthis\.([$\w]+(?:\?\.[$\w]+|(?<!\?)(?:\.[$\w]+))*)\s*(\()?/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(expression)) !== null) {
        // Skip matches inside block comments
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;
        const inComment = commentRanges.some(r => matchStart >= r.start && matchEnd <= r.end);
        if (inComment) continue;

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
        const prev = i > 0 ? expression[i - 1] : '';

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


