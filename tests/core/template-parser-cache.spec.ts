import { parseTemplateCached } from '../../src/core/template-parser-cache';
import { createMockDocument } from '../helpers';
import * as templateParser from '../../src/core/template-parser';

describe('parseTemplateCached', () => {
    it('returns the same parsed value for the same document version', () => {
        const doc = createMockDocument('<div nb-value="this.foo"></div>');
        const a = parseTemplateCached(doc);
        const b = parseTemplateCached(doc);
        expect(a).toBe(b);
    });

    it('reparses when the document version changes', () => {
        const doc = createMockDocument('<div nb-value="this.foo"></div>');
        const a = parseTemplateCached(doc);
        // Simulate an edit by bumping version. NOTE: the mock doc returns a
        // fixed text from getText(), so we just bump the version field —
        // sufficient to assert the cache invalidates on version change.
        (doc as any).version = 2;
        const b = parseTemplateCached(doc);
        expect(a).not.toBe(b);
    });

    it('parses each unique document independently', () => {
        const docA = createMockDocument('<div nb-value="this.a"></div>', '/a.html');
        const docB = createMockDocument('<div nb-value="this.b"></div>', '/b.html');
        const a = parseTemplateCached(docA);
        const b = parseTemplateCached(docB);
        expect(a).not.toBe(b);
        expect(a.allBindings[0].expression).toBe('this.a');
        expect(b.allBindings[0].expression).toBe('this.b');
    });

    it('calls parseTemplate exactly once for repeated reads at the same version', () => {
        const spy = jest.spyOn(templateParser, 'parseTemplate');
        const before = spy.mock.calls.length;
        const doc = createMockDocument('<div nb-value="this.foo"></div>', '/once.html');
        parseTemplateCached(doc);
        parseTemplateCached(doc);
        parseTemplateCached(doc);
        const callsForThisDoc = spy.mock.calls.length - before;
        expect(callsForThisDoc).toBe(1);
        spy.mockRestore();
    });
});
