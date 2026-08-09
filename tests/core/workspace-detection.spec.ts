import * as vscode from 'vscode';
import { packageJsonOptsIn, isNubondLanguageServiceEnabled } from '../../src/core/workspace-detection';

// Spy on the live CJS module object (matches extension.spec.ts) — spying on the
// `import * as fs` namespace fails with "Cannot redefine property".
const fs = require('fs');

function setWorkspaceFolders(paths: string[]): void {
    (vscode.workspace as any).workspaceFolders = paths.map((p, index) => ({
        uri: vscode.Uri.file(p),
        name: p,
        index,
    }));
}

describe('workspace-detection', () => {
    describe('packageJsonOptsIn (pure)', () => {
        it('returns false for non-object input', () => {
            expect(packageJsonOptsIn(undefined)).toBe(false);
            expect(packageJsonOptsIn(null)).toBe(false);
            expect(packageJsonOptsIn('nubond')).toBe(false);
            expect(packageJsonOptsIn(42)).toBe(false);
        });

        it('returns false when there is no nubond field', () => {
            expect(packageJsonOptsIn({ name: 'app', dependencies: { nubond: '^1.0.6' } })).toBe(false);
        });

        it('returns false when the nubond field is not an object', () => {
            // A stray top-level version string is not the opt-in block.
            expect(packageJsonOptsIn({ nubond: '1.0.0' })).toBe(false);
        });

        it('returns false when languageService is missing or not strictly true', () => {
            expect(packageJsonOptsIn({ nubond: {} })).toBe(false);
            expect(packageJsonOptsIn({ nubond: { languageService: false } })).toBe(false);
            expect(packageJsonOptsIn({ nubond: { languageService: 'true' } })).toBe(false);
            expect(packageJsonOptsIn({ nubond: { languageService: 1 } })).toBe(false);
        });

        it('returns true for the explicit opt-in block', () => {
            expect(packageJsonOptsIn({ nubond: { languageService: true } })).toBe(true);
            // Tolerates sibling sub-options.
            expect(packageJsonOptsIn({ nubond: { languageService: true, diagnostics: false } })).toBe(true);
        });
    });

    describe('isNubondLanguageServiceEnabled', () => {
        let existsSpy: jest.SpyInstance;
        let readSpy: jest.SpyInstance;

        beforeEach(() => {
            existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            readSpy = jest.spyOn(fs, 'readFileSync');
            (vscode.workspace as any).workspaceFolders = undefined;
        });

        afterEach(() => {
            existsSpy.mockRestore();
            readSpy.mockRestore();
            (vscode.workspace as any).workspaceFolders = undefined;
        });

        it('returns false when there are no workspace folders', () => {
            (vscode.workspace as any).workspaceFolders = undefined;
            expect(isNubondLanguageServiceEnabled()).toBe(false);

            setWorkspaceFolders([]);
            expect(isNubondLanguageServiceEnabled()).toBe(false);
        });

        it('returns true when a folder package.json opts in', () => {
            setWorkspaceFolders(['/project']);
            readSpy.mockReturnValue(JSON.stringify({ nubond: { languageService: true } }));
            expect(isNubondLanguageServiceEnabled()).toBe(true);
        });

        it('returns false when the folder package.json does not opt in', () => {
            setWorkspaceFolders(['/project']);
            readSpy.mockReturnValue(JSON.stringify({ dependencies: { nubond: '^1.0.6' } }));
            expect(isNubondLanguageServiceEnabled()).toBe(false);
        });

        it('skips folders whose package.json does not exist', () => {
            setWorkspaceFolders(['/project']);
            existsSpy.mockReturnValue(false);
            expect(isNubondLanguageServiceEnabled()).toBe(false);
            expect(readSpy).not.toHaveBeenCalled();
        });

        it('does not throw on a malformed package.json and treats it as no opt-in', () => {
            setWorkspaceFolders(['/project']);
            readSpy.mockReturnValue('{ this is not json');
            expect(() => isNubondLanguageServiceEnabled()).not.toThrow();
            expect(isNubondLanguageServiceEnabled()).toBe(false);
        });

        it('returns true if any folder in a multi-root workspace opts in', () => {
            setWorkspaceFolders(['/no', '/yes']);
            readSpy.mockImplementation((p: any) => {
                const sp = String(p).replace(/\\/g, '/');
                return sp.includes('/yes/')
                    ? JSON.stringify({ nubond: { languageService: true } })
                    : JSON.stringify({ name: 'plain' });
            });
            expect(isNubondLanguageServiceEnabled()).toBe(true);
        });
    });
});
