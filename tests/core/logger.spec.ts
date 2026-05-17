import { setLogger, resetLogger, logError, logWarn } from '../../src/core/logger';

describe('core/logger', () => {
    afterEach(() => {
        resetLogger();
    });

    it('is silent by default', () => {
        // No setLogger call → both helpers should return without effect.
        expect(() => logError('test', new Error('boom'))).not.toThrow();
        expect(() => logWarn('test', 'something')).not.toThrow();
    });

    it('logError routes to the wired logger with context prefix', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        logError('mod.fn', new Error('boom'));

        expect(captured.length).toBe(1);
        expect(captured[0]).toContain('[mod.fn]');
        expect(captured[0]).toContain('boom');
    });

    it('logError includes the stack trace when present', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        const err = new Error('with-stack');
        logError('ctx', err);

        // The Error's stack property is a string; it should land in the log.
        expect(captured[0]).toMatch(/with-stack/);
        if (err.stack) {
            expect(captured[0]).toContain(err.stack.split('\n')[0]);
        }
    });

    it('logError handles non-Error values gracefully', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        logError('a', 'just a string');
        logError('b', 42);
        logError('c', { foo: 'bar' });
        logError('d', null);
        logError('e', undefined);

        expect(captured.length).toBe(5);
        expect(captured[0]).toContain('just a string');
        expect(captured[1]).toContain('42');
        expect(captured[4]).toContain('(no error object)');
    });

    it('logWarn routes the message with context prefix', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        logWarn('subsys', 'a warning');

        expect(captured).toEqual(['[subsys] a warning']);
    });

    it('never throws when the logger function itself throws', () => {
        setLogger(() => { throw new Error('logger broke'); });

        // Must NOT propagate — logger failures cannot become error sources
        // for the call sites that rely on logError staying safe.
        expect(() => logError('x', new Error('boom'))).not.toThrow();
        expect(() => logWarn('x', 'msg')).not.toThrow();
    });

    it('handles a non-stringifiable error without throwing', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        // Object whose toString throws
        const evil: any = {};
        Object.defineProperty(evil, 'toString', {
            value: () => { throw new Error('toString blocked'); },
        });

        expect(() => logError('x', evil)).not.toThrow();
        expect(captured.length).toBe(1);
        expect(captured[0]).toContain('unstringifiable');
    });

    it('resetLogger restores silent default', () => {
        const captured: string[] = [];
        setLogger(msg => captured.push(msg));

        logError('a', 'one');
        expect(captured.length).toBe(1);

        resetLogger();

        logError('b', 'two');
        // Capture didn't grow — the default logger is silent again.
        expect(captured.length).toBe(1);
    });
});
