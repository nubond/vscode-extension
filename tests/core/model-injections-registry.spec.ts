import {
    getModelInjection,
    getModelInjectionByType,
    getModelInjectionMember,
} from '../../src/core/model-injections-registry';

describe('model-injections-registry', () => {
    describe('router docs (framework parity)', () => {
        it('resolves the router injection by name and by type', () => {
            expect(getModelInjection('router')?.type).toBe('Router');
            expect(getModelInjectionByType('Router | undefined')?.name).toBe('router');
        });

        it('go() documents all-or-nothing validation and queued navigation from callbacks', () => {
            const desc = getModelInjectionMember('router', ['go'])!.desc;
            expect(desc).toMatch(/All-or-nothing/);
            expect(desc).toMatch(/unknown container name/);
            expect(desc).toMatch(/unknown slot key/);
            expect(desc).toMatch(/queued/);
        });

        it('onBeforeStateChange documents preventChange and the redirecting-guard rule', () => {
            const desc = getModelInjectionMember('router', ['onBeforeStateChange'])!.desc;
            expect(desc).toMatch(/preventChange\(\)/);
            expect(desc).toMatch(/both `router\.go\(target\)` and `preventChange\(\)`/);
        });
    });
});
