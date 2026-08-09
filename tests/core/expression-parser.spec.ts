import {
    parseExpression,
    findMemberAtOffset,
    getIdentifierAtOffset,
    maskNonCode,
} from '../../src/core/expression-parser';

// ---- Round 3 (L5): regex literals derailed maskNonCode ----
// A '/' after an operator/open-bracket starts a regex literal; quotes or '//'
// INSIDE it must not open string/comment masking (which blanked live code
// after the literal), and identifiers inside it are not member references.
describe('maskNonCode regex literals', () => {
    it('masks the regex pattern but keeps surrounding code live', () => {
        const expr = "this.v.replace(/['\"]/g, '') + this.name";
        const refs = parseExpression(expr).memberReferences.map(r => r.rootMember);
        // Before the fix, the quote inside the character class opened string
        // masking that swallowed `this.name`.
        expect(refs).toEqual(['v', 'name']);
    });

    it('does not treat // inside a regex as a line comment', () => {
        const expr = 'this.url.replace(/https:\\/\\//g, this.scheme)';
        const refs = parseExpression(expr).memberReferences.map(r => r.rootMember);
        expect(refs).toEqual(['url', 'scheme']);
    });

    it('does not extract member references from inside a regex', () => {
        const expr = '/this\\.x/.test(this.y)';
        const refs = parseExpression(expr).memberReferences.map(r => r.rootMember);
        expect(refs).toEqual(['y']);
    });

    it('masks regex flags so they do not read as identifiers', () => {
        const masked = maskNonCode('this.s.match(/item/gi)');
        expect(masked).not.toContain('item');
        expect(masked).not.toContain('gi');
    });

    it('still treats / after a value as division', () => {
        const expr = 'this.a / this.b / 2';
        const refs = parseExpression(expr).memberReferences.map(r => r.rootMember);
        expect(refs).toEqual(['a', 'b']);
    });

    it('preserves offsets (masked string has identical length)', () => {
        const expr = "this.v.replace(/['\"]+/g, '') + this.name";
        expect(maskNonCode(expr).length).toBe(expr.length);
    });

    it('treats an unterminated regex candidate as plain code (no mask to end of input)', () => {
        // '=' before '/' says "regex possible", but there is no closing '/' —
        // masking to end-of-input would hide this.ratio.
        const expr = 'this.mode = / this.ratio';
        const refs = parseExpression(expr).memberReferences.map(r => r.rootMember);
        expect(refs).toEqual(['mode', 'ratio']);
    });
});

describe('expression-parser', () => {
    describe('parseExpression', () => {
        it('should parse a simple this.member expression', () => {
            const info = parseExpression('this.name');
            expect(info.raw).toBe('this.name');
            expect(info.memberReferences).toHaveLength(1);
            expect(info.memberReferences[0].rootMember).toBe('name');
            expect(info.memberReferences[0].chain).toEqual(['name']);
            expect(info.memberReferences[0].isMethodCall).toBe(false);
        });

        it('should parse a method call', () => {
            const info = parseExpression('this.onClick()');
            expect(info.memberReferences).toHaveLength(1);
            expect(info.memberReferences[0].rootMember).toBe('onClick');
            expect(info.memberReferences[0].isMethodCall).toBe(true);
        });

        it('should parse chained member access', () => {
            const info = parseExpression('this.user.address.city');
            expect(info.memberReferences).toHaveLength(1);
            const ref = info.memberReferences[0];
            expect(ref.rootMember).toBe('user');
            expect(ref.chain).toEqual(['user', 'address', 'city']);
            expect(ref.fullExpression).toBe('this.user.address.city');
        });

        it('should parse optional chaining (?.)', () => {
            const info = parseExpression('this.user?.name');
            expect(info.memberReferences).toHaveLength(1);
            const ref = info.memberReferences[0];
            expect(ref.chain).toEqual(['user', 'name']);
            expect(ref.separators).toEqual([2]); // '?.' has width 2
        });

        it('should parse multiple this references', () => {
            const info = parseExpression('this.x + this.y');
            expect(info.memberReferences).toHaveLength(2);
            expect(info.memberReferences[0].rootMember).toBe('x');
            expect(info.memberReferences[1].rootMember).toBe('y');
        });

        it('should detect template literals', () => {
            const info = parseExpression('`Hello ${this.name}`');
            expect(info.isTemplateLiteral).toBe(true);
            expect(info.memberReferences).toHaveLength(1);
            expect(info.memberReferences[0].rootMember).toBe('name');
        });

        it('should handle expressions without this references', () => {
            const info = parseExpression('Math.random()');
            expect(info.memberReferences).toHaveLength(0);
        });

        it('should split comma-separated expressions', () => {
            const info = parseExpression('this.a, this.b');
            expect(info.subExpressions).toEqual(['this.a', 'this.b']);
        });

        it('should not split commas inside parentheses', () => {
            const info = parseExpression('this.fn(a, b)');
            expect(info.subExpressions).toEqual(['this.fn(a, b)']);
        });

        it('should not split commas inside brackets', () => {
            const info = parseExpression('[this.a, this.b]');
            expect(info.subExpressions).toEqual(['[this.a, this.b]']);
        });

        it('should record start and end offsets', () => {
            const info = parseExpression('this.foo');
            const ref = info.memberReferences[0];
            expect(ref.start).toBe(0);
            expect(ref.end).toBe(8); // 'this.foo'.length
        });

        it('should handle prefix parameter', () => {
            const info = parseExpression('#this.name', '#');
            expect(info.prefix).toBe('#');
        });

        it('should skip this. references inside block comments', () => {
            const info = parseExpression('/* this.hidden */ this.visible');
            expect(info.memberReferences).toHaveLength(1);
            expect(info.memberReferences[0].rootMember).toBe('visible');
        });

        it('should handle mixed . and ?. separators', () => {
            const info = parseExpression('this.a?.b.c');
            const ref = info.memberReferences[0];
            expect(ref.chain).toEqual(['a', 'b', 'c']);
            expect(ref.separators).toEqual([2, 1]); // '?.' then '.'
        });

        it('should not split commas inside string literals', () => {
            const info = parseExpression("this.fn('a,b')");
            expect(info.subExpressions).toEqual(["this.fn('a,b')"]);
        });

        it('should not split commas inside template literals', () => {
            const info = parseExpression('`${this.a},${this.b}`');
            expect(info.subExpressions).toEqual(['`${this.a},${this.b}`']);
        });

        it('should handle empty expression', () => {
            const info = parseExpression('');
            expect(info.memberReferences).toHaveLength(0);
            expect(info.subExpressions).toHaveLength(0);
        });
    });

    describe('findMemberAtOffset', () => {
        it('should find member reference at offset within span', () => {
            const info = parseExpression('this.name');
            const ref = findMemberAtOffset(info, 5); // on 'n' of 'name'
            expect(ref).toBeDefined();
            expect(ref!.rootMember).toBe('name');
        });

        it('should return undefined for offset outside members', () => {
            const info = parseExpression('abc + this.name');
            const ref = findMemberAtOffset(info, 0); // on 'a' of 'abc'
            expect(ref).toBeUndefined();
        });

        it('should find the correct member when multiple exist', () => {
            const info = parseExpression('this.a + this.b');
            const refA = findMemberAtOffset(info, 5); // on 'a'
            expect(refA!.rootMember).toBe('a');
            const refB = findMemberAtOffset(info, 14); // on 'b'
            expect(refB!.rootMember).toBe('b');
        });

        it('should return undefined at the end boundary', () => {
            const info = parseExpression('this.x');
            const ref = findMemberAtOffset(info, 6); // past end
            expect(ref).toBeUndefined();
        });
    });

    describe('getIdentifierAtOffset', () => {
        it('should extract identifier at offset', () => {
            const result = getIdentifierAtOffset('this.myProp', 6);
            expect(result).toBeDefined();
            expect(result!.word).toBe('myProp');
        });

        it('should return undefined for offset at non-identifier', () => {
            const result = getIdentifierAtOffset('a + b', 2);
            expect(result).toBeUndefined();
        });

        it('should return undefined for negative offset', () => {
            expect(getIdentifierAtOffset('abc', -1)).toBeUndefined();
        });

        it('should return undefined for offset past end', () => {
            expect(getIdentifierAtOffset('abc', 5)).toBeUndefined();
        });

        it('should handle $ and _ in identifiers', () => {
            const result = getIdentifierAtOffset('$_name', 0);
            expect(result).toBeDefined();
            expect(result!.word).toBe('$_name');
        });
    });
});

// ---- Round-2 regressions: non-code masking ----

describe('extractMemberReferences — strings and comments are not code', () => {
    it('ignores this.X inside single-quoted strings', () => {
        const info = parseExpression("'a note about this.legacy'");
        expect(info.memberReferences).toHaveLength(0);
    });

    it('ignores this.X inside double-quoted strings', () => {
        const info = parseExpression('this.track("this.oldName")');
        expect(info.memberReferences).toHaveLength(1);
        expect(info.memberReferences[0].rootMember).toBe('track');
    });

    it('ignores template-literal text but keeps ${ } interiors live', () => {
        const info = parseExpression('`Hello ${this.name}, see this.notARef`');
        expect(info.memberReferences).toHaveLength(1);
        expect(info.memberReferences[0].rootMember).toBe('name');
    });

    it('ignores line comments', () => {
        const info = parseExpression('this.a // this.b');
        expect(info.memberReferences).toHaveLength(1);
        expect(info.memberReferences[0].rootMember).toBe('a');
    });

    it('still ignores block comments', () => {
        const info = parseExpression('this.a /* this.b */ + this.c');
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toEqual(['a', 'c']);
    });

    it('keeps offsets aligned for references after a masked string', () => {
        const expr = "this.format('x') && this.value";
        const info = parseExpression(expr);
        const value = info.memberReferences.find(r => r.rootMember === 'value')!;
        expect(value.start).toBe(expr.indexOf('this.value'));
        expect(expr.substring(value.start, value.end)).toBe('this.value');
    });

    it('handles escaped quotes inside strings', () => {
        // runtime expression: this.say('it\'s this.fake') || this.real
        const info = parseExpression("this.say('it\\'s this.fake') || this.real");
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toEqual(['say', 'real']);
    });
});

describe('maskNonCode — string literals inside ${ } interpolations', () => {
    // Regression: the template-literal scanner skipped `${ … }` tracking
    // brace depth only — strings inside the interpolation stayed live,
    // yielding phantom member references (false "does not exist"
    // diagnostics, phantom rename hits) and miscounted braces in strings.
    it('masks string literals nested inside interpolations', () => {
        const info = parseExpression("`${this.fmt('use this.total here')}`");
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toContain('fmt');
        expect(roots).not.toContain('total');
    });

    it('does not miscount braces inside interpolation strings', () => {
        const info = parseExpression("`${this.fmt('}')} ${this.name}`");
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toEqual(['fmt', 'name']);
    });

    it('handles a template literal nested inside an interpolation', () => {
        const info = parseExpression('`${ `${this.inner}` } this.outerText `');
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toEqual(['inner']);
    });

    it('keeps object literals inside interpolations working', () => {
        const info = parseExpression('`${ this.pick({ a: this.left, b: 2 }) } text`');
        const roots = info.memberReferences.map(r => r.rootMember);
        expect(roots).toEqual(['pick', 'left']);
    });
});
