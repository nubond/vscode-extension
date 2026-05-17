/**
 * Tests for the TypeScript Language Service Plugin (ts-plugin/index.ts).
 *
 * The plugin must NOT interfere with TypeScript file highlighting or diagnostics.
 * Key invariants:
 * - getExternalFiles returns [] (no HTML files pollute the TS project)
 * - findRenameLocations includes HTML refs without requiring ScriptInfo
 * - createProxy preserves all original LS methods
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// The plugin exports an `init` function that returns { create, getExternalFiles }
// We need to call init() to get the module, then test its members.
// Since the plugin uses `export = init`, we import it directly.
const init: (modules: { typescript: typeof ts }) => ts.server.PluginModule = require('../../src/ts-plugin/index');

describe('ts-plugin', () => {
    let pluginModule: ts.server.PluginModule;

    beforeEach(() => {
        pluginModule = init({ typescript: ts });
    });

    describe('getExternalFiles', () => {
        it('should return an empty array', () => {
            const mockProject = {} as ts.server.Project;
            const files = pluginModule.getExternalFiles!(mockProject, 0 as any);
            expect(files).toEqual([]);
        });

        it('should never add HTML files to the TypeScript project', () => {
            // Call multiple times with different projects — always empty
            const p1 = {} as ts.server.Project;
            const p2 = {} as ts.server.Project;
            expect(pluginModule.getExternalFiles!(p1, 0 as any)).toEqual([]);
            expect(pluginModule.getExternalFiles!(p2, 0 as any)).toEqual([]);
        });
    });

    describe('create', () => {
        function createMockLanguageService(): ts.LanguageService {
            const ls: any = {};
            // Add common LS methods as stubs
            const methods = [
                'getCompletionsAtPosition',
                'getCompletionEntryDetails',
                'getQuickInfoAtPosition',
                'getDefinitionAtPosition',
                'getReferencesAtPosition',
                'findRenameLocations',
                'getSemanticDiagnostics',
                'getSyntacticDiagnostics',
                'getSignatureHelpItems',
                'getDocumentHighlights',
                'getFormattingEditsForRange',
                'getProgram',
            ];
            for (const m of methods) {
                ls[m] = jest.fn();
            }
            return ls;
        }

        function createMockProject(version: string = '1'): ts.server.Project {
            const mockProgram = {
                getSourceFiles: () => [],
                getSourceFile: () => undefined,
            };
            const mockLs = {
                getProgram: () => mockProgram,
            };
            return {
                getLanguageService: () => mockLs,
                getProjectVersion: () => version,
                projectService: {
                    getScriptInfo: jest.fn(() => null),
                },
            } as any;
        }

        function createPluginProxy(): ts.LanguageService {
            const mockLS = createMockLanguageService();
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            return pluginModule.create(info);
        }

        it('should return a proxy that has all original LS methods', () => {
            const mockLS = createMockLanguageService();
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            // All methods from the original LS should exist on the proxy
            for (const key of Object.keys(mockLS)) {
                expect(typeof (proxy as any)[key]).toBe('function');
            }
        });

        it('should proxy calls to original LS methods', () => {
            const mockLS = createMockLanguageService();
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            // Call a method on the proxy — should delegate to the original
            (proxy as any).getQuickInfoAtPosition('test.ts', 0);
            expect(mockLS.getQuickInfoAtPosition).toHaveBeenCalledWith('test.ts', 0);
        });

        it('should override findRenameLocations', () => {
            const mockLS = createMockLanguageService();
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            // findRenameLocations on the proxy should NOT be the same function as the original
            expect(proxy.findRenameLocations).not.toBe(mockLS.findRenameLocations);
        });

        it('should not override other LS methods', () => {
            const mockLS = createMockLanguageService();
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            // getSemanticDiagnostics should be proxied, not overridden
            (proxy as any).getSemanticDiagnostics('test.ts');
            expect(mockLS.getSemanticDiagnostics).toHaveBeenCalledWith('test.ts');
        });

        it('findRenameLocations should return original results for non-TS files', () => {
            const mockLS = createMockLanguageService();
            const originalLocs: ts.RenameLocation[] = [
                { fileName: 'test.html', textSpan: { start: 0, length: 5 } },
            ];
            (mockLS.findRenameLocations as jest.Mock).mockReturnValue(originalLocs);

            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            const result = proxy.findRenameLocations('test.html', 0, false, false);
            expect(result).toEqual(originalLocs);
        });

        it('findRenameLocations should return original results when no member found', () => {
            const mockLS = createMockLanguageService();
            const originalLocs: ts.RenameLocation[] = [
                { fileName: 'test.ts', textSpan: { start: 10, length: 3 } },
            ];
            (mockLS.findRenameLocations as jest.Mock).mockReturnValue(originalLocs);

            // Mock getProgram to return a program with no useful source files
            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            const result = proxy.findRenameLocations('test.ts', 0, false, false);
            // Should return original locations (no member detected at position)
            expect(result).toEqual(originalLocs);
        });

        it('findRenameLocations should handle errors in HTML ref lookup gracefully', () => {
            // The plugin logs swallowed errors via console.error when no tsserver
            // logger is available (which is always the case in tests). This test
            // deliberately triggers that path, so silence the fallback to keep
            // the test output clean.
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            try {
                const mockLS = createMockLanguageService();
                const originalLocs: ts.RenameLocation[] = [
                    { fileName: 'test.ts', textSpan: { start: 10, length: 3 } },
                ];
                (mockLS.findRenameLocations as jest.Mock).mockReturnValue(originalLocs);

                const mockProject = createMockProject();
                // Make getLanguageService throw on second call (during refreshAnalysis inside try)
                let callCount = 0;
                (mockProject as any).getLanguageService = () => {
                    callCount++;
                    if (callCount > 1) throw new Error('Analysis error');
                    return { getProgram: () => ({ getSourceFiles: () => [] }) };
                };

                const info: ts.server.PluginCreateInfo = {
                    languageService: mockLS,
                    project: mockProject,
                    languageServiceHost: {} as any,
                    serverHost: {} as any,
                    config: {},
                };
                const proxy = pluginModule.create(info);

                // Should not throw — errors in the try block are caught, original results returned
                const result = proxy.findRenameLocations('test.ts', 0, false, false);
                expect(result).toEqual(originalLocs);
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('findRenameLocations should return undefined when original returns empty and no HTML refs', () => {
            const mockLS = createMockLanguageService();
            (mockLS.findRenameLocations as jest.Mock).mockReturnValue([]);

            const mockProject = createMockProject();
            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: mockProject,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            const result = proxy.findRenameLocations('test.ts', 0, false, false);
            expect(result).toBeUndefined();
        });
    });

    // ---- Catastrophic-failure isolation suite ----
    // The ts-plugin runs INSIDE tsserver. If our overrides throw uncaught,
    // tsserver may degrade or crash — disabling TypeScript IntelliSense for
    // every project the user has open. These tests pin down the contract:
    // any internal failure must fall back to native tsserver behavior.
    describe('catastrophic failure isolation', () => {
        // Every test here intentionally trips an internal failure path. The
        // plugin's pluginLog() routes to console.error when no tsserver logger
        // is available (the case in unit tests), so silence it suite-wide to
        // keep the test output clean.
        let consoleErrorSpy: jest.SpyInstance;
        beforeEach(() => {
            consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        });
        afterEach(() => {
            consoleErrorSpy.mockRestore();
        });

        function createMockLanguageService(): ts.LanguageService {
            const ls: any = {};
            const methods = [
                'getCompletionsAtPosition', 'getCompletionEntryDetails', 'getQuickInfoAtPosition',
                'getDefinitionAtPosition', 'getReferencesAtPosition', 'findRenameLocations',
                'getSemanticDiagnostics', 'getSyntacticDiagnostics', 'getSignatureHelpItems',
                'getDocumentHighlights', 'getFormattingEditsForRange', 'getProgram',
            ];
            for (const m of methods) ls[m] = jest.fn();
            return ls;
        }

        function createMockProject(): ts.server.Project {
            const ls = createMockLanguageService();
            return {
                getLanguageService: () => ls,
                getProjectVersion: () => 'v1',
                projectService: { getScriptInfo: jest.fn() },
            } as unknown as ts.server.Project;
        }

        it('init() never throws — returns a valid plugin module shape', () => {
            expect(() => init({ typescript: ts })).not.toThrow();
            const mod = init({ typescript: ts });
            expect(typeof mod.create).toBe('function');
            expect(typeof mod.getExternalFiles).toBe('function');
        });

        it('getExternalFiles never throws even on a malformed project', () => {
            const evilProject = new Proxy({}, {
                get: () => { throw new Error('project access blocked'); },
            }) as ts.server.Project;
            expect(() => pluginModule.getExternalFiles!(evilProject, 0 as any)).not.toThrow();
            expect(pluginModule.getExternalFiles!(evilProject, 0 as any)).toEqual([]);
        });

        it('create() returns the original LanguageService when info is malformed', () => {
            const mockLS = createMockLanguageService();
            const badInfo = { languageService: mockLS } as any;  // missing .project
            const result = pluginModule.create(badInfo);
            // We must return SOME usable LanguageService — the original tsserver
            // one. tsserver continues with native behavior unchanged.
            expect(result).toBe(mockLS);
        });

        it('create() returns the original LanguageService if construction throws', () => {
            // Simulate a corrupted info object that breaks our internals.
            // The proxy should fall back to the unmodified tsserver LS.
            const mockLS = createMockLanguageService();
            const sabotagedInfo = {
                languageService: mockLS,
                get project() { throw new Error('project init failed'); },
            } as any;
            const result = pluginModule.create(sabotagedInfo);
            expect(result).toBe(mockLS);
        });

        it('findRenameLocations override falls back to native on internal throw', () => {
            const mockLS = createMockLanguageService();
            const nativeRenames = [{ fileName: 'a.ts', textSpan: { start: 0, length: 4 } }];
            (mockLS.findRenameLocations as jest.Mock).mockReturnValue(nativeRenames);

            // Sabotage the project so refreshAnalysis throws inside our override.
            const project = createMockProject();
            (project as any).getLanguageService = () => {
                throw new Error('tsserver degraded');
            };

            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project,
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            const proxy = pluginModule.create(info);

            // Even with our internals exploding, the override must return the
            // native tsserver result so the rename UI still works.
            expect(() => proxy.findRenameLocations('x.ts', 0, false, false)).not.toThrow();
            const result = proxy.findRenameLocations('x.ts', 0, false, false);
            expect(result).toEqual(nativeRenames);
        });

        it('proxy never mutates the original LanguageService', () => {
            const mockLS = createMockLanguageService();
            const originalRename = mockLS.findRenameLocations;

            const info: ts.server.PluginCreateInfo = {
                languageService: mockLS,
                project: createMockProject(),
                languageServiceHost: {} as any,
                serverHost: {} as any,
                config: {},
            };
            pluginModule.create(info);

            // The original mockLS object must still have its original methods —
            // we only replace methods on the *proxy*, not on tsserver's LS.
            expect(mockLS.findRenameLocations).toBe(originalRename);
        });
    });
});
