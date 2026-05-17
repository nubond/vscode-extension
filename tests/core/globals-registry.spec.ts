import {
    getGlobalObjectMembers,
    getAllGlobalObjects,
    getAllGlobalFunctions,
    getAllGlobalConstants,
} from '../../src/core/globals-registry';

describe('globals-registry', () => {
    describe('getGlobalObjectMembers', () => {
        it('should return console members', () => {
            const members = getGlobalObjectMembers('console');
            expect(members).toBeDefined();
            expect(members!.length).toBeGreaterThan(0);
            const names = members!.map(m => m.name);
            expect(names).toContain('log');
            expect(names).toContain('warn');
            expect(names).toContain('error');
        });

        it('should return Math members', () => {
            const members = getGlobalObjectMembers('Math');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('PI');
            expect(names).toContain('abs');
            expect(names).toContain('floor');
            expect(names).toContain('random');
        });

        it('should have correct kind for Math members', () => {
            const members = getGlobalObjectMembers('Math')!;
            const pi = members.find(m => m.name === 'PI')!;
            expect(pi.kind).toBe('property');
            const abs = members.find(m => m.name === 'abs')!;
            expect(abs.kind).toBe('method');
        });

        it('should return JSON members', () => {
            const members = getGlobalObjectMembers('JSON');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('parse');
            expect(names).toContain('stringify');
        });

        it('should return Object members', () => {
            const members = getGlobalObjectMembers('Object');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('keys');
            expect(names).toContain('values');
            expect(names).toContain('entries');
        });

        it('should return Array members', () => {
            const members = getGlobalObjectMembers('Array');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('isArray');
            expect(names).toContain('from');
        });

        it('should return Number members', () => {
            const members = getGlobalObjectMembers('Number');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('isNaN');
            expect(names).toContain('MAX_SAFE_INTEGER');
        });

        it('should return String members', () => {
            const members = getGlobalObjectMembers('String');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('fromCharCode');
        });

        it('should return Date members', () => {
            const members = getGlobalObjectMembers('Date');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('now');
            expect(names).toContain('parse');
        });

        it('should return Promise members', () => {
            const members = getGlobalObjectMembers('Promise');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('all');
            expect(names).toContain('resolve');
            expect(names).toContain('reject');
        });

        it('should return document members', () => {
            const members = getGlobalObjectMembers('document');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('getElementById');
            expect(names).toContain('querySelector');
            expect(names).toContain('body');
        });

        it('should return window members', () => {
            const members = getGlobalObjectMembers('window');
            expect(members).toBeDefined();
            const names = members!.map(m => m.name);
            expect(names).toContain('innerWidth');
            expect(names).toContain('setTimeout');
            expect(names).toContain('fetch');
        });

        it('should return undefined for unknown global', () => {
            expect(getGlobalObjectMembers('unknown')).toBeUndefined();
        });

        it('should return undefined for empty string', () => {
            expect(getGlobalObjectMembers('')).toBeUndefined();
        });
    });

    describe('getAllGlobalObjects', () => {
        it('should return all global objects', () => {
            const objects = getAllGlobalObjects();
            expect(objects.length).toBeGreaterThan(0);
            const names = objects.map(o => o.name);
            expect(names).toContain('console');
            expect(names).toContain('Math');
            expect(names).toContain('JSON');
            expect(names).toContain('document');
            expect(names).toContain('window');
        });

        it('each object should have name, type, desc and members', () => {
            const objects = getAllGlobalObjects();
            for (const obj of objects) {
                expect(obj.name).toBeTruthy();
                expect(obj.type).toBeTruthy();
                expect(obj.desc).toBeTruthy();
                expect(obj.members.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getAllGlobalFunctions', () => {
        it('should return global functions', () => {
            const fns = getAllGlobalFunctions();
            expect(fns.length).toBeGreaterThan(0);
            const names = fns.map(f => f.name);
            expect(names).toContain('parseInt');
            expect(names).toContain('parseFloat');
            expect(names).toContain('isNaN');
            expect(names).toContain('setTimeout');
            expect(names).toContain('fetch');
        });

        it('each function should have name, type and desc', () => {
            const fns = getAllGlobalFunctions();
            for (const fn of fns) {
                expect(fn.name).toBeTruthy();
                expect(fn.type).toBeTruthy();
                expect(fn.desc).toBeTruthy();
            }
        });
    });

    describe('getAllGlobalConstants', () => {
        it('should return global constants', () => {
            const consts = getAllGlobalConstants();
            expect(consts.length).toBeGreaterThan(0);
            const names = consts.map(c => c.name);
            expect(names).toContain('undefined');
            expect(names).toContain('null');
            expect(names).toContain('NaN');
            expect(names).toContain('true');
            expect(names).toContain('false');
        });

        it('each constant should have name, type and desc', () => {
            const consts = getAllGlobalConstants();
            for (const c of consts) {
                expect(c.name).toBeTruthy();
                expect(c.type).toBeTruthy();
                expect(c.desc).toBeTruthy();
            }
        });
    });
});
