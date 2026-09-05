export class Constants {
    public static readonly DISPLAY_NAME = 'nuBond';
    public static readonly INTERNAL_NAME = 'nubond';

    /**
     * Package name of the bundled TypeScript server plugin. Must match
     * `contributes.typescriptServerPlugins[0].name` in package.json — that is
     * the name VS Code resolves from the extension's node_modules, and the
     * name `configurePlugin` addresses. Scoped so it cannot collide with (or
     * shadow) any package published on the public npm registry.
     */
    public static readonly TS_PLUGIN_NAME = '@nubond/ts-plugin';
}
