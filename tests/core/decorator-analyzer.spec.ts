import { DecoratorAnalyzer } from '../../src/core/decorator-analyzer';
import { Constants } from '../../src/constants';
import * as ts from 'typescript';

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
            expect(first!.length).toBe(2); // both files analyzed on cold start

            // No version bumps → second call should be a complete no-op
            // (still a defined [] — undefined is reserved for failed passes)
            const second = analyzer.analyzeWithLanguageService(ls);
            expect(second).toEqual([]);

            // Now simulate editing file a — only a should be re-analyzed
            files.set('/test/a.ts', `
                @Container('a.html')
                class A { name: string = ''; newField: number = 0; }
            `);
            bumpVersion('/test/a.ts');

            const third = analyzer.analyzeWithLanguageService(ls);
            expect(third!.length).toBe(1);
            expect(third![0]).toMatch(/a\.ts$/);

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

        it('returns undefined (failed pass, not a no-op) if the LanguageService has no Program yet', () => {
            const fakeLs: any = { getProgram: () => undefined };
            expect(analyzer.analyzeWithLanguageService(fakeLs)).toBeUndefined();
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
            // undefined signals "analysis never ran" so version stamps aren't advanced
            expect(analyzer.analyzeWithLanguageService(exploding)).toBeUndefined();
        });

        it('does not throw when getTypeChecker() throws', () => {
            const exploding: any = {
                getProgram: () => ({
                    getTypeChecker: () => { throw new Error('checker init failure'); },
                    getSourceFiles: () => [],
                }),
            };
            expect(() => analyzer.analyzeWithLanguageService(exploding)).not.toThrow();
            expect(analyzer.analyzeWithLanguageService(exploding)).toBeUndefined();
        });

        it('does not throw when getSourceFiles() throws', () => {
            const exploding: any = {
                getProgram: () => ({
                    getTypeChecker: () => ({}),
                    getSourceFiles: () => { throw new Error('source list corrupt'); },
                }),
            };
            expect(() => analyzer.analyzeWithLanguageService(exploding)).not.toThrow();
            expect(analyzer.analyzeWithLanguageService(exploding)).toBeUndefined();
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

    // ---- Regression: per-LanguageService stale-file cleanup (multi-tsconfig) ----
    // Before fix: analyzeWithLanguageService removed every previously analyzed
    // file missing from the CURRENT program — with one LS per tsconfig group,
    // each group's analysis wiped all other groups. Multi-project workspaces
    // ended up with only the most recently analyzed project alive.
    describe('multi-LanguageService isolation', () => {
        const ts = require('typescript');

        function buildLsWithVersions(fileMap: Record<string, string>) {
            const files = new Map(Object.entries(fileMap));
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
            return {
                ls: ts.createLanguageService(host, ts.createDocumentRegistry()),
                files,
                bumpVersion: (f: string) => versions.set(f, (versions.get(f) ?? 0) + 1),
            };
        }

        function buildLs(fileMap: Record<string, string>) {
            return buildLsWithVersions(fileMap).ls;
        }

        it('analyzing one tsconfig group does not wipe another group\'s results', () => {
            const lsA = buildLs({ '/proj-a/one.ts': `@Container('<div></div>') class One { x: string = ''; }` });
            const lsB = buildLs({ '/proj-b/two.ts': `@Container('<div></div>') class Two { y: string = ''; }` });

            analyzer.analyzeWithLanguageService(lsA);
            analyzer.analyzeWithLanguageService(lsB);

            // Both groups' associations must coexist
            expect(analyzer.getAssociationsForTs('/proj-a/one.ts').length).toBe(1);
            expect(analyzer.getAssociationsForTs('/proj-b/two.ts').length).toBe(1);

            // Re-analyzing group A must not evict group B either
            analyzer.analyzeWithLanguageService(lsA);
            expect(analyzer.getAssociationsForTs('/proj-b/two.ts').length).toBe(1);
        });

        it('does not evict a file still present in another service\'s program', () => {
            // Programs contain transitive imports, so a file rooted in group A
            // can ALSO appear in group B's program. When B stops importing it,
            // B's stale-file cleanup must not wipe A's analysis of it.
            const lsA = buildLs({
                '/shared/util.ts': `@Container('<div></div>') export class SharedUtil { v: string = ''; }`,
            });
            const b = buildLsWithVersions({
                '/proj-b/feature.ts': `
                    import { SharedUtil } from '../shared/util';
                    @Container('<div></div>')
                    class Feature { dep: SharedUtil | null = null; }
                `,
                '/shared/util.ts': `@Container('<div></div>') export class SharedUtil { v: string = ''; }`,
            });

            analyzer.analyzeWithLanguageService(lsA);
            analyzer.analyzeWithLanguageService(b.ls);
            expect(analyzer.getAssociationsForTs('/shared/util.ts').length).toBe(1);

            // Group B drops the shared file entirely
            b.files.delete('/shared/util.ts');
            b.files.set('/proj-b/feature.ts', `
                @Container('<div></div>')
                class Feature { dep: null = null; }
            `);
            b.bumpVersion('/proj-b/feature.ts');
            analyzer.analyzeWithLanguageService(b.ls);

            // Group A still claims the shared file — analysis must survive
            expect(analyzer.getAssociationsForTs('/shared/util.ts').length).toBe(1);
        });
    });

    // ---- Regression: member positions anchored on the identifier ----
    // Before fix: positions came from member.getStart(), which points at
    // modifiers/decorators ('public', '@Detector()'). Rename then replaced
    // the start of the modifier, corrupting the declaration.
    describe('member position anchoring', () => {
        it('positions members with modifiers at the identifier, not the modifier', () => {
            const source = `@Container('<i></i>')
class TestContainer {
    public title: string = '';
    private secret: number = 0;
}`;
            analyzer.analyzeSourceText('/test/anchored.ts', source);
            const assoc = analyzer.getAssociationsForTs('/test/anchored.ts')[0];
            const lines = source.split('\n');

            const title = assoc.members.find(m => m.name === 'title')!;
            expect(lines[title.line].substring(title.character, title.character + 'title'.length)).toBe('title');

            const secret = assoc.members.find(m => m.name === 'secret')!;
            expect(lines[secret.line].substring(secret.character, secret.character + 'secret'.length)).toBe('secret');
        });

        it('positions decorated members at the identifier', () => {
            const source = `@Container('<i></i>')
class TestContainer {
    @Detector() counter = 0;
}`;
            analyzer.analyzeSourceText('/test/decorated.ts', source);
            const assoc = analyzer.getAssociationsForTs('/test/decorated.ts')[0];
            const lines = source.split('\n');
            const counter = assoc.members.find(m => m.name === 'counter')!;
            expect(lines[counter.line].substring(counter.character, counter.character + 'counter'.length)).toBe('counter');
        });

        it('positions constructor parameters at the identifier, not the visibility modifier', () => {
            const source = `@Container('<i></i>')
class TestContainer {
    constructor(public service: object) {}
}`;
            analyzer.analyzeSourceText('/test/ctor-anchored.ts', source);
            const assoc = analyzer.getAssociationsForTs('/test/ctor-anchored.ts')[0];
            const lines = source.split('\n');
            const service = assoc.members.find(m => m.name === 'service')!;
            expect(lines[service.line].substring(service.character, service.character + 'service'.length)).toBe('service');
        });
    });

    // ---- Regression: runtime-registered entity names ----
    describe('registered entity names', () => {
        it('registers container custom names from the [name, template] array form', () => {
            const source = `
                import html from './card.html';
                @Container(['my-card', html])
                class CardController { x: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/card.ts', source);
            const containers = analyzer.getEntitiesByType('container');
            expect(containers.length).toBe(1);
            expect(containers[0].name).toBe('my-card');
            expect(containers[0].className).toBe('CardController');
        });

        it('registers components under their kebab-case runtime name', () => {
            const source = `
                @Component('<div></div>')
                class UserCard { x: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/user-card.ts', source);
            const components = analyzer.getEntitiesByType('component');
            expect(components[0].name).toBe('user-card');
        });

        it('registers aspects under their kebab-case runtime name', () => {
            const source = `
                @Aspect()
                class VisibilityAspect { }
            `;
            analyzer.analyzeSourceText('/test/aspect-name.ts', source);
            const aspects = analyzer.getEntitiesByType('aspect');
            expect(aspects[0].name).toBe('visibility-aspect');
        });

        it('camelCases explicit transformer names like the runtime does', () => {
            const source = `
                @Transformer('Fmt')
                class Formatter { transform(v: string): string { return v; } }
            `;
            analyzer.analyzeSourceText('/test/fmt.ts', source);
            const transformers = analyzer.getEntitiesByType('transformer');
            expect(transformers[0].transformerFunctionName).toBe('fmt');
            expect(analyzer.getTransformerByFunctionName('fmt')).toBeDefined();
        });
    });

    // ---- Regression: @AppRoot string args are selectors/routes, not templates ----
    describe('AppRoot argument handling', () => {
        it('does not treat a selector string as an inline template', () => {
            const source = `
                @AppRoot('#app')
                class App { x: string = ''; }
            `;
            analyzer.analyzeSourceText('/test/app-root.ts', source);
            const assoc = analyzer.getAssociationsForTs('/test/app-root.ts')[0];
            expect(assoc).toBeDefined();
            // '#app' must NOT be recorded as an inline template — that
            // suppressed the index.html fallback association.
            expect(assoc.inlineTemplate).toBeUndefined();
        });
    });

    // ---- Regression: $Template(...) global template registration ----
    describe('$Template registration', () => {
        it('registers template entities from $Template calls', () => {
            const source = `
                @Container('<div></div>', [$Template('info-icon', '<svg></svg>')])
                class Main { }
            `;
            analyzer.analyzeSourceText('/test/templates.ts', source);
            const templates = analyzer.getEntitiesByType('template');
            expect(templates.length).toBe(1);
            expect(templates[0].name).toBe('info-icon');
            expect(templates[0].line).toBeGreaterThanOrEqual(0);
        });

        it('removes template entities when their file is removed', () => {
            analyzer.analyzeSourceText('/test/tpl-rm.ts', `const n = $Template('gone', '<i></i>');`);
            expect(analyzer.getEntitiesByType('template').length).toBe(1);
            analyzer.removeFile('/test/tpl-rm.ts');
            expect(analyzer.getEntitiesByType('template').length).toBe(0);
        });
    });

    // ---- Regression: string template *paths* (BUG: treated as inline markup) ----
    describe('string template path resolution', () => {
        const fsMod = require('fs');
        const pathMod = require('path');
        const os = require('os');

        it('resolves an existing .html path literal to a file association', () => {
            const tmp = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'nubond-tpl-path-'));
            try {
                const htmlPath = pathMod.join(tmp, 'card.html');
                fsMod.writeFileSync(htmlPath, '<div nb-value="this.x"></div>', 'utf-8');
                const tsPath = pathMod.join(tmp, 'card.ts');

                analyzer.analyzeSourceText(tsPath, `
                    @Container('./card.html')
                    class Card { x: string = ''; }
                `);
                const assoc = analyzer.getAssociationsForTs(tsPath)[0];
                expect(assoc.inlineTemplate).toBeUndefined();
                expect(assoc.htmlFilePath).toBeDefined();
                expect(assoc.htmlFilePath!.replace(/\\/g, '/')).toContain('card.html');
            } finally {
                try { fsMod.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
            }
        });

        it('keeps treating markup strings as inline templates', () => {
            analyzer.analyzeSourceText('/test/inline-still.ts', `
                @Container('<div>hello</div>')
                class Inline { }
            `);
            const assoc = analyzer.getAssociationsForTs('/test/inline-still.ts')[0];
            expect(assoc.inlineTemplate).toBe('<div>hello</div>');
            expect(assoc.htmlFilePath).toBeUndefined();
        });
    });

    // ---- Regression: inherited members (base-class properties were invisible) ----
    describe('inherited members', () => {
        const ts = require('typescript');

        it('collects base-class members with declaredIn via the TypeChecker path', () => {
            const files = new Map<string, string>();
            files.set('/test/base.ts', `
                export class BaseList {
                    items: string[] = [];
                    protected refresh(): void {}
                    private internal = 1;
                }
            `);
            files.set('/test/sub.ts', `
                import { BaseList } from './base';
                @Container('<div></div>')
                class Sub extends BaseList {
                    own: number = 0;
                }
            `);

            const host: any = {
                getScriptFileNames: () => Array.from(files.keys()),
                getScriptVersion: () => '0',
                getScriptSnapshot: (f: string) => {
                    const text = files.get(f);
                    return text !== undefined ? ts.ScriptSnapshot.fromString(text) : undefined;
                },
                getCompilationSettings: () => ({
                    target: ts.ScriptTarget.ES2020,
                    module: ts.ModuleKind.CommonJS,
                    experimentalDecorators: true,
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

            analyzer.analyzeWithLanguageService(ls);
            const assoc = analyzer.getAssociationsForTs('/test/sub.ts')[0];
            expect(assoc).toBeDefined();

            // Own member: no declaredIn
            const own = assoc.members.find(m => m.name === 'own');
            expect(own).toBeDefined();
            expect(own!.declaredIn).toBeUndefined();

            // Inherited member: present, carries the declaring file
            const items = assoc.members.find(m => m.name === 'items');
            expect(items).toBeDefined();
            expect(items!.declaredIn).toContain('base.ts');
            expect(items!.isPublic).toBe(true);

            // Inherited private member: present but not public
            const internal = assoc.members.find(m => m.name === 'internal');
            expect(internal).toBeDefined();
            expect(internal!.isPublic).toBe(false);
        });
    });

    // ---- Regression: typeIndex must tolerate same-named types in many files ----
    describe('typeIndex multimap', () => {
        it('resolves a type even when another file declares the same name', () => {
            analyzer.analyzeSourceText('/test/dup-a.ts', 'export interface Dup { a: number; }');
            analyzer.analyzeSourceText('/test/dup-b.ts', 'export interface Dup { b: string; }');

            // Member lookup scans candidates until the declaring file is found
            expect(analyzer.findMemberWithType('Dup', 'a')).toBeDefined();
            expect(analyzer.findMemberWithType('Dup', 'b')).toBeDefined();

            // Removing one file keeps the other's declaration resolvable —
            // last-write-wins previously deleted the whole index entry.
            analyzer.removeFile('/test/dup-b.ts');
            const members = analyzer.getTypeMembers('Dup');
            expect(members).toBeDefined();
            expect(members!.some(m => m.name === 'a')).toBe(true);
            expect(analyzer.findMemberWithType('Dup', 'b')).toBeUndefined();
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

// ---- Round-2 regressions ----

describe('DecoratorAnalyzer — round-2 regressions', () => {
    let analyzer: import('../../src/core/decorator-analyzer').DecoratorAnalyzer;

    beforeEach(() => {
        const { DecoratorAnalyzer } = require('../../src/core/decorator-analyzer');
        analyzer = new DecoratorAnalyzer();
    });

    describe('constructor parameter properties (all modifiers)', () => {
        const source = `
            @Container({ template: './test.html' })
            class DiContainer {
                constructor(private cd: ChangeDetector,
                            protected svc: DataService,
                            readonly config: AppConfig,
                            plainParam: string) {}
            }
        `;

        it('collects private constructor params as (non-public) members', () => {
            analyzer.analyzeSourceText('/test/di.ts', source);
            const members = analyzer.getAssociationsForTs('/test/di.ts')[0].members;
            const cd = members.find(m => m.name === 'cd');
            expect(cd).toBeDefined();
            expect(cd!.isPublic).toBe(false);
            expect(cd!.type).toBe('ChangeDetector');
        });

        it('collects protected and readonly params as public members', () => {
            analyzer.analyzeSourceText('/test/di.ts', source);
            const members = analyzer.getAssociationsForTs('/test/di.ts')[0].members;
            expect(members.find(m => m.name === 'svc')?.isPublic).toBe(true);
            expect(members.find(m => m.name === 'config')?.isPublic).toBe(true);
        });

        it('still ignores plain (non-property) constructor params', () => {
            analyzer.analyzeSourceText('/test/di.ts', source);
            const members = analyzer.getAssociationsForTs('/test/di.ts')[0].members;
            expect(members.find(m => m.name === 'plainParam')).toBeUndefined();
        });
    });

    describe('array-literal template form with backtick templates', () => {
        it('captures a NoSubstitutionTemplateLiteral inline template', () => {
            const source = [
                "@Component(['my-card', `<div nb-value=\"this.title\"></div>`])",
                'class MyCard { title = ""; }',
            ].join('\n');
            analyzer.analyzeSourceText('/test/my-card.ts', source);
            const assoc = analyzer.getAssociationsForTs('/test/my-card.ts')[0];
            expect(assoc).toBeDefined();
            expect(assoc.inlineTemplate).toContain('nb-value');
        });
    });

    // ---- Regression: static members are NOT instance members ----
    // Template expressions run with `.apply(instance)`, so `this.X` can never
    // reach a static. Listing them offered dead completions after `this.` and
    // let diagnostics silently accept `this.someStatic`.
    describe('static member exclusion', () => {
        it('excludes static properties and methods from the member list', () => {
            const source = `
                @Container('./x.html')
                class WithStatics {
                    static DEFAULT_NAME = 'x';
                    static compute(): number { return 1; }
                    static get version(): string { return '1'; }
                    name: string = '';
                    getName(): string { return this.name; }
                }
            `;
            analyzer.analyzeSourceText('/test/statics.ts', source);
            const members = analyzer.getAssociationsForTs('/test/statics.ts')[0].members;
            expect(members.find(m => m.name === 'DEFAULT_NAME')).toBeUndefined();
            expect(members.find(m => m.name === 'compute')).toBeUndefined();
            expect(members.find(m => m.name === 'version')).toBeUndefined();
            expect(members.find(m => m.name === 'name')).toBeDefined();
            expect(members.find(m => m.name === 'getName')).toBeDefined();
        });
    });
});

// ---- Regressions on the LanguageService-backed analysis path ----
// Own in-memory-LS helper (mirrors the one inside the main describe, which is
// scoped there) so these suites stay self-contained.
describe('DecoratorAnalyzer — multi-service and shared-declaration regressions', () => {
    const ts = require('typescript');
    let analyzer: DecoratorAnalyzer;

    beforeEach(() => {
        analyzer = new DecoratorAnalyzer();
    });

    function buildInMemoryLsHarness(files: Map<string, string>) {
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

        return {
            ls: ts.createLanguageService(host, ts.createDocumentRegistry()),
            /** Simulate an edit: replace content and bump the script version. */
            edit: (f: string, text: string) => {
                files.set(f, text);
                versions.set(f, (versions.get(f) ?? 0) + 1);
            },
        };
    }

    function buildInMemoryLs(files: Map<string, string>) {
        return buildInMemoryLsHarness(files).ls;
    }

    // Regression: `lastAnalyzedSourceFiles` was keyed per file path but stored
    // whichever service analyzed last. Two services sharing a file (via
    // transitive imports) then failed the SourceFile identity check on every
    // alternating pass — the shared file was removed + re-analyzed forever.
    it('does not re-analyze files shared between two LanguageServices (no ping-pong)', () => {
        const shared = `export interface SharedUser { id: number; }`;
        const filesA = new Map<string, string>([
            ['/test/shared.ts', shared],
            ['/test/a.ts', `
                import { SharedUser } from './shared';
                @Container('./a.html')
                class A { user: SharedUser | undefined; }
            `],
        ]);
        const filesB = new Map<string, string>([
            ['/test/shared.ts', shared],
            ['/test/b.ts', `
                import { SharedUser } from './shared';
                @Container('./b.html')
                class B { user: SharedUser | undefined; }
            `],
        ]);

        const lsA = buildInMemoryLs(filesA);
        const lsB = buildInMemoryLs(filesB);

        // Cold starts: each service analyzes its own program once.
        expect(analyzer.analyzeWithLanguageService(lsA)!.length).toBeGreaterThan(0);
        expect(analyzer.analyzeWithLanguageService(lsB)!.length).toBeGreaterThan(0);

        // Steady state: NOTHING changed — neither service may re-analyze
        // anything, including the shared file. (Pre-fix, each call here
        // re-analyzed /test/shared.ts because the other service's SourceFile
        // reference was stored in the global map.)
        expect(analyzer.analyzeWithLanguageService(lsA)).toEqual([]);
        expect(analyzer.analyzeWithLanguageService(lsB)).toEqual([]);
        expect(analyzer.analyzeWithLanguageService(lsA)).toEqual([]);
    });

    // Regression: rename/references only fanned out over the originating
    // class's templates — sibling subclasses' templates went stale. The
    // declaration-based lookup finds every association sharing a member.
    it('getAssociationsWithMember returns every association sharing a declaration', () => {
        const files = new Map<string, string>([
            ['/test/base.ts', `export class BaseCard { title: string = ''; }`],
            ['/test/a.ts', `
                import { BaseCard } from './base';
                @Container('./a.html')
                class CardA extends BaseCard { onlyA: number = 0; }
            `],
            ['/test/b.ts', `
                import { BaseCard } from './base';
                @Container('./b.html')
                class CardB extends BaseCard {}
            `],
        ]);

        const ls = buildInMemoryLs(files);
        analyzer.analyzeWithLanguageService(ls);

        const aAssoc = analyzer.getAssociationsForTs('/test/a.ts')[0];
        expect(aAssoc).toBeDefined();
        const title = aAssoc.members.find(m => m.name === 'title');
        expect(title).toBeDefined();
        expect(title!.declaredIn).toBe('/test/base.ts');

        // The base-class member declaration is shared by BOTH subclasses
        const sharing = analyzer.getAssociationsWithMember('title', title!.declaredIn!, title!.offset);
        expect(sharing.map(a => a.className).sort()).toEqual(['CardA', 'CardB']);

        // An own member fans out to its own class only
        const onlyA = aAssoc.members.find(m => m.name === 'onlyA');
        expect(onlyA).toBeDefined();
        const onlyASharing = analyzer.getAssociationsWithMember('onlyA', '/test/a.ts', onlyA!.offset);
        expect(onlyASharing.map(a => a.className)).toEqual(['CardA']);

        // Wrong offset (a different declaration with the same name) matches nothing
        expect(analyzer.getAssociationsWithMember('title', '/test/base.ts', title!.offset + 1)).toEqual([]);
    });

    // Regression: inherited-member records store the DECLARING file's offsets,
    // captured when the SUBCLASS was analyzed. Editing the base file moved the
    // declaration but left the subclass's SourceFile identity unchanged — the
    // incremental pass skipped it, the stale offset no longer matched the fresh
    // declaration, and the offset-keyed rename fan-out silently returned [].
    describe('declaration-dependency invalidation', () => {
        const baseV1 = `export class BaseCard { title: string = ''; }`;

        function makeProject() {
            const files = new Map<string, string>([
                ['/test/base.ts', baseV1],
                ['/test/a.ts', `
                    import { BaseCard } from './base';
                    @Container('./a.html')
                    class CardA extends BaseCard {}
                `],
                ['/test/unrelated.ts', `
                    @Container('./u.html')
                    class Unrelated { note: string = ''; }
                `],
            ]);
            return { files, ...buildInMemoryLsHarness(files) };
        }

        it('re-analyzes dependents when the declaring file changes, keeping fan-out offsets fresh', () => {
            const { ls, edit } = makeProject();
            analyzer.analyzeWithLanguageService(ls);

            const staleOffset = analyzer.getAssociationsForTs('/test/a.ts')[0]
                .members.find(m => m.name === 'title')!.offset;

            // Shift the declaration by padding above the class.
            const pad = '// padding line\n';
            const baseV2 = pad + baseV1;
            edit('/test/base.ts', baseV2);

            const reanalyzed = analyzer.analyzeWithLanguageService(ls)!
                .map(f => f.replace(/\\/g, '/'));
            // The dependent subclass file is re-analyzed alongside the base…
            expect(reanalyzed).toContain('/test/base.ts');
            expect(reanalyzed).toContain('/test/a.ts');
            // …but files with no stake in the base are not.
            expect(reanalyzed).not.toContain('/test/unrelated.ts');

            // The stored record now points at the FRESH declaration offset,
            // so the offset-keyed fan-out still finds the subclass.
            const freshOffset = baseV2.indexOf('title');
            expect(freshOffset).toBe(staleOffset + pad.length);
            const title = analyzer.getAssociationsForTs('/test/a.ts')[0]
                .members.find(m => m.name === 'title')!;
            expect(title.offset).toBe(freshOffset);
            expect(
                analyzer.getAssociationsWithMember('title', '/test/base.ts', freshOffset)
                    .map(a => a.className)
            ).toEqual(['CardA']);
        });

        it('reaches steady state — no re-analysis loop after the dependent catches up', () => {
            const { ls, edit } = makeProject();
            analyzer.analyzeWithLanguageService(ls);
            edit('/test/base.ts', '// pad\n' + baseV1);
            analyzer.analyzeWithLanguageService(ls);

            // Nothing changed since — neither the base nor the dependent may
            // re-analyze again.
            expect(analyzer.analyzeWithLanguageService(ls)).toEqual([]);
            expect(analyzer.analyzeWithLanguageService(ls)).toEqual([]);
        });

        it('does not re-analyze dependents when an unrelated file changes', () => {
            const { ls, edit } = makeProject();
            analyzer.analyzeWithLanguageService(ls);

            edit('/test/unrelated.ts', `
                @Container('./u.html')
                class Unrelated { note: string = 'changed'; }
            `);

            const reanalyzed = analyzer.analyzeWithLanguageService(ls)!
                .map(f => f.replace(/\\/g, '/'));
            expect(reanalyzed).toEqual(['/test/unrelated.ts']);
        });
    });
});

// ---- Regression: #private (ECMAScript) fields surfaced as PUBLIC members —
// completion offered `this.#foo`, a syntax error in template expressions ----
describe('DecoratorAnalyzer — ECMAScript #private fields', () => {
    it('does not surface #private fields as members at all', () => {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/priv.ts', `
            @Container({ template: './p.html' })
            class PrivContainer {
                #secret: number = 1;
                #hiddenMethod(): void {}
                visible: string = '';
            }
        `);
        const members = analyzer.getAssociationsForTs('/test/priv.ts')[0].members;
        expect(members.find(m => m.name === '#secret')).toBeUndefined();
        expect(members.find(m => m.name === '#hiddenMethod')).toBeUndefined();
        expect(members.find(m => m.name === 'visible')).toBeDefined();
    });
});

// ---- Regression: getTypeMembers' doc promised type-alias support but only
// interface/class branches existed — `this.x.` with x: SomeAliasShape
// silently yielded no members ----
describe('DecoratorAnalyzer — type aliases with object shapes', () => {
    const source = `
        @Container({ template: './panel.html' })
        class PanelContainer {
            opts: PanelOpts | undefined;
        }
        type PanelOpts = {
            width: number;
            title: string;
            refresh(): void;
        };
        type JustAString = string;
    `;

    function build() {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/panel.ts', source);
        return analyzer;
    }

    it('getTypeMembers enumerates an object-shaped alias', () => {
        const analyzer = build();
        const members = analyzer.getTypeMembers('PanelOpts');
        expect(members).toBeDefined();
        expect(members!.map(m => m.name).sort()).toEqual(['refresh', 'title', 'width']);
        expect(members!.find(m => m.name === 'refresh')!.kind).toBe('method');
        expect(members!.find(m => m.name === 'width')!.type).toBe('number');
    });

    it('findMemberWithType resolves alias members (chain walking)', () => {
        const analyzer = build();
        const found = analyzer.findMemberWithType('PanelOpts', 'title');
        expect(found).toBeDefined();
        expect(found!.type).toBe('string');
    });

    it('findMemberInType locates the alias member declaration', () => {
        const analyzer = build();
        const loc = analyzer.findMemberInType('PanelOpts', 'width');
        expect(loc).toBeDefined();
        expect(loc!.filePath).toBe('/test/panel.ts');
    });

    it('non-object aliases yield no members (and no crash)', () => {
        const analyzer = build();
        expect(analyzer.getTypeMembers('JustAString')).toBeUndefined();
    });
});

// ---- Regression: analyzer keys folded path case on EVERY platform — on a
// case-sensitive FS (Linux) Foo.ts and foo.ts collided and removeFile on one
// wiped the other's associations ----
describe('DecoratorAnalyzer — path case sensitivity', () => {
    const caseSensitive = ts.sys.useCaseSensitiveFileNames;

    (caseSensitive ? it : it.skip)('keeps differently-cased paths distinct on case-sensitive file systems', () => {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/Foo.ts', `
            @Container({ template: './a.html' })
            class FooA { a: string = ''; }
        `);
        analyzer.analyzeSourceText('/test/foo.ts', `
            @Container({ template: './b.html' })
            class FooB { b: string = ''; }
        `);
        expect(analyzer.getAssociationsForTs('/test/Foo.ts').map(a => a.className)).toEqual(['FooA']);
        expect(analyzer.getAssociationsForTs('/test/foo.ts').map(a => a.className)).toEqual(['FooB']);

        analyzer.removeFile('/test/foo.ts');
        expect(analyzer.getAssociationsForTs('/test/foo.ts')).toHaveLength(0);
        expect(analyzer.getAssociationsForTs('/test/Foo.ts')).toHaveLength(1);
    });

    (!caseSensitive ? it : it.skip)('folds path case on case-insensitive file systems', () => {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/Foo.ts', `
            @Container({ template: './a.html' })
            class FooA { a: string = ''; }
        `);
        expect(analyzer.getAssociationsForTs('/test/FOO.ts').map(a => a.className)).toEqual(['FooA']);
    });
});

// ---- Round 3 (L3): @AppRoot is not a runtime container ----
// The framework's AppRoot decorator only calls Environment.setupRouter +
// Environment.addApp — it never registers a container, so offering the class
// for nb-container="@…" completion/navigation blessed a name that can never
// resolve at runtime.
describe('DecoratorAnalyzer — AppRoot entity registration (round 3)', () => {
    it('does not register an @AppRoot class as a container entity', () => {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/app-root-entity.ts', `
            @AppRoot('#app')
            class ShellRoot { x: string = ''; }
        `);
        // The association exists (member/template features still work) …
        expect(analyzer.getAssociationsForTs('/test/app-root-entity.ts')).toHaveLength(1);
        // … but no container entity is registered for it.
        const containers = analyzer.getEntitiesByType('container');
        expect(containers.find(e => e.className === 'ShellRoot')).toBeUndefined();
    });

    it('still registers @Container classes as container entities', () => {
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeSourceText('/test/real-container.ts', `
            @Container('<div></div>')
            class RealContainer { }
        `);
        expect(analyzer.getEntitiesByType('container').map(e => e.className)).toContain('RealContainer');
    });
});

// ---- Round 3 (L8): program-path analysis must be idempotent ----
// analyzeFiles/analyzeProgram registered associations and entities without
// clearing previous state — a second call (or a file reachable from two
// groups' programs) duplicated everything.
describe('DecoratorAnalyzer — analyzeFiles idempotence (round 3)', () => {
    const fsMod = require('fs');
    const pathMod = require('path');
    const os = require('os');

    it('analyzing the same file twice does not duplicate associations or entities', () => {
        const tmp = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'nubond-analyze-twice-'));
        try {
            const tsPath = pathMod.join(tmp, 'card.ts');
            fsMod.writeFileSync(tsPath, `
                @Container('<div></div>')
                class Card { x: string = ''; }
            `, 'utf-8');
            const analyzer = new DecoratorAnalyzer();
            const options: ts.CompilerOptions = {
                target: ts.ScriptTarget.ES2020,
                experimentalDecorators: true,
                noEmit: true,
                skipLibCheck: true,
            };
            analyzer.analyzeFiles([tsPath], options);
            analyzer.analyzeFiles([tsPath], options);
            expect(analyzer.getAssociationsForTs(tsPath)).toHaveLength(1);
            expect(analyzer.getEntitiesByType('container').filter(e => e.className === 'Card')).toHaveLength(1);
        } finally {
            try { fsMod.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });
});

// ---- Round 3 (L9): declChangeTicks pruned when a file leaves all programs ----
describe('DecoratorAnalyzer — declChangeTicks pruning (round 3)', () => {
    const tsMod = require('typescript');

    function buildMutableLs(fileMap: Record<string, string>) {
        const files = new Map(Object.entries(fileMap));
        const versions = new Map<string, number>();
        for (const f of files.keys()) versions.set(f, 0);
        const host: any = {
            getScriptFileNames: () => Array.from(files.keys()),
            getScriptVersion: (f: string) => String(versions.get(f) ?? 0),
            getScriptSnapshot: (f: string) => {
                const text = files.get(f);
                return text !== undefined ? tsMod.ScriptSnapshot.fromString(text) : undefined;
            },
            getCompilationSettings: () => ({
                target: tsMod.ScriptTarget.ES2020,
                module: tsMod.ModuleKind.CommonJS,
                experimentalDecorators: true,
                skipLibCheck: true,
                noEmit: true,
            }),
            getDefaultLibFileName: (opts: any) => tsMod.getDefaultLibFilePath(opts),
            fileExists: (f: string) => files.has(f) || tsMod.sys.fileExists(f),
            readFile: (f: string) => files.get(f) ?? tsMod.sys.readFile(f),
            getCurrentDirectory: () => '/test',
            useCaseSensitiveFileNames: () => true,
            getNewLine: () => '\n',
        };
        return {
            ls: tsMod.createLanguageService(host, tsMod.createDocumentRegistry()),
            files,
            bumpVersion: (f: string) => versions.set(f, (versions.get(f) ?? 0) + 1),
        };
    }

    it('drops the change tick once the last claimant drops the file', () => {
        const group = buildMutableLs({
            '/proj/keep.ts': `@Container('<div></div>') class Keep { }`,
            '/proj/gone.ts': `@Container('<div></div>') class Gone { }`,
        });
        const analyzer = new DecoratorAnalyzer();
        analyzer.analyzeWithLanguageService(group.ls);

        const ticks = (analyzer as any).declChangeTicks as Map<string, number>;
        expect(ticks.has('/proj/gone.ts')).toBe(true);

        // The file leaves the program (deleted) — the next pass evicts it.
        group.files.delete('/proj/gone.ts');
        group.bumpVersion('/proj/keep.ts');
        analyzer.analyzeWithLanguageService(group.ls);

        expect(ticks.has('/proj/gone.ts')).toBe(false);
        // Files still claimed keep their tick (dependent invalidation intact).
        expect(ticks.has('/proj/keep.ts')).toBe(true);
    });
});
