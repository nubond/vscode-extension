/**
 * packaging.spec.ts
 * Guards the shape of the published VSIX.
 *
 * The extension was once removed from the Visual Studio Marketplace for
 * "suspicious activity". No specifics were given, but the packaging had two
 * properties that automated supply-chain scanners flag:
 *
 *   1. It shipped `node_modules/ts-plugin/package.json` — an unscoped name
 *      that shadows a real published npm package, at a HIGHER version than
 *      the real one (1.0.0 vs 0.1.5), with no tarball or integrity hash, and
 *      a `main` of `../../dist/ts-plugin/index.js` that path-traversed out of
 *      its own package directory. That combination is the textbook signature
 *      of a dependency-confusion payload.
 *   2. `dist/extension.js` was a ~3.8 MB minified blob with the whole
 *      TypeScript compiler inlined, so scanners saw dynamic `require(var)`
 *      and `process.env[var]` reads that mapped back to nothing readable.
 *
 * Both are fixed. These tests exist so neither can quietly return.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Constants } from '../src/constants';

const extensionRoot = path.resolve(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const buildConfig = require('../esbuild.js');

const contributedPluginName: string = pkg.contributes.typescriptServerPlugins[0].name;

describe('packaging — TS server plugin identity', () => {
    it('contributes exactly one TS server plugin', () => {
        expect(pkg.contributes.typescriptServerPlugins).toHaveLength(1);
    });

    it('uses a scoped plugin name so it cannot shadow a public npm package', () => {
        expect(contributedPluginName.startsWith('@')).toBe(true);
        expect(contributedPluginName).toContain('/');
        expect(contributedPluginName).toBe('@nubond/ts-plugin');
    });

    it('never reuses the unscoped `ts-plugin` name that triggered the takedown', () => {
        expect(contributedPluginName).not.toBe('ts-plugin');
        expect(buildConfig.TS_PLUGIN_NAME).not.toBe('ts-plugin');
        expect(buildConfig.createShimManifest().name).not.toBe('ts-plugin');
    });

    it('keeps package.json, the build and the runtime constant on one name', () => {
        // configurePlugin() addresses the plugin by this name at runtime; if
        // these three drift apart the dirty-HTML bridge silently no-ops.
        expect(buildConfig.TS_PLUGIN_NAME).toBe(contributedPluginName);
        expect(Constants.TS_PLUGIN_NAME).toBe(contributedPluginName);
        expect(buildConfig.createShimManifest().name).toBe(contributedPluginName);
    });
});

describe('packaging — shim manifest', () => {
    const manifest = buildConfig.createShimManifest();

    it('resolves `main` inside its own package directory', () => {
        expect(manifest.main).toBe('./index.js');
        expect(manifest.main).not.toContain('..');
    });

    it('emits the plugin bundle into the package directory it declares', () => {
        // outfile must sit next to the manifest, otherwise `main` has to
        // traverse out again to find it.
        expect(path.dirname(buildConfig.tsPluginBuildOptions.outfile))
            .toBe(buildConfig.shimDir);
        expect(path.basename(buildConfig.tsPluginBuildOptions.outfile))
            .toBe(manifest.main.replace('./', ''));
    });

    it('tracks the extension version rather than claiming a made-up one', () => {
        // A hand-written version that outranks the shadowed package is half
        // of what made the old shim look like an attack.
        expect(manifest.version).toBe(pkg.version);
    });

    it('is marked private so it can never be mistaken for a registry package', () => {
        expect(manifest.private).toBe(true);
    });

    it('places the shim directory under the scope it declares', () => {
        const relative = path.relative(extensionRoot, buildConfig.shimDir).split(path.sep).join('/');
        expect(relative).toBe(`node_modules/${contributedPluginName}`);
    });
});

describe('packaging — build output is reviewable', () => {
    const builds = [
        ['extension', buildConfig.extensionBuildOptions],
        ['ts-plugin', buildConfig.tsPluginBuildOptions],
    ] as const;

    it.each(builds)('%s bundle is not minified', (_name, options) => {
        expect(options.minify).toBe(false);
    });

    it.each(builds)('%s bundle always emits source maps', (_name, options) => {
        expect(options.sourcemap).toBe(true);
    });

    it.each(builds)('%s bundle keeps typescript external', (_name, options) => {
        // Inlining the compiler is what produced the opaque blob.
        expect(options.external).toContain('typescript');
    });

    it('keeps vscode external in the extension bundle', () => {
        expect(buildConfig.extensionBuildOptions.external).toContain('vscode');
    });

    it('declares typescript as a real runtime dependency', () => {
        // It is external at build time, so it has to ship as an actual,
        // integrity-verifiable package instead of being absent at runtime.
        expect(pkg.dependencies.typescript).toBeDefined();
    });
});

describe('packaging — .vscodeignore', () => {
    const vscodeignore = fs
        .readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

    it('excludes node_modules by default', () => {
        expect(vscodeignore).toContain('node_modules/**');
    });

    it('ships the scoped plugin package', () => {
        const include = `!node_modules/${contributedPluginName}/**`;
        expect(vscodeignore).toContain(include);
        // Negations only take effect after the broad exclusion.
        expect(vscodeignore.indexOf(include))
            .toBeGreaterThan(vscodeignore.indexOf('node_modules/**'));
    });

    it('ships the real typescript package', () => {
        expect(vscodeignore).toContain('!node_modules/typescript/**');
        expect(vscodeignore.indexOf('!node_modules/typescript/**'))
            .toBeGreaterThan(vscodeignore.indexOf('node_modules/**'));
    });

    it('never re-includes the legacy unscoped shim', () => {
        expect(vscodeignore).not.toContain('!node_modules/ts-plugin/**');
    });

    it('does not strip source maps from the package', () => {
        expect(vscodeignore).not.toContain('**/*.map');
    });
});

describe('packaging — tooling stays out of the VSIX', () => {
    const vscodeignore = fs
        .readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

    it('excludes every root-level .js tooling file', () => {
        // `eslint.config.js` shipped by accident once, purely because adding a
        // tool at the repo root does not automatically exclude it. Anything
        // new landing here has to be listed too.
        const rootJsFiles = fs
            .readdirSync(extensionRoot)
            .filter(name => name.endsWith('.js'));

        expect(rootJsFiles).toContain('esbuild.js');
        for (const name of rootJsFiles) {
            expect(vscodeignore).toContain(name);
        }
    });

    it('excludes the TypeScript project config', () => {
        expect(vscodeignore).toContain('tsconfig.json');
    });

    it('excludes sources and tests', () => {
        expect(vscodeignore).toContain('src/**');
        expect(vscodeignore).toContain('tests/**');
    });
});
