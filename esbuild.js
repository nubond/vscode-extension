const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');

// Single source of truth for the TS server plugin's package name: whatever
// VS Code is told to load via `contributes.typescriptServerPlugins`. The shim
// package emitted into node_modules must resolve under exactly that name, and
// the scope keeps it from ever shadowing a package on the public npm registry.
const TS_PLUGIN_NAME = pkg.contributes.typescriptServerPlugins[0].name;

// The plugin package lives under node_modules, outside dist.
const shimDir = path.join(__dirname, 'node_modules', ...TS_PLUGIN_NAME.split('/'));

// Earlier builds emitted an unscoped `ts-plugin` package here whose `main`
// pointed outside its own directory. That shadowed a real npm package and
// looked like a dependency-confusion payload, so every build now deletes it —
// a stale copy must never be packaged into the VSIX again.
const legacyShimDir = path.join(__dirname, 'node_modules', 'ts-plugin');

/**
 * package.json for the bundled plugin. `main` stays package-local: no `..`
 * segment may appear in it, or the loader escapes node_modules.
 */
function createShimManifest() {
    return {
        name: TS_PLUGIN_NAME,
        version: pkg.version,
        description: 'TypeScript server plugin bundled with the nuBond Language Service extension.',
        main: './index.js',
        license: pkg.license,
        private: true,
    };
}

// Main extension. `vscode` is provided by the extension host. `typescript` is
// marked external and ships as its real, unmodified node_modules dependency
// rather than being inlined, so the packaged artifact stays reviewable instead
// of collapsing into one opaque multi-megabyte blob. Nothing is minified and
// source maps are always emitted, so shipped code maps back to this repo.
const extensionBuildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode', 'typescript'],
    format: 'cjs',
    platform: 'node',
    sourcemap: true,
    minify: false,
    target: 'es2020',
};

// TS Language Service Plugin: typescript is external (provided by the TS
// server). Emitted directly INTO its own package directory so `main` resolves
// package-locally.
const tsPluginBuildOptions = {
    entryPoints: ['src/ts-plugin/index.ts'],
    bundle: true,
    outfile: path.join(shimDir, 'index.js'),
    external: ['typescript'],
    format: 'cjs',
    platform: 'node',
    sourcemap: true,
    minify: false,
    target: 'es2020',
};

async function build({ production = false } = {}) {
    if (fs.existsSync('dist')) {
        fs.rmSync('dist', { recursive: true });
    }
    fs.rmSync(shimDir, { recursive: true, force: true });
    fs.rmSync(legacyShimDir, { recursive: true, force: true });

    await esbuild.build(extensionBuildOptions);

    fs.mkdirSync(shimDir, { recursive: true });
    await esbuild.build(tsPluginBuildOptions);
    fs.writeFileSync(
        path.join(shimDir, 'package.json'),
        JSON.stringify(createShimManifest(), null, 2) + '\n'
    );

    console.log(`Build complete${production ? ' (production)' : ''}.`);
}

module.exports = {
    TS_PLUGIN_NAME,
    shimDir,
    legacyShimDir,
    createShimManifest,
    extensionBuildOptions,
    tsPluginBuildOptions,
    build,
};

if (require.main === module) {
    build({ production: process.argv.includes('--production') }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
