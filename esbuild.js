const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');

async function build() {
    // Clean dist
    if (fs.existsSync('dist')) {
        fs.rmSync('dist', { recursive: true });
    }

    // Main extension: bundle typescript INTO the output (required at runtime)
    // vscode is external (provided by VS Code extension host)
    await esbuild.build({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        outfile: 'dist/extension.js',
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        sourcemap: !production,
        minify: production,
        target: 'es2020',
    });

    // TS Language Service Plugin: typescript is external (provided by TS server)
    // All other dependencies (decorator-analyzer, template-parser, etc.) are bundled in
    await esbuild.build({
        entryPoints: ['src/ts-plugin/index.ts'],
        bundle: true,
        outfile: 'dist/ts-plugin/index.js',
        external: ['typescript'],
        format: 'cjs',
        platform: 'node',
        sourcemap: !production,
        minify: production,
        target: 'es2020',
    });

    // Create the ts-plugin shim package in node_modules
    // VS Code's TS server resolves the plugin by name from the extension's node_modules
    const shimDir = path.join(__dirname, 'node_modules', 'ts-plugin');
    if (!fs.existsSync(shimDir)) {
        fs.mkdirSync(shimDir, { recursive: true });
    }
    fs.writeFileSync(path.join(shimDir, 'package.json'), JSON.stringify({
        name: 'ts-plugin',
        version: '1.0.0',
        main: '../../dist/ts-plugin/index.js'
    }, null, 2));

    console.log('Build complete.');
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
