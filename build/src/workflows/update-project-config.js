import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function mergePackageJson(targetDir, additions) {
    const packageJsonPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    pkg.scripts = { ...(pkg.scripts ?? {}), ...additions.scripts };
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...additions.dependencies };
    pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...additions.devDependencies };
    await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}
export async function appendMissingLines(filePath, lines) {
    let existingContent = '';
    try {
        existingContent = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    const existingLines = existingContent.split('\n');
    const missingLines = lines.filter((line) => !existingLines.includes(line));
    if (missingLines.length === 0) {
        return;
    }
    const trimmedContent = existingContent.replace(/\n+$/, '');
    const prefix = trimmedContent.length === 0 ? '' : `${trimmedContent}\n`;
    await writeFile(filePath, `${prefix}${missingLines.join('\n')}\n`, 'utf8');
}
const AEM_JS_IMPORT_PATTERN = /import\s*\{([\s\S]*?)\}\s*from\s*(['"])\.\/aem\.js\2/;
export async function addLoadScriptImport(scriptsJsPath) {
    const content = await readFile(scriptsJsPath, 'utf8');
    const match = content.match(AEM_JS_IMPORT_PATTERN);
    if (!match || match.index === undefined) {
        throw new Error(`Could not find an import from './aem.js' in ${scriptsJsPath}.`);
    }
    const importedNames = match[1]
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
    if (importedNames.includes('loadScript')) {
        return;
    }
    const isMultiline = match[1].includes('\n');
    let trimmedNames = match[1].replace(/\s+$/, '');
    if (!trimmedNames.endsWith(',')) {
        trimmedNames += ',';
    }
    const updatedNamesBlock = isMultiline ? `${trimmedNames}\n  loadScript,\n` : `${trimmedNames} loadScript `;
    const updatedImport = match[0].replace(match[1], updatedNamesBlock);
    const updated = content.slice(0, match.index) + updatedImport + content.slice(match.index + match[0].length);
    await writeFile(scriptsJsPath, updated, 'utf8');
}
const LOAD_EAGER_PATTERN = /function\s+loadEager\s*\([^)]*\)\s*\{/;
const SIDEKICK_LIBRARY_LOADER_MARKER = 'tools/visual-tests/visual-test.js';
const SIDEKICK_LIBRARY_LOADER_SNIPPET = [
    "  if (document.body.classList.contains('sidekick-library')) {",
    '    loadScript(`${window.hlx.codeBasePath}/tools/visual-tests/visual-test.js`);',
    "    loadScript(`${window.hlx.codeBasePath}/tools/visual-overlay/index.js`, { type: 'module' });",
    '  }',
].join('\n');
export async function addSidekickLibraryLoader(scriptsJsPath) {
    const content = await readFile(scriptsJsPath, 'utf8');
    if (content.includes(SIDEKICK_LIBRARY_LOADER_MARKER)) {
        return;
    }
    const match = content.match(LOAD_EAGER_PATTERN);
    if (!match || match.index === undefined) {
        throw new Error(`Could not find a loadEager() function in ${scriptsJsPath}.`);
    }
    let depth = 1;
    let index = match.index + match[0].length;
    while (depth > 0 && index < content.length) {
        if (content[index] === '{')
            depth += 1;
        else if (content[index] === '}')
            depth -= 1;
        index += 1;
    }
    if (depth !== 0) {
        throw new Error(`Could not find the closing brace of loadEager() in ${scriptsJsPath}.`);
    }
    const closingBraceIndex = index - 1;
    const updated = `${content.slice(0, closingBraceIndex)}${SIDEKICK_LIBRARY_LOADER_SNIPPET}\n${content.slice(closingBraceIndex)}`;
    await writeFile(scriptsJsPath, updated, 'utf8');
}
