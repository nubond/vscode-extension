/**
 * grammar.spec.ts
 * Comprehensive unit tests for TextMate grammar regex patterns in
 * html.json (main template grammar) and interpolation.json ({{ }} grammar).
 */

import grammar from '../../syntaxes/html.json';
import interpolationGrammar from '../../syntaxes/interpolation.json';
import { Constants } from '../../src/constants';

type GrammarRule = {
    comment?: string;
    match?: string;
    begin?: string;
    end?: string;
    name?: string;
    contentName?: string;
    captures?: Record<string, { name: string }>;
    beginCaptures?: Record<string, { name: string }>;
    endCaptures?: Record<string, { name: string }>;
    patterns?: GrammarRule[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const repo = grammar.repository as Record<string, any>;

function getExpressionRules(): GrammarRule[] {
    return repo['expression-content'].patterns as GrammarRule[];
}

function findRule(commentSubstring: string): GrammarRule {
    const rule = getExpressionRules().find(
        r => r.comment?.toLowerCase().includes(commentSubstring.toLowerCase())
    );
    if (!rule) throw new Error(`No rule found matching "${commentSubstring}"`);
    return rule;
}

function execRule(rule: GrammarRule, input: string): RegExpExecArray | null {
    if (!rule.match) throw new Error('Rule has no match pattern');
    return new RegExp(rule.match).exec(input);
}

function execBegin(rule: GrammarRule, input: string): RegExpExecArray | null {
    if (!rule.begin) throw new Error('Rule has no begin pattern');
    return new RegExp(rule.begin).exec(input);
}

function execEnd(rule: GrammarRule, input: string): RegExpExecArray | null {
    if (!rule.end) throw new Error('Rule has no end pattern');
    return new RegExp(rule.end).exec(input);
}

// =========================================================================
// 1. Top-level structure
// =========================================================================

describe('Grammar: html.json', () => {
    describe('Top-level structure', () => {
        it('should have correct scopeName', () => {
            expect(grammar.scopeName).toBe(`${Constants.INTERNAL_NAME}.template`);
        });

        it('should have correct injectionSelector', () => {
            expect(grammar.injectionSelector).toBe(`L:meta.tag -comment -meta.attribute-value.${Constants.INTERNAL_NAME}`);
        });

        it('should include both attribute patterns', () => {
            const includes = grammar.patterns.map((p: any) => p.include);
            expect(includes).toContain('#nb-attribute-with-value');
            expect(includes).toContain('#nb-attribute-no-value');
        });

        it('should have expression-content repository entry', () => {
            expect(repo['expression-content']).toBeDefined();
            expect(repo['expression-content'].patterns.length).toBeGreaterThan(0);
        });
    });

    // =====================================================================
    // 2. nb-attribute-with-value
    // =====================================================================

    describe('nb-attribute-with-value', () => {
        const rule = repo['nb-attribute-with-value'] as GrammarRule;

        it('should have begin/end patterns', () => {
            expect(rule.begin).toBeDefined();
            expect(rule.end).toBeDefined();
        });

        it(`should have contentName meta.attribute-value.${Constants.INTERNAL_NAME}`, () => {
            expect(rule.contentName).toBe(`meta.attribute-value.${Constants.INTERNAL_NAME}`);
        });

        it('should match simple nb-value="..."', () => {
            const m = execBegin(rule, ' nb-value="this.name"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-value');
            expect(m![2]).toBe('=');
            expect(m![3]).toBe('"');
        });

        it('should match nb-event:click="..."', () => {
            const m = execBegin(rule, ' nb-event:click="this.onClick()"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-event:click');
        });

        it('should match nb-repeat with index suffix', () => {
            const m = execBegin(rule, ' nb-repeat:outer:2="this.items"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-repeat:outer:2');
        });

        it('should match data-nb-value="..."', () => {
            const m = execBegin(rule, ' data-nb-value="this.name"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('data-nb-value');
        });

        it('should match with spaces around =', () => {
            const m = execBegin(rule, ' nb-value = "this.name"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-value');
        });

        it('should capture correct scope names', () => {
            expect(rule.beginCaptures!['1'].name).toBe(`support.class.${Constants.INTERNAL_NAME}`);
            expect(rule.beginCaptures!['2'].name).toBe('punctuation.separator.key-value.html');
            expect(rule.beginCaptures!['3'].name).toBe('punctuation.definition.string.begin.html');
        });

        it('should end at closing quote', () => {
            const m = execEnd(rule, '"');
            expect(m).not.toBeNull();
            expect(rule.endCaptures!['0'].name).toBe('punctuation.definition.string.end.html');
        });

        it('should include expression-content patterns', () => {
            const includes = rule.patterns!.map((p: any) => p.include);
            expect(includes).toContain('#expression-content');
        });

        it('should NOT match non-nb attributes', () => {
            expect(execBegin(rule, ' class="foo"')).toBeNull();
            expect(execBegin(rule, ' id="bar"')).toBeNull();
            expect(execBegin(rule, ' value="baz"')).toBeNull();
        });

        it('should NOT match when preceded by non-whitespace', () => {
            expect(execBegin(rule, 'xnb-value="x"')).toBeNull();
        });

        it('should match at start of line (no leading whitespace)', () => {
            const m = execBegin(rule, 'nb-value="x"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-value');
        });
    });

    // =====================================================================
    // 3. nb-attribute-no-value
    // =====================================================================

    describe('nb-attribute-no-value', () => {
        const rule = repo['nb-attribute-no-value'] as GrammarRule;

        it('should match nb-default before space', () => {
            const m = execRule(rule, ' nb-default >');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-default');
        });

        it('should match nb-default before >', () => {
            const m = execRule(rule, ' nb-default>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-default');
        });

        it('should match nb-default before />', () => {
            const m = execRule(rule, ' nb-default/>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-default');
        });

        it('should match data-nb-default', () => {
            const m = execRule(rule, ' data-nb-default >');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('data-nb-default');
        });

        it('should match nb-attribute with suffix', () => {
            const m = execRule(rule, ' nb-class:highlight >');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-class:highlight');
        });

        it('should match at start of line (no leading whitespace)', () => {
            const m = execRule(rule, 'nb-default >');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-default');
        });

        it('should have correct scope', () => {
            expect(rule.captures!['1'].name).toBe(`support.class.${Constants.INTERNAL_NAME}`);
        });
    });

    // =====================================================================
    // 4. Expression-content: Prefix rules
    // =====================================================================

    describe('Slot/route prefix (%name)', () => {
        const rule = findRule('slot/route prefix');

        it('should match %slotName', () => {
            const m = execRule(rule, '%header');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('%');
            expect(m![2]).toBe('header');
        });

        it('should match %route123', () => {
            const m = execRule(rule, '%route123');
            expect(m).not.toBeNull();
            expect(m![2]).toBe('route123');
        });

        it('should have correct scopes', () => {
            expect(rule.captures!['1'].name).toBe(`support.class.${Constants.INTERNAL_NAME}`);
            expect(rule.captures!['2'].name).toBe(`string.unquoted.${Constants.INTERNAL_NAME}`);
        });
    });

    describe('Single-bind prefix (#)', () => {
        const rule = findRule('single-bind prefix');

        it('should match #', () => {
            const m = execRule(rule, '#this.name');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('#');
        });

        it(`should have support.class.${Constants.INTERNAL_NAME} scope`, () => {
            expect(rule.name).toBe(`support.class.${Constants.INTERNAL_NAME}`);
        });
    });

    // =====================================================================
    // 5. Expression-content: @-literal rules
    // =====================================================================

    describe('@number literal', () => {
        const rule = findRule('@number literal');

        it('should match @123', () => {
            const m = execRule(rule, '@123');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@123');
        });

        it('should match @3.14', () => {
            const m = execRule(rule, '@3.14');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@3.14');
        });

        it('should match @0', () => {
            const m = execRule(rule, '@0');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@0');
        });

        it('should have constant.numeric.decimal.ts scope', () => {
            expect(rule.captures!['0'].name).toBe('constant.numeric.decimal.ts');
        });
    });

    describe('@boolean literal', () => {
        const rule = findRule('@boolean literal');

        it('should match @true', () => {
            const m = execRule(rule, '@true');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@true');
        });

        it('should match @false', () => {
            const m = execRule(rule, '@false');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@false');
        });

        it('should not match @trueish (word boundary)', () => {
            const m = execRule(rule, '@trueish');
            expect(m).toBeNull();
        });

        it('should have constant.language.boolean.ts scope', () => {
            expect(rule.captures!['0'].name).toBe('constant.language.boolean.ts');
        });
    });

    describe('@string literal', () => {
        const rule = findRule('@string literal');

        it('should match @MyComponent', () => {
            const m = execRule(rule, '@MyComponent');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@MyComponent');
        });

        it('should match @some-value', () => {
            const m = execRule(rule, '@some-value');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@some-value');
        });

        it('should stop before closing double-quote', () => {
            // The regex is @([^"]+), so it stops at "
            const regex = new RegExp(rule.match!);
            const m = regex.exec('@hello"');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@hello');
        });

        it(`should have string.unquoted.${Constants.INTERNAL_NAME} scope`, () => {
            expect(rule.captures!['0'].name).toBe(`string.unquoted.${Constants.INTERNAL_NAME}`);
        });
    });

    // =====================================================================
    // 6. Block comment
    // =====================================================================

    describe('Block comment', () => {
        const rule = findRule('Block comment');

        it('should have begin pattern matching /*', () => {
            const m = execBegin(rule, '/* comment */');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('/*');
        });

        it('should have end pattern matching */', () => {
            const m = execEnd(rule, 'stuff */');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('*/');
        });

        it('should not match single /', () => {
            const m = execBegin(rule, '/ not a comment');
            expect(m).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('comment.block.ts');
        });

        it('should have correct begin/end capture scopes', () => {
            expect(rule.beginCaptures!['0'].name).toBe('punctuation.definition.comment.begin.ts');
            expect(rule.endCaptures!['0'].name).toBe('punctuation.definition.comment.end.ts');
        });
    });

    // =====================================================================
    // 7. Template literal
    // =====================================================================

    describe('Template literal', () => {
        const rule = findRule('Template literal with');

        it('should have begin pattern matching backtick after allowed chars', () => {
            // After =
            expect(execBegin(rule, '=`hello`')).not.toBeNull();
            // After (
            expect(execBegin(rule, '(`hello`')).not.toBeNull();
            // After ,
            expect(execBegin(rule, ',`hello`')).not.toBeNull();
            // After space
            expect(execBegin(rule, ' `hello`')).not.toBeNull();
            // After "
            expect(execBegin(rule, '"`value`')).not.toBeNull();
        });

        it('should match backtick after [ (array element)', () => {
            const m = execBegin(rule, '[`hello`');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('`');
        });

        it('should match backtick after > (arrow body)', () => {
            const m = execBegin(rule, '>`template`');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('`');
        });

        it('should match backtick after ? (ternary true branch)', () => {
            const m = execBegin(rule, '?`yes`');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('`');
        });

        it('should have end pattern matching closing backtick', () => {
            const m = execEnd(rule, '`');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('`');
        });

        it('should have string.template.ts scope', () => {
            expect(rule.name).toBe('string.template.ts');
        });

        it('should have correct begin/end capture scopes', () => {
            expect(rule.beginCaptures!['0'].name).toBe('punctuation.definition.string.template.begin.ts');
            expect(rule.endCaptures!['0'].name).toBe('punctuation.definition.string.template.end.ts');
        });

        describe('interpolation sub-pattern', () => {
            const interpRule = rule.patterns![0] as GrammarRule;

            it('should have begin pattern matching ${', () => {
                const m = execBegin(interpRule, '${expr}');
                expect(m).not.toBeNull();
                expect(m![0]).toBe('${');
            });

            it('should have end pattern matching }', () => {
                const m = execEnd(interpRule, '}');
                expect(m).not.toBeNull();
                expect(m![0]).toBe('}');
            });

            it('should have correct scopes', () => {
                expect(interpRule.beginCaptures!['0'].name).toBe('punctuation.definition.template-expression.begin.ts');
                expect(interpRule.endCaptures!['0'].name).toBe('punctuation.definition.template-expression.end.ts');
                expect(interpRule.contentName).toBe('meta.template.expression.ts');
            });

            it('should recursively include expression-content', () => {
                const includes = interpRule.patterns!.map((p: any) => p.include);
                expect(includes).toContain('#expression-content');
            });
        });

        describe('HTML tags sub-pattern inside template literal', () => {
            const htmlTagRule = rule.patterns![1] as GrammarRule;

            it('should exist as second sub-pattern', () => {
                expect(htmlTagRule).toBeDefined();
                expect(htmlTagRule.comment).toMatch(/HTML tags/i);
            });

            it('should match <strong>', () => {
                const m = execRule(htmlTagRule, '<strong>');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('<');
                expect(m![2]).toBe('strong');
                expect(m![3]).toBe('>');
            });

            it('should match </strong>', () => {
                const m = execRule(htmlTagRule, '</strong>');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('</');
                expect(m![2]).toBe('strong');
                expect(m![3]).toBe('>');
            });

            it('should match <br/>', () => {
                const m = execRule(htmlTagRule, '<br/>');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('<');
                expect(m![2]).toBe('br');
                expect(m![3]).toBe('/>');
            });

            it('should match <br />', () => {
                const m = execRule(htmlTagRule, '<br />');
                expect(m).not.toBeNull();
                expect(m![3]).toBe(' />');
            });

            it('should match <em>', () => {
                const m = execRule(htmlTagRule, '<em>');
                expect(m).not.toBeNull();
                expect(m![2]).toBe('em');
            });

            it('should match <my-component>', () => {
                const m = execRule(htmlTagRule, '<my-component>');
                expect(m).not.toBeNull();
                expect(m![2]).toBe('my-component');
            });

            it('should NOT match bare < followed by space (comparison)', () => {
                const regex = new RegExp(htmlTagRule.match!);
                const m = regex.exec('< 18');
                expect(m).toBeNull();
            });

            it('should NOT match < followed by digit', () => {
                const regex = new RegExp(htmlTagRule.match!);
                const m = regex.exec('<3');
                expect(m).toBeNull();
            });

            it(`should have punctuation.definition.tag.html.${Constants.INTERNAL_NAME} scopes`, () => {
                expect(htmlTagRule.captures!['1'].name).toBe(`punctuation.definition.tag.html.${Constants.INTERNAL_NAME}`);
                expect(htmlTagRule.captures!['2'].name).toBe(`entity.name.tag.html.${Constants.INTERNAL_NAME}`);
                expect(htmlTagRule.captures!['3'].name).toBe(`punctuation.definition.tag.html.${Constants.INTERNAL_NAME}`);
            });
        });
    });

    // =====================================================================
    // 8. this keyword
    // =====================================================================

    describe('this keyword', () => {
        const rule = findRule('this keyword');

        it('should match "this"', () => {
            expect(execRule(rule, 'this.name')).not.toBeNull();
        });

        it('should match standalone "this"', () => {
            const m = execRule(rule, 'this');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('this');
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('variable.language.this.ts');
        });

        it('should not match "othis"', () => {
            expect(new RegExp(rule.match!).exec('othis')).toBeNull();
        });

        it('should not match "thistle"', () => {
            expect(new RegExp(rule.match!).exec('thistle')).toBeNull();
        });
    });

    // =====================================================================
    // 9. Boolean literals
    // =====================================================================

    describe('Boolean literals', () => {
        const rule = findRule('Boolean literals');

        it('should match "true"', () => {
            const m = execRule(rule, 'true');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('true');
        });

        it('should match "false"', () => {
            const m = execRule(rule, 'false');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('false');
        });

        it('should not match "trueish"', () => {
            expect(new RegExp(rule.match!).exec('trueish')).toBeNull();
        });

        it('should not match "falsehood"', () => {
            expect(new RegExp(rule.match!).exec('falsehood')).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('constant.language.boolean.ts');
        });
    });

    // =====================================================================
    // 10. null / undefined / NaN / Infinity
    // =====================================================================

    describe('null / undefined / NaN / Infinity', () => {
        const rule = findRule('null / undefined');

        it.each(['null', 'undefined', 'NaN', 'Infinity'])(
            'should match "%s"',
            (kw) => {
                const m = execRule(rule, kw);
                expect(m).not.toBeNull();
                expect(m![0]).toBe(kw);
            }
        );

        it('should not match partial "nullify"', () => {
            expect(new RegExp(rule.match!).exec('nullify')).toBeNull();
        });

        it('should not match partial "undefinedVar"', () => {
            expect(new RegExp(rule.match!).exec('undefinedVar')).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('constant.language.ts');
        });
    });

    // =====================================================================
    // 11. Numeric literals
    // =====================================================================

    describe('Numeric literals', () => {
        const rule = findRule('Numeric literals');

        it('should match integer 42', () => {
            const m = execRule(rule, '42');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('42');
        });

        it('should match decimal 3.14', () => {
            const m = execRule(rule, '3.14');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('3.14');
        });

        it('should match 0', () => {
            const m = execRule(rule, '0');
            expect(m).not.toBeNull();
        });

        it('should match number in expression', () => {
            const m = execRule(rule, 'a + 100');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('100');
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('constant.numeric.decimal.ts');
        });
    });

    // =====================================================================
    // 12. Single-quoted strings
    // =====================================================================

    describe('Single-quoted strings', () => {
        const rule = findRule('Single-quoted strings');

        it('should match \'hello\'', () => {
            const m = execRule(rule, "'hello'");
            expect(m).not.toBeNull();
            expect(m![0]).toBe("'hello'");
        });

        it('should match empty string \'\'', () => {
            const m = execRule(rule, "''");
            expect(m).not.toBeNull();
            expect(m![0]).toBe("''");
        });

        it('should match string with spaces', () => {
            const m = execRule(rule, "'foo bar'");
            expect(m).not.toBeNull();
            expect(m![0]).toBe("'foo bar'");
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('string.quoted.single.ts');
        });
    });

    // =====================================================================
    // 13. JS keyword operators
    // =====================================================================

    describe('JS keyword operators', () => {
        const rule = findRule('JS keyword operators');

        it.each(['new', 'typeof', 'instanceof', 'void', 'delete', 'await'])(
            'should match "%s"',
            (kw) => {
                const m = execRule(rule, kw);
                expect(m).not.toBeNull();
                expect(m![1]).toBe(kw);
            }
        );

        it('should not match "renewal" (partial "new")', () => {
            expect(new RegExp(rule.match!).exec('renewal')).toBeNull();
        });

        it('should not match "typeofx"', () => {
            expect(new RegExp(rule.match!).exec('typeofx')).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.name).toBe('keyword.operator.expression.ts');
        });
    });

    // =====================================================================
    // 14. Arrow function rules
    // =====================================================================

    describe('Arrow function rules', () => {
        describe('single parameter arrow', () => {
            const rule = findRule('Arrow function: single parameter');

            it('should have correct scopes', () => {
                expect(rule.captures!['1'].name).toBe('variable.parameter.ts');
                expect(rule.captures!['2'].name).toBe('storage.type.function.arrow.ts');
            });

            it('should match "el =>"', () => {
                const m = execRule(rule, 'el => el.value');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('el');
                expect(m![2]).toBe('=>');
            });

            it('should match "x =>"', () => {
                const m = execRule(rule, 'x => x + 1');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('x');
                expect(m![2]).toBe('=>');
            });

            it('should match "item =>"', () => {
                const m = execRule(rule, 'item => item.name');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('item');
            });

            it('should match parameter starting with underscore', () => {
                const m = execRule(rule, '_val => _val');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('_val');
            });

            it('should match parameter starting with $', () => {
                const m = execRule(rule, '$el => $el.id');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('$el');
            });

            it('should match with extra spaces before arrow', () => {
                const m = execRule(rule, 'el  =>  expr');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('el');
                expect(m![2]).toBe('=>');
            });

            it('should not match after dot (property access)', () => {
                const m = execRule(rule, '.map => ');
                if (m) {
                    expect(m.index).toBeGreaterThan(0);
                }
            });

            it('should match full identifier, not partial', () => {
                const m = execRule(rule, 'foobar => x');
                expect(m).not.toBeNull();
                expect(m![1]).toBe('foobar');
            });
        });

        describe('standalone arrow operator', () => {
            const rule = findRule('Arrow operator after parenthesized');

            it('should have correct scope', () => {
                expect(rule.name).toBe('storage.type.function.arrow.ts');
            });

            it('should match => in "(a, b) => expr"', () => {
                const m = execRule(rule, '(a, b) => a + b');
                expect(m).not.toBeNull();
                expect(m![0]).toBe('=>');
            });

            it('should match => after closing paren', () => {
                const m = execRule(rule, ') => {');
                expect(m).not.toBeNull();
                expect(m![0]).toBe('=>');
            });
        });

        describe('rule ordering', () => {
            const rules = getExpressionRules();
            const arrowIdx = rules.findIndex(r => r.comment?.includes('Arrow function: single parameter'));
            const standaloneIdx = rules.findIndex(r => r.comment?.includes('Arrow operator after parenthesized'));
            const multiCharIdx = rules.findIndex(r => r.comment?.includes('Multi-char operators'));

            it('single-param arrow should be before standalone arrow', () => {
                expect(arrowIdx).toBeLessThan(standaloneIdx);
            });

            it('single-param arrow should be before multi-char operators', () => {
                expect(arrowIdx).toBeLessThan(multiCharIdx);
            });

            it('standalone arrow should be before multi-char operators', () => {
                expect(standaloneIdx).toBeLessThan(multiCharIdx);
            });
        });
    });

    // =====================================================================
    // 15a. HTML tags in expression values
    // =====================================================================

    describe('HTML tags in expression values', () => {
        const rule = findRule('HTML tags inside expression values');

        it('should match <strong>', () => {
            const m = execRule(rule, '<strong>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('<');
            expect(m![2]).toBe('strong');
            expect(m![3]).toBe('>');
        });

        it('should match </strong>', () => {
            const m = execRule(rule, '</strong>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('</');
            expect(m![2]).toBe('strong');
            expect(m![3]).toBe('>');
        });

        it('should match <br/>', () => {
            const m = execRule(rule, '<br/>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('<');
            expect(m![2]).toBe('br');
            expect(m![3]).toBe('/>');
        });

        it('should match <br />', () => {
            const m = execRule(rule, '<br />');
            expect(m).not.toBeNull();
            expect(m![3]).toBe(' />');
        });

        it('should match <em>', () => {
            const m = execRule(rule, '<em>');
            expect(m).not.toBeNull();
            expect(m![2]).toBe('em');
        });

        it('should match </em>', () => {
            const m = execRule(rule, '</em>');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('</');
            expect(m![2]).toBe('em');
        });

        it('should match <div>', () => {
            const m = execRule(rule, '<div>');
            expect(m).not.toBeNull();
            expect(m![2]).toBe('div');
        });

        it('should match custom element <my-component>', () => {
            const m = execRule(rule, '<my-component>');
            expect(m).not.toBeNull();
            expect(m![2]).toBe('my-component');
        });

        it('should NOT match < followed by space (comparison operator)', () => {
            const regex = new RegExp(rule.match!);
            expect(regex.exec('a < b')).toBeNull();
        });

        it('should NOT match < followed by digit', () => {
            const regex = new RegExp(rule.match!);
            expect(regex.exec('x < 3')).toBeNull();
        });

        it('should have correct capture scopes', () => {
            expect(rule.captures!['1'].name).toBe(`punctuation.definition.tag.html.${Constants.INTERNAL_NAME}`);
            expect(rule.captures!['2'].name).toBe(`entity.name.tag.html.${Constants.INTERNAL_NAME}`);
            expect(rule.captures!['3'].name).toBe(`punctuation.definition.tag.html.${Constants.INTERNAL_NAME}`);
        });

        it('should match <strong> inside nb-html replace pattern', () => {
            const regex = new RegExp(rule.match!, 'g');
            const expr = 'item.replace(new RegExp(nativeElement.value, \'gi\'), match => `<strong>${match}</strong>`)';
            const matches = [...expr.matchAll(regex)].map(m => m[0]);
            expect(matches).toContain('<strong>');
            expect(matches).toContain('</strong>');
        });
    });

    // =====================================================================
    // 16. Multi-char operators
    // =====================================================================

    describe('Multi-char operators', () => {
        const rule = findRule('Multi-char operators');

        it('should have keyword.operator.ts scope', () => {
            expect(rule.name).toBe('keyword.operator.ts');
        });

        it.each(['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '...'])(
            'should match "%s"',
            (op) => {
                const m = execRule(rule, `a ${op} b`);
                expect(m).not.toBeNull();
                expect(m![0]).toBe(op);
            }
        );

        it('should NOT match => (handled by arrow rules)', () => {
            const m = execRule(rule, 'x => y');
            if (m) {
                expect(m[0]).not.toBe('=>');
            }
        });

        it('should NOT match a single space (regression)', () => {
            const regex = new RegExp('^' + rule.match! + '$');
            expect(regex.test(' ')).toBe(false);
        });

        it('should prefer === over ==', () => {
            const m = execRule(rule, 'a === b');
            expect(m![0]).toBe('===');
        });

        it('should prefer !== over !=', () => {
            const m = execRule(rule, 'a !== b');
            expect(m![0]).toBe('!==');
        });

        it('should prefer ?? over ?. when text is "??"', () => {
            const m = execRule(rule, 'a ?? b');
            expect(m![0]).toBe('??');
        });

        it('should match ?. for optional chaining', () => {
            const m = execRule(rule, 'this.items?.map(');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('?.');
        });

        it('should match ?. before property access', () => {
            const m = execRule(rule, 'obj?.name');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('?.');
        });
    });

    // =====================================================================
    // 16. Single-char operators
    // =====================================================================

    describe('Single-char operators', () => {
        const rule = findRule('Single-char operators');

        it('should have keyword.operator.ts scope', () => {
            expect(rule.name).toBe('keyword.operator.ts');
        });

        it.each([
            '=', '+', '-', '*', '/', '%', '<', '>',
            '!', '&', '|', '^', '~', '?', ':', ',', ';'
        ])('should match "%s"', (op) => {
            const m = execRule(rule, op);
            expect(m).not.toBeNull();
            expect(m![0]).toBe(op);
        });

        it('should not match letters', () => {
            expect(execRule(rule, 'a')).toBeNull();
            expect(execRule(rule, 'Z')).toBeNull();
        });

        it('should not match digits', () => {
            expect(execRule(rule, '0')).toBeNull();
            expect(execRule(rule, '9')).toBeNull();
        });
    });

    // =====================================================================
    // 17. Bracket rules
    // =====================================================================

    describe('Bracket rules', () => {
        describe('Round brackets', () => {
            const rule = findRule('Round brackets');

            it('should have meta.brace.round.ts scope', () => {
                expect(rule.name).toBe('meta.brace.round.ts');
            });

            it('should match ( and )', () => {
                expect(execRule(rule, '(')![0]).toBe('(');
                expect(execRule(rule, ')')![0]).toBe(')');
            });

            it('should not match other brackets', () => {
                expect(execRule(rule, '[')).toBeNull();
                expect(execRule(rule, '{')).toBeNull();
            });
        });

        describe('Square brackets', () => {
            const rule = findRule('Square brackets');

            it('should have meta.brace.square.ts scope', () => {
                expect(rule.name).toBe('meta.brace.square.ts');
            });

            it('should match [ and ]', () => {
                expect(execRule(rule, '[')![0]).toBe('[');
                expect(execRule(rule, ']')![0]).toBe(']');
            });

            it('should not match other brackets', () => {
                expect(execRule(rule, '(')).toBeNull();
                expect(execRule(rule, '{')).toBeNull();
            });
        });

        describe('Curly braces', () => {
            const rule = findRule('Curly braces');

            it('should have punctuation.definition.block.ts scope', () => {
                expect(rule.name).toBe('punctuation.definition.block.ts');
            });

            it('should match { and }', () => {
                expect(execRule(rule, '{')![0]).toBe('{');
                expect(execRule(rule, '}')![0]).toBe('}');
            });

            it('should not match other brackets', () => {
                expect(execRule(rule, '(')).toBeNull();
                expect(execRule(rule, '[')).toBeNull();
            });
        });
    });

    // =====================================================================
    // 18. Object/style key
    // =====================================================================

    describe('Object/style key before colon', () => {
        const rule = findRule('Object/style key');

        it('should match "color: " in object literal', () => {
            const m = execRule(rule, 'color: red');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('color');
        });

        it('should match "font-size: " (hyphenated)', () => {
            const m = execRule(rule, 'font-size: 12px');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('font-size');
        });

        it('should match "$key: val"', () => {
            const m = execRule(rule, '$key: val');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('$key');
        });

        it('should not match after dot (.prop:)', () => {
            const m = execRule(rule, '.active: true');
            expect(m).toBeNull();
        });

        it('should not match double colon (::)', () => {
            // Lookahead (?=:\s+[^:]) requires space after colon and non-colon char
            const m = execRule(rule, 'foo::bar');
            expect(m).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.captures!['1'].name).toBe('variable.other.object.property.ts');
        });
    });

    // =====================================================================
    // 19. Global objects
    // =====================================================================

    describe('Global runtime objects', () => {
        const rule = findRule('Global runtime objects');

        it('should have variable.other.object.ts scope', () => {
            expect(rule.name).toBe('variable.other.object.ts');
        });

        it.each(['console', 'document', 'window'])(
            'should match "%s"',
            (name) => {
                const m = execRule(rule, name);
                expect(m).not.toBeNull();
                expect(m![1]).toBe(name);
            }
        );

        it('should not match after dot', () => {
            expect(execRule(rule, '.console')).toBeNull();
        });
    });

    describe('Built-in constructors / namespaces', () => {
        const rule = findRule('Built-in constructors');

        it('should have support.class.ts scope', () => {
            expect(rule.name).toBe('support.class.ts');
        });

        it.each(['Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'Date', 'Promise', 'Map', 'Set', 'RegExp', 'Error', 'Symbol'])(
            'should match "%s"',
            (name) => {
                const m = execRule(rule, name);
                expect(m).not.toBeNull();
                expect(m![1]).toBe(name);
            }
        );

        it('should not match after dot', () => {
            expect(execRule(rule, '.Math')).toBeNull();
            expect(execRule(rule, '.JSON')).toBeNull();
        });
    });

    // =====================================================================
    // 20. Injected parameters
    // =====================================================================

    describe('Injected parameters (fixed)', () => {
        const rule = findRule('Injected parameters');

        it('should have variable.parameter.ts scope', () => {
            expect(rule.name).toBe('variable.parameter.ts');
        });

        it.each(['item', 'index', 'count', 'element', 'nativeElement', 'event', 'data', 'unSubscribe', 'router'])(
            'should match "%s"',
            (param) => {
                const m = execRule(rule, `${param}.something`);
                expect(m).not.toBeNull();
                expect(m![1]).toBe(param);
            }
        );

        it('should not match after dot', () => {
            expect(new RegExp(rule.match!).exec('this.item')).toBeNull();
            expect(new RegExp(rule.match!).exec('this.event')).toBeNull();
        });

        it('should match at start of string', () => {
            const m = execRule(rule, 'event.target');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('event');
        });
    });

    // =====================================================================
    // 21. Prefixed repeat params
    // =====================================================================

    describe('Prefixed repeat params', () => {
        const rule = findRule('prefixed repeat params');

        it('should have variable.parameter.ts scope', () => {
            expect(rule.name).toBe('variable.parameter.ts');
        });

        it('should match "outerItem"', () => {
            const m = execRule(rule, 'outerItem');
            expect(m).not.toBeNull();
            expect(m![0]).toContain('outerItem');
        });

        it('should match "innerIndex"', () => {
            const m = execRule(rule, 'innerIndex');
            expect(m).not.toBeNull();
        });

        it('should match "myCount"', () => {
            const m = execRule(rule, 'myCount');
            expect(m).not.toBeNull();
        });

        it('should match "categoryItem"', () => {
            const m = execRule(rule, 'categoryItem');
            expect(m).not.toBeNull();
        });

        it('should not match "Item" (must start lowercase)', () => {
            expect(execRule(rule, 'Item')).toBeNull();
        });

        it('should not match plain "item" (not prefixed)', () => {
            // "item" ends with "Item"? No, "item" is lowercase "i"
            // The regex requires [a-z][a-zA-Z]*(?:Item|Index|Count)
            // "item" doesn't end with "Item" (capital I) — it's just "item"
            expect(execRule(rule, 'item')).toBeNull();
        });

        it('should not match after dot', () => {
            expect(new RegExp(rule.match!).exec('this.outerItem')).toBeNull();
        });
    });

    // =====================================================================
    // 22. Standalone function calls
    // =====================================================================

    describe('Standalone function calls', () => {
        const rule = findRule('Standalone function calls');

        it('should have entity.name.function.ts scope', () => {
            expect(rule.name).toBe('entity.name.function.ts');
        });

        it('should match "localize(" in "localize(this.name)"', () => {
            const m = execRule(rule, 'localize(');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('localize');
        });

        it('should match "dateFormat("', () => {
            const m = execRule(rule, 'dateFormat(');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('dateFormat');
        });

        it('should not match method calls after dot', () => {
            expect(new RegExp(rule.match!).exec('.map(')).toBeNull();
        });
    });

    // =====================================================================
    // 23. Method calls after dot
    // =====================================================================

    describe('Method calls after dot', () => {
        const rule = findRule('Method calls after dot');

        it('should have entity.name.function.member.ts scope', () => {
            expect(rule.name).toBe('entity.name.function.member.ts');
        });

        it('should match ".map(" in "this.items.map("', () => {
            const m = execRule(rule, '.map(');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('map');
        });

        it('should match ".filter(" with space before paren', () => {
            const m = execRule(rule, '.filter (');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('filter');
        });

        it('should match ".toString()"', () => {
            const m = execRule(rule, '.toString()');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('toString');
        });

        it('should match ".$method()"', () => {
            const m = execRule(rule, '.$method()');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('$method');
        });

        it('should not match without preceding dot', () => {
            const m = execRule(rule, 'map(');
            expect(m).toBeNull();
        });

        it('should not match property access (no parens)', () => {
            const m = execRule(rule, '.name');
            expect(m).toBeNull();
        });
    });

    // =====================================================================
    // 23. Property access after dot
    // =====================================================================

    describe('Property access after dot', () => {
        const rule = findRule('Property access after dot');

        it('should have variable.other.property.ts scope', () => {
            expect(rule.name).toBe('variable.other.property.ts');
        });

        it('should match ".name"', () => {
            const m = execRule(rule, '.name');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('name');
        });

        it('should match ".length"', () => {
            const m = execRule(rule, '.length');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('length');
        });

        it('should match ".$private"', () => {
            const m = execRule(rule, '.$private');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('$private');
        });

        it('should match "._underscore"', () => {
            const m = execRule(rule, '._underscore');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('_underscore');
        });

        it('should not match without preceding dot', () => {
            const m = execRule(rule, 'name');
            expect(m).toBeNull();
        });
    });

    // =====================================================================
    // 24. Rule ordering (critical for TextMate precedence)
    // =====================================================================

    describe('Rule ordering', () => {
        const rules = getExpressionRules();

        function ruleIndex(commentSubstring: string): number {
            return rules.findIndex(r => r.comment?.toLowerCase().includes(commentSubstring.toLowerCase()));
        }

        it('@number should appear before @string (more specific first)', () => {
            expect(ruleIndex('@number')).toBeLessThan(ruleIndex('@string'));
        });

        it('@boolean should appear before @string (more specific first)', () => {
            expect(ruleIndex('@boolean')).toBeLessThan(ruleIndex('@string'));
        });

        it('block comment should appear before single-char operators (/ in operators)', () => {
            expect(ruleIndex('block comment')).toBeLessThan(ruleIndex('single-char operators'));
        });

        it('template literal should appear before single-char operators', () => {
            expect(ruleIndex('template literal')).toBeLessThan(ruleIndex('single-char operators'));
        });

        it('keyword operators should appear before single-char operators', () => {
            expect(ruleIndex('js keyword operators')).toBeLessThan(ruleIndex('single-char operators'));
        });

        it('arrow rules should appear before multi-char operators', () => {
            expect(ruleIndex('arrow function: single parameter')).toBeLessThan(ruleIndex('multi-char operators'));
            expect(ruleIndex('arrow operator after parenthesized')).toBeLessThan(ruleIndex('multi-char operators'));
        });

        it('HTML tags should appear before multi-char and single-char operators', () => {
            expect(ruleIndex('HTML tags inside expression values')).toBeLessThan(ruleIndex('multi-char operators'));
            expect(ruleIndex('HTML tags inside expression values')).toBeLessThan(ruleIndex('single-char operators'));
        });

        it('multi-char operators should appear before single-char operators', () => {
            expect(ruleIndex('multi-char operators')).toBeLessThan(ruleIndex('single-char operators'));
        });

        it('method calls should appear before property access (foo() before foo)', () => {
            expect(ruleIndex('method calls after dot')).toBeLessThan(ruleIndex('property access after dot'));
        });

        it('injected params should appear before property access', () => {
            expect(ruleIndex('Injected parameters')).toBeLessThan(ruleIndex('property access after dot'));
        });

        it('boolean literals should appear before injected params (true/false vs item/index)', () => {
            expect(ruleIndex('boolean literals')).toBeLessThan(ruleIndex('Injected parameters'));
        });
    });

    // =====================================================================
    // 25. Full expression coverage (real-world integration)
    // =====================================================================

    describe('Real-world expressions', () => {
        it('should match arrow in "nativeElement.selectedOptions.map(el => el.value)"', () => {
            const rule = findRule('Arrow function: single parameter');
            const m = execRule(rule, 'nativeElement.selectedOptions.map(el => el.value)');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('el');
            expect(m![2]).toBe('=>');
        });

        it('should match arrow in "this.items.filter(x => x.active)"', () => {
            const rule = findRule('Arrow function: single parameter');
            const m = execRule(rule, 'this.items.filter(x => x.active)');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('x');
        });

        it('should not confuse >= with =>', () => {
            const rule = findRule('Arrow function: single parameter');
            expect(execRule(rule, 'this.count >= 5')).toBeNull();
        });

        it('should match method call in "console.log(this.name)"', () => {
            const methodRule = findRule('Method calls after dot');
            const m = execRule(methodRule, '.log(this.name)');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('log');
        });

        it('should match numeric in "this.page + 1"', () => {
            const rule = findRule('Numeric literals');
            const m = execRule(rule, 'this.page + 1');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('1');
        });

        it('should match string in "this.type === \'admin\'"', () => {
            const rule = findRule('Single-quoted strings');
            const m = execRule(rule, "this.type === 'admin'");
            expect(m).not.toBeNull();
            expect(m![0]).toBe("'admin'");
        });

        it('should match ternary operators', () => {
            const rule = findRule('Single-char operators');
            const expr = 'this.active ? this.on : this.off';
            const regex = new RegExp(rule.match!, 'g');
            const matches = [...expr.matchAll(regex)].map(m => m[0]);
            expect(matches).toContain('?');
            expect(matches).toContain(':');
        });

        it('should match object key in "{ visible: this.show }"', () => {
            const rule = findRule('Object/style key');
            const m = execRule(rule, 'visible: this.show');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('visible');
        });

        it('should match slot prefix in "%header"', () => {
            const rule = findRule('slot/route prefix');
            const m = execRule(rule, '%header');
            expect(m).not.toBeNull();
            expect(m![2]).toBe('header');
        });

        it('should match @true literal', () => {
            const rule = findRule('@boolean literal');
            const m = execRule(rule, '@true');
            expect(m).not.toBeNull();
        });

        it('should match @42 literal', () => {
            const rule = findRule('@number literal');
            const m = execRule(rule, '@42');
            expect(m).not.toBeNull();
        });

        it('should match @ComponentName', () => {
            const rule = findRule('@string literal');
            const m = execRule(rule, '@ComponentName');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('@ComponentName');
        });

        it('should match null coalescing: "this.name ?? \'default\'"', () => {
            const rule = findRule('Multi-char operators');
            const m = execRule(rule, "this.name ?? 'default'");
            expect(m).not.toBeNull();
            expect(m![0]).toBe('??');
        });

        it('should match new keyword in "new Date()"', () => {
            const rule = findRule('JS keyword operators');
            const m = execRule(rule, 'new Date()');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('new');
        });

        it('should match prefixed repeat param "outerItem.name"', () => {
            const rule = findRule('prefixed repeat params');
            const m = execRule(rule, 'outerItem.name');
            expect(m).not.toBeNull();
        });

        it('should match ?. optional chaining in "this.items?.map("', () => {
            const rule = findRule('Multi-char operators');
            const m = execRule(rule, 'this.items?.map(');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('?.');
        });

        it('should match method after ?. in "categories?.map("', () => {
            const methodRule = findRule('Method calls after dot');
            const m = execRule(methodRule, '?.map(');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('map');
        });

        it('should match template literal inside array: [el, localize(`...`)]', () => {
            const rule = findRule('Template literal with');
            const m = execBegin(rule, 'localize(`category_text`)');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('`');
        });

        it('should match brackets after template literal: ...`)])', () => {
            const roundRule = findRule('Round brackets');
            const squareRule = findRule('Square brackets');
            expect(execRule(roundRule, ')')![0]).toBe(')');
            expect(execRule(squareRule, ']')![0]).toBe(']');
        });

        it('should match nb-attr:control-size attribute', () => {
            const rule = repo['nb-attribute-with-value'] as GrammarRule;
            const m = execBegin(rule, ' nb-attr:control-size="this.size"');
            expect(m).not.toBeNull();
            expect(m![1]).toBe('nb-attr:control-size');
        });
    });
});

// =========================================================================
// interpolation.json
// =========================================================================

describe('Grammar: interpolation.json', () => {
    describe('Top-level structure', () => {
        it('should have correct scopeName', () => {
            expect(interpolationGrammar.scopeName).toBe(`${Constants.INTERNAL_NAME}.interpolation`);
        });

        it('should have correct injectionSelector', () => {
            expect(interpolationGrammar.injectionSelector).toBe('L:text.html -comment -string -meta.tag');
        });

        it('should include interpolation pattern', () => {
            const includes = interpolationGrammar.patterns.map((p: any) => p.include);
            expect(includes).toContain('#interpolation');
        });
    });

    describe('Interpolation rule', () => {
        const rule = (interpolationGrammar.repository as any).interpolation as GrammarRule;

        it('should have begin pattern matching {{', () => {
            const m = execBegin(rule, '{{ this.name }}');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('{{');
        });

        it('should have end pattern matching }}', () => {
            const m = execEnd(rule, '}}');
            expect(m).not.toBeNull();
            expect(m![0]).toBe('}}');
        });

        it('should NOT match {{ with HTML tags inside (safety lookahead)', () => {
            // The regex uses (?=[^<>]*\}\}) to avoid matching across HTML boundaries
            const m = execBegin(rule, '{{ <div> }}');
            expect(m).toBeNull();
        });

        it('should have correct scope', () => {
            expect(rule.contentName).toBe(`meta.interpolation.${Constants.INTERNAL_NAME}`);
        });

        it('should have correct begin/end capture scopes', () => {
            expect(rule.beginCaptures!['0'].name).toBe(`punctuation.section.interpolation.begin.${Constants.INTERNAL_NAME}`);
            expect(rule.endCaptures!['0'].name).toBe(`punctuation.section.interpolation.end.${Constants.INTERNAL_NAME}`);
        });

        it(`should reference expression-content from ${Constants.INTERNAL_NAME}.template`, () => {
            const includes = rule.patterns!.map((p: any) => p.include);
            expect(includes).toContain(`${Constants.INTERNAL_NAME}.template#expression-content`);
        });
    });
});
