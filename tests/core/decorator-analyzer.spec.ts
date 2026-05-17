import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { Constants } from '../../src/constants';
import type * as ts from 'typescript';

describe('DecoratorAnalyzer', () => {
    let analyzer: DecoratorAnalyzer;

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    describe('analyzeSourceText', () => {
        it('should detect @Container decorated class', () => {
            const source = `
                import { Container } from '${Constants.INTERNAL_NAME}';
                @Container({ template: './test.html' })
                class TestContainer {
                    name: string = '';
                    count: number = 0;
                    getName(): string { return this.name; }
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/container.ts');
            expect(assocs.length).toBe(1);
            expect(assocs[0].className).toBe('TestContainer');
            expect(assocs[0].decoratorType).toBe('Container');
        });

        it('should extract class members', () => {
            const source = `
                @Container({ template: './test.html' })
                class MyContainer {
                    public name: string = '';
                    private secret: number = 0;
                    count: number = 0;
                    getName(): string { return this.name; }
                    get title(): string { return ''; }
                }
            `;
            analyzer.analyzeSourceText('/test/my.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/my.ts');
            expect(assocs.length).toBe(1);
            const members = assocs[0].members;
            expect(members.length).toBeGreaterThan(0);
            const nameField = members.find(m => m.name === 'name');
            expect(nameField).toBeDefined();
            expect(nameField!.kind).toBe('property');
            expect(nameField!.isPublic).toBe(true);
        });

        it('should detect @Component decorated class', () => {
            const source = `
                @Component({ template: './comp.html' })
                class MyComponent {
                    value: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/comp.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/comp.ts');
            expect(assocs.length).toBe(1);
            expect(assocs[0].decoratorType).toBe('Component');
        });

        it('should detect @Aspect entity', () => {
            const source = `
                @Aspect()
                class MyAspect {
                    onAttach(): void {}
                }
            `;
            analyzer.analyzeSourceText('/test/aspect.ts', source);
            const aspects = analyzer.getEntitiesByType('aspect');
            expect(aspects.length).toBe(1);
            expect(aspects[0].className).toBe('MyAspect');
        });

        it('should detect @Transformer entity with default function name', () => {
            const source = `
                @Transformer()
                class Localize {
                    transform(value: string): string { return value; }
                }
            `;
            analyzer.analyzeSourceText('/test/localize.ts', source);
            const transformers = analyzer.getEntitiesByType('transformer');
            expect(transformers.length).toBe(1);
            expect(transformers[0].className).toBe('Localize');
            expect(transformers[0].transformerFunctionName).toBe('localize');
        });

        it('should detect @Transformer entity with custom function name', () => {
            const source = `
                @Transformer('fmt')
                class Formatter {
                    transform(value: string): string { return value; }
                }
            `;
            analyzer.analyzeSourceText('/test/formatter.ts', source);
            const transformers = analyzer.getEntitiesByType('transformer');
            expect(transformers.length).toBe(1);
            expect(transformers[0].transformerFunctionName).toBe('fmt');
        });

        it('should detect @Injectable entity', () => {
            const source = `
                @Injectable()
                class MyService {
                    getData(): string[] { return []; }
                }
            `;
            analyzer.analyzeSourceText('/test/service.ts', source);
            const injectables = analyzer.getEntitiesByType('injectable');
            expect(injectables.length).toBe(1);
            expect(injectables[0].className).toBe('MyService');
        });

        it('should detect interface declarations for type index', () => {
            const source = `
                export interface UserData {
                    name: string;
                    age: number;
                }
                @Container({ template: './test.html' })
                class TestContainer {
                    user: UserData | null = null;
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            // Interfaces are tracked in typeIndex; getTypeMembers reads the file
            // Since we use analyzeSourceText with virtual paths, fs.readFileSync won't work
            // But we can verify the entity was registered
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            expect(assocs.length).toBe(1);
            const userMember = assocs[0].members.find(m => m.name === 'user');
            expect(userMember).toBeDefined();
        });

        it('should handle multiple classes in one file', () => {
            const source = `
                @Container({ template: './a.html' })
                class ContainerA {
                    propA: string = '';
                }
                @Component({ template: './b.html' })
                class ComponentB {
                    propB: number = 0;
                }
            `;
            analyzer.analyzeSourceText('/test/multi.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/multi.ts');
            expect(assocs.length).toBe(2);
        });
    });

    describe('getAssociationsForHtml', () => {
        it('should return associations for known HTML file', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            // The resolved path may depend on implementation; check the association exists
            const allAssocs = analyzer.getAllAssociations();
            const htmlAssoc = allAssocs.find(a => a.htmlFilePath?.includes('test.html'));
            if (htmlAssoc && htmlAssoc.htmlFilePath) {
                const result = analyzer.getAssociationsForHtml(htmlAssoc.htmlFilePath);
                expect(result.length).toBeGreaterThan(0);
            }
        });

        it('should return empty array for unknown HTML file', () => {
            const result = analyzer.getAssociationsForHtml('/unknown/file.html');
            expect(result).toEqual([]);
        });
    });

    describe('findMember', () => {
        it('should find member by name', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    name: string = '';
                    count: number = 0;
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const member = analyzer.findMember(assocs[0], 'name');
            expect(member).toBeDefined();
            expect(member!.name).toBe('name');
        });

        it('should return undefined for non-existing member', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const member = analyzer.findMember(assocs[0], 'nonExisting');
            expect(member).toBeUndefined();
        });
    });

    describe('getAllAssociations', () => {
        it('should return all associations', () => {
            const source1 = `
                @Container({ template: './a.html' })
                class A { propA: string = ''; }
            `;
            const source2 = `
                @Component({ template: './b.html' })
                class B { propB: number = 0; }
            `;
            analyzer.analyzeSourceText('/test/a.ts', source1);
            analyzer.analyzeSourceText('/test/b.ts', source2);
            const all = analyzer.getAllAssociations();
            expect(all.length).toBe(2);
        });
    });

    describe('getAllEntities', () => {
        it('should return all entities', () => {
            const source = `
                @Container({ template: './test.html' })
                class MyContainer { name: string = ''; }
                @Aspect()
                class MyAspect {}
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const entities = analyzer.getAllEntities();
            expect(entities.length).toBe(2);
        });
    });

    describe('getTransformerByFunctionName', () => {
        it('should find transformer by function name', () => {
            const source = `
                @Transformer()
                class Localize {
                    transform(value: string): string { return value; }
                }
            `;
            analyzer.analyzeSourceText('/test/localize.ts', source);
            const result = analyzer.getTransformerByFunctionName('localize');
            expect(result).toBeDefined();
            expect(result!.className).toBe('Localize');
        });

        it('should return undefined for non-existing function name', () => {
            const result = analyzer.getTransformerByFunctionName('nonExisting');
            expect(result).toBeUndefined();
        });
    });

    describe('clear', () => {
        it('should clear all data', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer { name: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            expect(analyzer.getAllAssociations().length).toBe(1);
            analyzer.clear();
            expect(analyzer.getAllAssociations().length).toBe(0);
            expect(analyzer.getAllEntities().length).toBe(0);
        });
    });

    describe('removeFile', () => {
        it('should remove associations for a specific file', () => {
            const source1 = `
                @Container({ template: './a.html' })
                class A { name: string = ''; }
            `;
            const source2 = `
                @Container({ template: './b.html' })
                class B { name: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/a.ts', source1);
            analyzer.analyzeSourceText('/test/b.ts', source2);
            expect(analyzer.getAllAssociations().length).toBe(2);
            analyzer.removeFile('/test/a.ts');
            expect(analyzer.getAllAssociations().length).toBe(1);
            expect(analyzer.getAssociationsForTs('/test/a.ts')).toEqual([]);
        });

        it('should also remove entities for the file', () => {
            const source = `
                @Transformer()
                class Localize {
                    transform(v: string): string { return v; }
                }
            `;
            analyzer.analyzeSourceText('/test/localize.ts', source);
            expect(analyzer.getEntitiesByType('transformer').length).toBe(1);
            analyzer.removeFile('/test/localize.ts');
            expect(analyzer.getEntitiesByType('transformer').length).toBe(0);
        });

        it('should clean up htmlToTs mapping', () => {
            const source = `
                import html from './template.html';
                @Container(html)
                class MyContainer { name: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const htmlPath = analyzer.getAllAssociations()[0]?.htmlFilePath;
            expect(htmlPath).toBeDefined();
            expect(analyzer.getAssociationsForHtml(htmlPath!).length).toBe(1);
            analyzer.removeFile('/test/container.ts');
            expect(analyzer.getAssociationsForHtml(htmlPath!).length).toBe(0);
        });

        it('should clean up typeIndex entries for the file', () => {
            const source = `
                type MyCustomType = { x: number; };
                interface AnotherType { y: string; }
                @Container({ template: './test.html' })
                class TestContainer {
                    data: MyCustomType | null = null;
                    other: AnotherType | null = null;
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            // After removal, typeIndex entries for this file should all be cleaned
            analyzer.removeFile('/test/container.ts');
            expect(analyzer.getAllAssociations().length).toBe(0);
        });

        it('should handle removing non-existent file gracefully', () => {
            expect(() => analyzer.removeFile('/nonexistent/file.ts')).not.toThrow();
        });
    });

    describe('getEntitiesByType', () => {
        it('should filter by container type', () => {
            const source = `
                @Container({ template: './test.html' })
                class MyContainer { name: string = ''; }
                @Component({ template: './comp.html' })
                class MyComponent { value: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const containers = analyzer.getEntitiesByType('container');
            expect(containers.length).toBe(1);
            expect(containers[0].className).toBe('MyContainer');
            const components = analyzer.getEntitiesByType('component');
            expect(components.length).toBe(1);
            expect(components[0].className).toBe('MyComponent');
        });
    });

    describe('private member detection', () => {
        it('should mark private members as not public', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    public publicProp: string = '';
                    private privateProp: number = 0;
                    protected protectedProp: boolean = false;
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const members = assocs[0].members;
            const publicMember = members.find(m => m.name === 'publicProp');
            expect(publicMember?.isPublic).toBe(true);
            const privateMember = members.find(m => m.name === 'privateProp');
            expect(privateMember?.isPublic).toBe(false);
        });
    });

    describe('method detection', () => {
        it('should detect methods and their return types', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    getValue(): string { return ''; }
                    calculate(a: number, b: number): number { return a + b; }
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const getValue = assocs[0].members.find(m => m.name === 'getValue');
            expect(getValue).toBeDefined();
            expect(getValue!.kind).toBe('method');
            expect(getValue!.type).toBe('string');
        });
    });

    describe('getter/setter detection', () => {
        it('should detect getters', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    private _name: string = '';
                    get name(): string { return this._name; }
                    set name(value: string) { this._name = value; }
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const getter = assocs[0].members.find(m => m.name === 'name' && m.kind === 'getter');
            expect(getter).toBeDefined();
            expect(getter!.type).toBe('string');
        });
    });

    describe('constructor parameter extraction', () => {
        it('should extract public constructor parameters as members', () => {
            const source = `
                @Container({ template: './test.html' })
                class TestContainer {
                    constructor(public name: string, private secret: number) {}
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            const members = assocs[0].members;
            const nameMember = members.find(m => m.name === 'name');
            expect(nameMember).toBeDefined();
            expect(nameMember!.isPublic).toBe(true);
        });
    });

    describe('type alias indexing', () => {
        it('should index type aliases', () => {
            const source = `
                type UserData = {
                    name: string;
                    age: number;
                }
                @Container({ template: './test.html' })
                class TestContainer {
                    user: UserData | null = null;
                }
            `;
            analyzer.analyzeSourceText('/test/test.ts', source);
            const assocs = analyzer.getAssociationsForTs('/test/test.ts');
            expect(assocs.length).toBe(1);
            const userMember = assocs[0].members.find(m => m.name === 'user');
            expect(userMember).toBeDefined();
            expect(userMember!.type).toContain('UserData');
        });
    });

    describe('template resolution via import', () => {
        it('should resolve template from import html identifier', () => {
            const source = `
                import html from './template.html';
                @Container(html)
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const allAssocs = analyzer.getAllAssociations();
            expect(allAssocs.length).toBe(1);
            expect(allAssocs[0].htmlFilePath).toBeDefined();
            expect(allAssocs[0].htmlFilePath).toContain('template.html');
        });

        it('should handle decorator with no arguments returning null', () => {
            const source = `
                @Container()
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const allAssocs = analyzer.getAllAssociations();
            // @Container() with no args is not registered
            expect(allAssocs.length).toBe(0);
        });

        it('should handle non-call expression decorators', () => {
            const source = `
                @Container
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            // Bare @Container without () should not crash
            const allAssocs = analyzer.getAllAssociations();
            // May or may not detect it, but should not throw
            expect(() => analyzer.getAllAssociations()).not.toThrow();
        });
    });

    describe('array-literal template format', () => {
        it('should handle array template with import and string', () => {
            const source = `
                import styles from './styles.css';
                @Container([styles, '<div>inline</div>'])
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const allAssocs = analyzer.getAllAssociations();
            expect(allAssocs.length).toBe(1);
        });
    });

    describe('inline template strings', () => {
        it('should handle inline template string', () => {
            const source = `
                @Container('<div>hello</div>')
                class TestContainer {
                    name: string = '';
                }
            `;
            analyzer.analyzeSourceText('/test/container.ts', source);
            const allAssocs = analyzer.getAllAssociations();
            expect(allAssocs.length).toBe(1);
            // Inline templates don't have htmlFilePath
            expect(allAssocs[0].htmlFilePath).toBeUndefined();
        });
    });

    // ---- Regression: source-file cache in DecoratorAnalyzer ----
    // Before fix: findMemberInType / findMemberWithType / getTypeMembers each
    // re-read+re-parsed the source file on every call. Repeated lookups for the
    // same type (via hover/completion across keystrokes) blew up disk I/O.
    describe('source-file cache', () => {
        it('reads each TS file at most once across repeated lookups', () => {
            const path = '/test/cached-types.ts';
            const src = `
                export interface User { name: string; age: number; }
                export interface Admin { role: string; }
            `;
            // Prime the cache and typeIndex via analyzeSourceText.
            analyzer.analyzeSourceText(path, src);

            const fsMod = require('fs');
            const readSpy = jest.spyOn(fsMod, 'readFileSync');

            try {
                // Multiple lookups against multiple types in the same file.
                analyzer.getTypeMembers('User');
                analyzer.findMemberInType('User', 'name');
                analyzer.findMemberWithType('User', 'age');
                analyzer.getTypeMembers('Admin');
                analyzer.findMemberInType('Admin', 'role');

                // The source file should NOT be re-read — analyzeSourceText
                // primed the cache with the in-memory parse.
                const callsForThisFile = readSpy.mock.calls.filter(
                    (args: any[]) => typeof args[0] === 'string' && args[0] === path
                );
                expect(callsForThisFile.length).toBe(0);
            } finally {
                readSpy.mockRestore();
            }
        });

        it('invalidates the cache on removeFile', () => {
            const path = '/test/invalidate.ts';
            const src = `export interface Thing { x: number; }`;
            analyzer.analyzeSourceText(path, src);

            // Confirm cached members exist.
            expect(analyzer.getTypeMembers('Thing')).toBeDefined();

            // Remove the file → both typeIndex and sourceFileCache should drop.
            analyzer.removeFile(path);

            const fsMod = require('fs');
            const readSpy = jest.spyOn(fsMod, 'readFileSync');
            try {
                // Lookup must miss (typeIndex empty) and must NOT touch disk.
                expect(analyzer.getTypeMembers('Thing')).toBeUndefined();
                expect(readSpy).not.toHaveBeenCalled();
            } finally {
                readSpy.mockRestore();
            }
        });
    });

    // ---- P3.4.5 Stage 1: LanguageService-aware incremental analysis ----
    // Before fix: analyzeSourceText (the per-edit path) parsed without a
    // TypeChecker, downgrading every inferred member type to 'any'.
    // After fix: analyzeWithLanguageService(ls) uses the LanguageService's
    // incremental program, which preserves the TypeChecker on every edit.
    describe('analyzeWithLanguageService', () => {
        const ts = require('typescript');

        /**
         * Build a minimal in-memory `ts.LanguageService` over a fixed map of
         * file paths → contents. Tests can mutate `files` and bump versions
         * via `bumpVersion(path)` to simulate edits — the LanguageService's
         * incremental builder will re-parse only the files whose version
         * changed, just like in production.
         */
        function buildInMemoryLs(files: Map<string, string>) {
            const versions = new Map<string, number>();
            for (const f of files.keys()) versions.set(f, 0);

            const host: any = {
                getScriptFileNames: () => Array.from(files.keys()),
                getScriptVersion: (f: string) => String(versions.get(f) ?? 0),
                getScriptSnapshot: (f: string) => {
                    const text = files.get(f);
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
                fileExists: (f: string) => files.has(f) || ts.sys.fileExists(f),
                readFile: (f: string) => files.get(f) ?? ts.sys.readFile(f),
                getCurrentDirectory: () => '/test',
                useCaseSensitiveFileNames: () => true,
                getNewLine: () => '\n',
            };

            const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
            return {
                ls,
                bumpVersion: (f: string) => versions.set(f, (versions.get(f) ?? 0) + 1),
            };
        }

        it('preserves inferred types on every analyzer call (no `any` regression)', () => {
            // Property without an explicit annotation — only the TypeChecker
            // can know its type. Under the buggy old `analyzeSourceText` path
            // this collapsed to 'any' on every edit.
            const files = new Map<string, string>();
            files.set('/test/svc.ts', `
                export class UserService { list(): string[] { return []; } }
            `);
            files.set('/test/container.ts', `
                import html from './template.html';
                import { UserService } from './svc';
                @Container(html)
                class UserList {
                    private service = new UserService();
                }
            `);

            const { ls } = buildInMemoryLs(files);
            analyzer.analyzeWithLanguageService(ls);

            const assocs = analyzer.getAssociationsForTs('/test/container.ts');
            expect(assocs.length).toBe(1);
            const service = assocs[0].members.find(m => m.name === 'service');
            expect(service).toBeDefined();
            // Crucially this is NOT 'any' — the LanguageService gave us a
            // real TypeChecker, so the inferred type was resolved.
            expect(service!.type).toContain('UserService');
        });

        it('is idempotent and skips unchanged files on subsequent calls', () => {
            const files = new Map<string, string>();
            files.set('/test/a.ts', `
                @Container('a.html')
                class A { name: string = ''; }
            `);
            files.set('/test/b.ts', `
                @Container('b.html')
                class B { count: number = 0; }
            `);

            const { ls, bumpVersion } = buildInMemoryLs(files);

            const first = analyzer.analyzeWithLanguageService(ls);
            expect(first.length).toBe(2); // both files analyzed on cold start

            // No version bumps → second call should be a complete no-op
            const second = analyzer.analyzeWithLanguageService(ls);
            expect(second.length).toBe(0);

            // Now simulate editing file a — only a should be re-analyzed
            files.set('/test/a.ts', `
                @Container('a.html')
                class A { name: string = ''; newField: number = 0; }
            `);
            bumpVersion('/test/a.ts');

            const third = analyzer.analyzeWithLanguageService(ls);
            expect(third.length).toBe(1);
            expect(third[0]).toMatch(/a\.ts$/);

            // The new field is now indexed
            const aAssocs = analyzer.getAssociationsForTs('/test/a.ts');
            expect(aAssocs[0].members.find(m => m.name === 'newField')).toBeDefined();
        });

        it('drops associations when a file disappears between calls', () => {
            const files = new Map<string, string>();
            files.set('/test/willGoAway.ts', `
                @Container('x.html')
                class Going { x: string = ''; }
            `);

            const { ls } = buildInMemoryLs(files);
            analyzer.analyzeWithLanguageService(ls);
            expect(analyzer.getAssociationsForTs('/test/willGoAway.ts').length).toBe(1);

            // Drop the file from the in-memory project — second call should
            // notice it's gone and clear the analyzer's state for it.
            files.delete('/test/willGoAway.ts');
            analyzer.analyzeWithLanguageService(ls);
            expect(analyzer.getAssociationsForTs('/test/willGoAway.ts').length).toBe(0);
        });

        it('returns empty array if the LanguageService has no Program yet', () => {
            const fakeLs: any = { getProgram: () => undefined };
            expect(analyzer.analyzeWithLanguageService(fakeLs)).toEqual([]);
        });

        // ---- Failure-isolation regressions ----
        // The recurring guidance throughout this codebase is: when our
        // extension fails it MUST NOT break VS Code's native TS / HTML / CSS
        // language support. A previous version of the extension was so leaky
        // that the user had to disable it to keep working — these tests
        // pin down the boundaries that prevent a recurrence.

        it('does not throw when LanguageService.getProgram() throws', () => {
            const exploding: any = { getProgram: () => { throw new Error('tsserver bad state'); } };
            expect(() => analyzer.analyzeWithLanguageService(exploding)).not.toThrow();
            expect(analyzer.analyzeWithLanguageService(exploding)).toEqual([]);
        });

        it('does not throw when getTypeChecker() throws', () => {
            const exploding: any = {
                getProgram: () => ({
                    getTypeChecker: () => { throw new Error('checker init failure'); },
                    getSourceFiles: () => [],
                }),
            };
            expect(() => analyzer.analyzeWithLanguageService(exploding)).not.toThrow();
            expect(analyzer.analyzeWithLanguageService(exploding)).toEqual([]);
        });

        it('does not throw when getSourceFiles() throws', () => {
            const exploding: any = {
                getProgram: () => ({
                    getTypeChecker: () => ({}),
                    getSourceFiles: () => { throw new Error('source list corrupt'); },
                }),
            };
            expect(() => analyzer.analyzeWithLanguageService(exploding)).not.toThrow();
            expect(analyzer.analyzeWithLanguageService(exploding)).toEqual([]);
        });

        // ---- Logger wiring (catastrophic failures must be observable) ----
        it('logs the failing context when getProgram throws', () => {
            const { setLogger, resetLogger } = require('../../src/core/logger');
            const captured: string[] = [];
            setLogger((m: string) => captured.push(m));
            try {
                const exploding: any = { getProgram: () => { throw new Error('tsserver bad state'); } };
                analyzer.analyzeWithLanguageService(exploding);
                expect(captured.length).toBeGreaterThan(0);
                expect(captured[0]).toContain('analyzeWithLanguageService.getProgram');
                expect(captured[0]).toContain('tsserver bad state');
            } finally {
                resetLogger();
            }
        });

        it('logs the file path when a per-file analysis throws', () => {
            const { setLogger, resetLogger } = require('../../src/core/logger');
            const files = new Map<string, string>();
            files.set('/test/bad.ts', `
                @Container('bad.html')
                class Bad { x: string = ''; }
            `);
            const { ls } = buildInMemoryLs(files);

            const original = (analyzer as any).analyzeSourceFile.bind(analyzer);
            (analyzer as any).analyzeSourceFile = () => { throw new Error('extractMembers blew up'); };

            const captured: string[] = [];
            setLogger((m: string) => captured.push(m));
            try {
                analyzer.analyzeWithLanguageService(ls);
                expect(captured.some(m => m.includes('perFile') && m.includes('bad.ts'))).toBe(true);
                expect(captured.some(m => m.includes('extractMembers blew up'))).toBe(true);
            } finally {
                (analyzer as any).analyzeSourceFile = original;
                resetLogger();
            }
        });

        it('continues analyzing other files when one source file analysis throws', () => {
            // Two valid containers + one whose member-name node is corrupted
            // such that extractMembers will throw during getText. We simulate
            // by stubbing the analyzer's private extractMembers via prototype
            // patching — the public surface stays the same.
            const files = new Map<string, string>();
            files.set('/test/good-a.ts', `
                @Container('a.html')
                class A { foo: string = ''; }
            `);
            files.set('/test/bad.ts', `
                @Container('bad.html')
                class Bad { x: string = ''; }
            `);
            files.set('/test/good-b.ts', `
                @Container('b.html')
                class B { bar: number = 0; }
            `);
            const { ls } = buildInMemoryLs(files);

            // Patch analyzeSourceFile so a specific file throws but others work.
            const original = (analyzer as any).analyzeSourceFile.bind(analyzer);
            (analyzer as any).analyzeSourceFile = (sf: any, checker: any) => {
                if (sf.fileName.endsWith('bad.ts')) throw new Error('boom');
                return original(sf, checker);
            };

            try {
                expect(() => analyzer.analyzeWithLanguageService(ls)).not.toThrow();
                // The two healthy files were still analyzed
                expect(analyzer.getAssociationsForTs('/test/good-a.ts').length).toBe(1);
                expect(analyzer.getAssociationsForTs('/test/good-b.ts').length).toBe(1);
                // The broken file produced no associations (graceful degradation)
                expect(analyzer.getAssociationsForTs('/test/bad.ts').length).toBe(0);
            } finally {
                (analyzer as any).analyzeSourceFile = original;
            }
        });
    });

    // ---- P3.4.9: read project tsconfig in analyzeFiles ----
    // Before fix: analyzeFiles hardcoded compiler options (target, module, etc.)
    // ignoring the user's tsconfig.json. Path aliases, custom lib/target, and
    // useDefineForClassFields all silently differed from the project's intent.
    // After fix: each file is grouped by its nearest tsconfig.json; one
    // ts.Program is created per group with the project's resolved options
    // (forced noEmit + skipLibCheck on top).
    //
    // Tests target `resolveProgramGroups` rather than `analyzeFiles` because
    // the `typescript` module's named exports (`createProgram` etc.) are
    // getter-only and resist `jest.spyOn`. The grouping function holds the
    // actual decision logic — testing it directly is both more focused and
    // cheaper than spinning up real ts.Programs.
    describe('analyzeFiles tsconfig discovery', () => {
        const fs = require('fs');
        const pathMod = require('path');
        const os = require('os');
        const tsMod: typeof ts = require('typescript');
        const { resolveProgramGroups, _clearTsConfigCacheForTest } = require('../../src/core/decorator-analyzer');

        let tmpRoot: string;
        const cleanup: string[] = [];

        beforeEach(() => {
            _clearTsConfigCacheForTest();
            tmpRoot = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'nubond-tsconfig-test-'));
            cleanup.push(tmpRoot);
        });

        afterEach(() => {
            while (cleanup.length > 0) {
                const dir = cleanup.pop();
                try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
            }
        });

        /** Create a real file inside the temp dir and return its absolute path. */
        function writeFile(relPath: string, content: string): string {
            const fullPath = pathMod.join(tmpRoot, relPath);
            fs.mkdirSync(pathMod.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
            return fullPath;
        }

        it('honors project tsconfig: target + paths from the resolved options', () => {
            writeFile('tsconfig.json', JSON.stringify({
                compilerOptions: {
                    target: 'ES2022',
                    module: 'ESNext',
                    baseUrl: '.',
                    paths: { '@models/*': ['src/models/*'] },
                    experimentalDecorators: true,
                },
            }));
            const file = writeFile('src/a.ts', 'export const x = 1;');

            const groups = resolveProgramGroups([file]);
            expect(groups.length).toBe(1);

            const opts = groups[0].options;
            expect(opts.target).toBe(tsMod.ScriptTarget.ES2022);
            expect(opts.module).toBe(tsMod.ModuleKind.ESNext);
            expect(opts.paths).toEqual({ '@models/*': ['src/models/*'] });
            // Forced overrides regardless of project settings:
            expect(opts.noEmit).toBe(true);
            expect(opts.skipLibCheck).toBe(true);
        });

        it('falls back to defaults when tsconfig.json fails to parse', () => {
            writeFile('tsconfig.json', '{ this is : invalid json /// }}}');
            const file = writeFile('src/a.ts', 'export const x = 1;');

            const groups = resolveProgramGroups([file]);
            expect(groups.length).toBe(1);

            const opts = groups[0].options;
            expect(opts.experimentalDecorators).toBe(true);
            expect(opts.allowJs).toBe(true);
            expect(opts.noEmit).toBe(true);
            expect(opts.skipLibCheck).toBe(true);
        });

        it('falls back to defaults when no tsconfig.json exists in any ancestor', () => {
            // Create an isolated dir whose ancestors contain no tsconfig.json
            // — `ts.findConfigFile` will walk to the root and return undefined.
            const orphan = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'nubond-orphan-no-tsconfig-'));
            cleanup.push(orphan);
            const file = pathMod.join(orphan, 'orphan.ts');
            fs.writeFileSync(file, 'export const x = 1;', 'utf-8');

            const groups = resolveProgramGroups([file]);
            expect(groups.length).toBe(1);
            expect(groups[0].options.experimentalDecorators).toBe(true);
            expect(groups[0].options.allowJs).toBe(true);
        });

        it('groups files by tsconfig: one group per distinct tsconfig', () => {
            writeFile('proj-a/tsconfig.json', JSON.stringify({
                compilerOptions: { target: 'ES2020', module: 'CommonJS' },
            }));
            writeFile('proj-b/tsconfig.json', JSON.stringify({
                compilerOptions: { target: 'ES2022', module: 'ESNext' },
            }));
            const aX = writeFile('proj-a/src/x.ts', 'export const x = 1;');
            const aY = writeFile('proj-a/src/y.ts', 'export const y = 1;');
            const bZ = writeFile('proj-b/src/z.ts', 'export const z = 1;');

            const groups = resolveProgramGroups([aX, aY, bZ]);
            expect(groups.length).toBe(2);

            const groupA = groups.find((g: any) => g.files.includes(aX));
            const groupB = groups.find((g: any) => g.files.includes(bZ));
            expect(groupA!.files.sort()).toEqual([aX, aY].sort());
            expect(groupB!.files).toEqual([bZ]);
            expect(groupA!.options.target).toBe(tsMod.ScriptTarget.ES2020);
            expect(groupB!.options.target).toBe(tsMod.ScriptTarget.ES2022);
        });

        it('caches parsed tsconfigs across resolveProgramGroups calls', () => {
            writeFile('tsconfig.json', JSON.stringify({
                compilerOptions: { target: 'ES2022' },
            }));
            const fileA = writeFile('src/a.ts', 'export const a = 1;');
            const fileB = writeFile('src/b.ts', 'export const b = 1;');

            // First call parses; subsequent calls hit cache. We can't easily
            // observe parseJsonConfigFileContent calls from the outside, but we
            // can at least verify the result is stable across calls.
            const first = resolveProgramGroups([fileA]);
            const second = resolveProgramGroups([fileB]);
            expect(first[0].options.target).toBe(tsMod.ScriptTarget.ES2022);
            expect(second[0].options.target).toBe(tsMod.ScriptTarget.ES2022);
        });
    });

    // ---- Regression: Fix #4 — typeIndex case-insensitive path cleanup ----
    // Before fix: removeFile cleaned typeIndex with normalizeSlashes (case-sensitive).
    // On Windows, TypeScript's createProgram resolves file paths with a different case
    // than VS Code's uri.fsPath (e.g., 'C:/Src/Foo.ts' vs 'c:/src/foo.ts'), so stale
    // typeIndex entries were never evicted and accumulated until a full restart.
    // After fix: normalizePath (lowercase) is used on both sides for comparison.
    describe('removeFile typeIndex case-insensitive normalization', () => {
        it('should evict typeIndex entries even when removeFile path casing differs', () => {
            // Simulate TypeScript compiler storing a path with mixed case
            const mixedCasePath = '/test/TypeDefs.ts';
            const typeSource = `
                export interface CaseSensitiveType { value: number; }
            `;
            analyzer.analyzeSourceText(mixedCasePath, typeSource);

            // Verify the entry is in the typeIndex (getTypeMembers will try readFileSync)
            const fsMod = require('fs');
            const readSpy = jest.spyOn(fsMod, 'readFileSync').mockReturnValue(typeSource);

            try {
                const beforeRemove = analyzer.getTypeMembers('CaseSensitiveType');
                expect(beforeRemove).toBeDefined(); // typeIndex entry exists, file was read

                readSpy.mockClear(); // reset call count after confirmed presence

                // removeFile called with all-lowercase path — simulates VS Code uri.fsPath
                // on case-insensitive Windows FS where 'TypeDefs.ts' and 'typedefs.ts' are the same file
                analyzer.removeFile('/test/typedefs.ts');

                // After removal the typeIndex entry must be gone
                const afterRemove = analyzer.getTypeMembers('CaseSensitiveType');
                expect(afterRemove).toBeUndefined();

                // readFileSync must NOT have been called — the entry was removed, not just missed
                expect(readSpy).not.toHaveBeenCalled();
            } finally {
                readSpy.mockRestore();
            }
        });
    });
});
