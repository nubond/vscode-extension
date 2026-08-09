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

    // ---- Regression: per-project analysis state ----
    // Before fix: a module-level `lastAnalysisVersion` was shared across all
    // projects, so when project B reported the same version string as project
    // A, B's initial analysis was silently skipped (and both shared — and
    // clobbered — one analyzer).
    describe('per-project state isolation', () => {
        function makeLs(): any {
            const ls: any = {};
            for (const m of ['findRenameLocations', 'getProgram', 'getQuickInfoAtPosition']) ls[m] = jest.fn();
            return ls;
        }

        function makeProject(version: string) {
            return {
                getLanguageService: jest.fn(() => ({ getProgram: () => undefined })),
                getProjectVersion: () => version,
                projectService: { getScriptInfo: jest.fn() },
            } as any;
        }

        it('analyzes each project even when project versions collide', () => {
            const projA = makeProject('v1');
            const projB = makeProject('v1'); // same version string as A

            pluginModule.create({
                languageService: makeLs(), project: projA,
                languageServiceHost: {} as any, serverHost: {} as any, config: {},
            });
            pluginModule.create({
                languageService: makeLs(), project: projB,
                languageServiceHost: {} as any, serverHost: {} as any, config: {},
            });

            // Project B must run its own initial analysis — with shared state
            // it was skipped because A had already recorded version 'v1'.
            expect(projA.getLanguageService).toHaveBeenCalled();
            expect(projB.getLanguageService).toHaveBeenCalled();
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

// ---- Round-2 regressions: HTML rename text-search hygiene ----

describe('ts-plugin — HTML rename search (round 2)', () => {
    const os = require('os');

    /** A real on-disk project + a real LanguageService so refreshAnalysis
     *  resolves the template association via the import. */
    function setupRealProject(tsSource: string, htmlSource: string) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubond-tsplugin-r2-')).replace(/\\/g, '/');
        const tsPath = `${tmp}/container.ts`;
        const htmlPath = `${tmp}/template.html`;
        fs.writeFileSync(tsPath, tsSource, 'utf-8');
        fs.writeFileSync(htmlPath, htmlSource, 'utf-8');

        const host: any = {
            getScriptFileNames: () => [tsPath],
            getScriptVersion: () => '1',
            getScriptSnapshot: (f: string) => {
                const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined;
                return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
            },
            getCompilationSettings: () => ({
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                experimentalDecorators: true,
                strict: false,
                skipLibCheck: true,
                noEmit: true,
            }),
            getDefaultLibFileName: (opts: any) => ts.getDefaultLibFilePath(opts),
            fileExists: (f: string) => fs.existsSync(f),
            readFile: (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined),
            getCurrentDirectory: () => tmp,
            useCaseSensitiveFileNames: () => false,
            getNewLine: () => '\n',
        };
        const realLs = ts.createLanguageService(host, ts.createDocumentRegistry());

        const project = {
            getLanguageService: () => realLs,
            getProjectVersion: () => '1',
            projectService: { getScriptInfo: jest.fn(() => null) },
        } as any;

        // The proxied LS only needs findRenameLocations for these tests.
        const mockLS: any = { findRenameLocations: jest.fn(() => []) };
        const info: ts.server.PluginCreateInfo = {
            languageService: mockLS,
            project,
            languageServiceHost: {} as any,
            serverHost: {} as any,
            config: {},
        };
        const proxy = init({ typescript: ts }).create(info);
        return { proxy, tsPath, htmlPath, tmp, realLs };
    }

    afterEach(() => {
        // temp dirs are small; leave OS cleanup to the tmp reaper on failure
    });

    it('re-analyzes after a failed pass even though the project version is unchanged', () => {
        // Regression: analyzeWithLanguageService used to return [] for BOTH
        // "nothing changed" and "program unavailable" — the plugin stamped
        // lastAnalysisVersion on the failed pass and served stale/empty
        // association data until the next unrelated project change.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nubond-tsplugin-l12-')).replace(/\\/g, '/');
        const tsPath = `${tmp}/container.ts`;
        const htmlPath = `${tmp}/template.html`;
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '}',
            '',
        ].join('\n');
        fs.writeFileSync(tsPath, tsSource, 'utf-8');
        fs.writeFileSync(htmlPath, '<div nb-value="this.counter"></div>\n', 'utf-8');

        const host: any = {
            getScriptFileNames: () => [tsPath],
            getScriptVersion: () => '1',
            getScriptSnapshot: (f: string) => {
                const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined;
                return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
            },
            getCompilationSettings: () => ({
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                experimentalDecorators: true,
                strict: false,
                skipLibCheck: true,
                noEmit: true,
            }),
            getDefaultLibFileName: (opts: any) => ts.getDefaultLibFilePath(opts),
            fileExists: (f: string) => fs.existsSync(f),
            readFile: (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined),
            getCurrentDirectory: () => tmp,
            useCaseSensitiveFileNames: () => false,
            getNewLine: () => '\n',
        };
        const realLs = ts.createLanguageService(host, ts.createDocumentRegistry());
        const notReadyLs: any = { getProgram: () => undefined };

        let ready = false;
        const project = {
            getLanguageService: () => (ready ? realLs : notReadyLs),
            getProjectVersion: () => 'stuck-1', // NEVER changes across calls
            projectService: { getScriptInfo: jest.fn(() => null) },
        } as any;

        const mockLS: any = { findRenameLocations: jest.fn(() => []) };
        const proxy = init({ typescript: ts }).create({
            languageService: mockLS,
            project,
            languageServiceHost: {} as any,
            serverHost: {} as any,
            config: {},
        } as ts.server.PluginCreateInfo);

        // Program unavailable: the pass fails → no HTML locations yet.
        const position = tsSource.indexOf('counter');
        const first = (proxy.findRenameLocations(tsPath, position, false, false) ?? []) as ts.RenameLocation[];
        expect(first.filter(l => l.fileName.endsWith('.html'))).toHaveLength(0);

        // Program becomes available at the SAME project version. The failed
        // pass must not have stamped it — this call has to re-analyze.
        ready = true;
        const second = (proxy.findRenameLocations(tsPath, position, false, false) ?? []) as ts.RenameLocation[];
        expect(second.filter(l => l.fileName.endsWith('.html'))).toHaveLength(1);
    });

    // ---- Round 3 (M2): rename initiated at a USAGE site ----
    // getMemberAtPosition only recognized the declaration identifier itself.
    // Renaming `this.counter` from a method body updated all of TS but
    // silently left every template on the old name.
    it('folds in HTML refs when rename starts at a USAGE site, not the declaration', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '    reset(): void {',
            '        this.counter = 0;',
            '    }',
            '}',
            '',
        ].join('\n');
        const htmlSource = '<div nb-value="this.counter"></div>\n';
        const { proxy, tsPath } = setupRealProject(tsSource, htmlSource);

        // Position on `counter` inside `this.counter = 0;` — the usage.
        const position = tsSource.indexOf('this.counter = 0;') + 'this.'.length;
        const result = proxy.findRenameLocations(tsPath, position, false, false) as ts.RenameLocation[];

        expect(result).toBeDefined();
        const htmlLocs = result.filter(l => l.fileName.endsWith('.html'));
        expect(htmlLocs).toHaveLength(1);
        expect(htmlLocs[0].textSpan.start).toBe(htmlSource.indexOf('counter'));
        expect(htmlLocs[0].textSpan.length).toBe('counter'.length);
    });

    it('does not fold in HTML refs for a usage of a NON-member local variable', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '    calc(): number {',
            '        const local = 1;',
            '        return local + 1;',
            '    }',
            '}',
            '',
        ].join('\n');
        // HTML text that happens to contain 'local' must not be touched.
        const htmlSource = '<div nb-value="this.local"></div>\n';
        const { proxy, tsPath } = setupRealProject(tsSource, htmlSource);

        const position = tsSource.indexOf('local + 1');
        const result = proxy.findRenameLocations(tsPath, position, false, false);
        // Mock native rename returned [] and no HTML refs may be added.
        expect(result).toBeUndefined();
    });

    it('skips occurrences inside HTML comments and respects the left word boundary', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '}',
            '',
        ].join('\n');
        const htmlSource = [
            '<!-- legacy: this.counter was renamed once -->',
            '<div nb-value="this.counter"></div>',
            '<span>_this.counter is not a reference</span>',
            '',
        ].join('\n');
        const { proxy, tsPath, htmlPath } = setupRealProject(tsSource, htmlSource);

        const position = tsSource.indexOf('counter');
        const result = proxy.findRenameLocations(tsPath, position, false, false) as ts.RenameLocation[];

        expect(result).toBeDefined();
        const htmlLocs = result.filter(l => l.fileName.endsWith('.html'));
        expect(htmlLocs).toHaveLength(1);
        const expectedStart = htmlSource.indexOf('<div nb-value="this.counter') + '<div nb-value="this.'.length;
        expect(htmlLocs[0].textSpan.start).toBe(expectedStart);
        expect(htmlLocs[0].textSpan.length).toBe('counter'.length);
        expect(htmlLocs[0].fileName.replace(/\\/g, '/')).toBe(htmlPath);
    });

    it('folds in HTML refs when renaming a PRIVATE constructor parameter property', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    constructor(private cd: ChangeDetector) {}',
            '}',
            '',
        ].join('\n');
        const htmlSource = '<div nb-event:click="this.cd.detect()"></div>\n';
        const { proxy, tsPath } = setupRealProject(tsSource, htmlSource);

        const position = tsSource.indexOf('cd:');
        const result = proxy.findRenameLocations(tsPath, position, false, false) as ts.RenameLocation[];

        expect(result).toBeDefined();
        const htmlLocs = result.filter(l => l.fileName.endsWith('.html'));
        expect(htmlLocs).toHaveLength(1);
        expect(htmlLocs[0].textSpan.start).toBe(htmlSource.indexOf('cd.detect'));
    });

    it('does not treat a default-value identifier in a constructor param as a member', () => {
        const tsSource = [
            "import html from './template.html';",
            "const FALLBACK = 'x';",
            '@Container(html)',
            'class C {',
            '    constructor(public label = FALLBACK) {}',
            '}',
            '',
        ].join('\n');
        // HTML that happens to contain matching text — must NOT be touched
        const htmlSource = '<div nb-value="this.FALLBACK"></div>\n';
        const { proxy, tsPath } = setupRealProject(tsSource, htmlSource);

        const position = tsSource.indexOf('FALLBACK) {}');
        const result = proxy.findRenameLocations(tsPath, position, false, false);

        // Original (mock) rename returned [] and no HTML refs may be added
        expect(result).toBeUndefined();
    });

    // ---- Regression: raw text search rewrote non-binding text ----
    // The scan now PARSES the template: prose, <script> content, and
    // '@'-constant literals must never be renamed.
    it('never rewrites prose, <script> content, or @ constant literals', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '}',
            '',
        ].join('\n');
        const htmlSource = [
            '<p>docs mention this.counter in prose</p>',
            '<script>if (this.counter) { console.log(this.counter); }</script>',
            '<i nb-value="@this.counter is a literal"></i>',
            '<div nb-value="this.counter"></div>',
            '',
        ].join('\n');
        const { proxy, tsPath } = setupRealProject(tsSource, htmlSource);

        const position = tsSource.indexOf('counter');
        const result = proxy.findRenameLocations(tsPath, position, false, false) as ts.RenameLocation[];

        expect(result).toBeDefined();
        const htmlLocs = result.filter(l => l.fileName.endsWith('.html'));
        // ONLY the evaluated nb-value binding — not prose (1×), script (2×),
        // or the @ literal (1×).
        expect(htmlLocs).toHaveLength(1);
        const expectedStart = htmlSource.indexOf('<div nb-value="this.counter') + '<div nb-value="this.'.length;
        expect(htmlLocs[0].textSpan.start).toBe(expectedStart);
    });

    // ---- Regression: disk-offset renames corrupted unsaved HTML buffers ----
    // The extension reports dirty HTML files via configurePlugin; the plugin
    // must OMIT them (fail-safe) instead of producing stale-offset edits.
    it('omits rename locations for HTML files reported dirty via onConfigurationChanged', () => {
        const tsSource = [
            "import html from './template.html';",
            '@Container(html)',
            'class C {',
            '    counter = 0;',
            '}',
            '',
        ].join('\n');
        const htmlSource = '<div nb-value="this.counter"></div>\n';
        const { proxy, tsPath, htmlPath } = setupRealProject(tsSource, htmlSource);

        const mod = init({ typescript: ts });
        try {
            // Report the template dirty — with a native-separator path to
            // prove normalization (the analyzer stores forward slashes).
            mod.onConfigurationChanged!({ dirtyHtmlFiles: [htmlPath.replace(/\//g, '\\').toUpperCase()] });

            const position = tsSource.indexOf('counter');
            const result = proxy.findRenameLocations(tsPath, position, false, false);
            // Mock native rename returned [] and the only HTML ref was
            // suppressed → nothing at all.
            expect(result).toBeUndefined();
        } finally {
            // Reset module-level state for the remaining tests.
            mod.onConfigurationChanged!({ dirtyHtmlFiles: [] });
        }

        // Once the file is clean again, the location comes back.
        const position = tsSource.indexOf('counter');
        const result = proxy.findRenameLocations(tsPath, position, false, false) as ts.RenameLocation[];
        expect(result).toBeDefined();
        expect(result.filter(l => l.fileName.endsWith('.html'))).toHaveLength(1);
    });

    // ---- Regression: renaming a member declared on an UNDECORATED base
    // class skipped HTML entirely (the old gate required the declaring class
    // itself to be an association), leaving subclass templates broken.
    it('folds in subclass template refs when renaming a base-class member', () => {
        const os2 = require('os');
        const tmp = fs.mkdtempSync(path.join(os2.tmpdir(), 'nubond-tsplugin-m4-')).replace(/\\/g, '/');
        const basePath = `${tmp}/base.ts`;
        const aPath = `${tmp}/a.ts`;
        const bPath = `${tmp}/b.ts`;
        fs.writeFileSync(basePath, `export class BaseCard { title: string = ''; }`, 'utf-8');
        fs.writeFileSync(aPath, [
            "import html from './a.html';",
            "import { BaseCard } from './base';",
            '@Container(html)',
            'class CardA extends BaseCard {}',
        ].join('\n'), 'utf-8');
        fs.writeFileSync(bPath, [
            "import html from './b.html';",
            "import { BaseCard } from './base';",
            '@Container(html)',
            'class CardB extends BaseCard {}',
        ].join('\n'), 'utf-8');
        fs.writeFileSync(`${tmp}/a.html`, '<div nb-value="this.title"></div>', 'utf-8');
        fs.writeFileSync(`${tmp}/b.html`, '<span nb-value="this.title"></span>', 'utf-8');

        const rootFiles = [basePath, aPath, bPath];
        const host: any = {
            getScriptFileNames: () => rootFiles,
            getScriptVersion: () => '1',
            getScriptSnapshot: (f: string) => {
                const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined;
                return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
            },
            getCompilationSettings: () => ({
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                experimentalDecorators: true,
                strict: false,
                skipLibCheck: true,
                noEmit: true,
            }),
            getDefaultLibFileName: (opts: any) => ts.getDefaultLibFilePath(opts),
            fileExists: (f: string) => fs.existsSync(f),
            readFile: (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : undefined),
            getCurrentDirectory: () => tmp,
            useCaseSensitiveFileNames: () => false,
            getNewLine: () => '\n',
        };
        const realLs = ts.createLanguageService(host, ts.createDocumentRegistry());
        const project = {
            getLanguageService: () => realLs,
            getProjectVersion: () => '1',
            projectService: { getScriptInfo: jest.fn(() => null) },
        } as any;
        const mockLS: any = { findRenameLocations: jest.fn(() => []) };
        const proxy = init({ typescript: ts }).create({
            languageService: mockLS,
            project,
            languageServiceHost: {} as any,
            serverHost: {} as any,
            config: {},
        });

        const baseSource = fs.readFileSync(basePath, 'utf-8');
        const position = baseSource.indexOf('title');
        const result = proxy.findRenameLocations(basePath, position, false, false) as ts.RenameLocation[];

        expect(result).toBeDefined();
        const htmlFiles = result
            .filter(l => l.fileName.endsWith('.html'))
            .map(l => l.fileName.replace(/\\/g, '/').toLowerCase());
        // BOTH subclasses' templates fold in
        expect(htmlFiles.some(f => f.endsWith('a.html'))).toBe(true);
        expect(htmlFiles.some(f => f.endsWith('b.html'))).toBe(true);
    });
});
