import {
    parseExpression,
    findMemberAtOffset,
    getIdentifierAtOffset,
} from '../../src/core/expression-parser';

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
