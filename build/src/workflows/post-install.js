import { chmod, cp, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePackageJson } from './update-project-config.js';
const POST_INSTALL_SOURCE_DIR = fileURLToPath(new URL('../../aem-visual-checker/post-install', import.meta.url));
export async function installGithubWorkflow(targetDir) {
    const workflowsDir = join(targetDir, '.github', 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await cp(join(POST_INSTALL_SOURCE_DIR, 'visual-tests.yaml'), join(workflowsDir, 'visual-tests.yaml'), { force: true });
}
export async function installHuskyHook(targetDir) {
    const huskyDir = join(targetDir, '.husky');
    await cp(join(POST_INSTALL_SOURCE_DIR, '.husky'), huskyDir, {
        recursive: true,
        force: true,
        filter: (source) => basename(source) !== '.DS_Store',
    });
    // fs.cp doesn't reliably preserve the executable bit across platforms; git silently skips
    // a non-executable hook, so make sure both shell scripts stay executable after copying.
    await chmod(join(huskyDir, 'pre-commit'), 0o755);
    await chmod(join(huskyDir, '_', 'husky.sh'), 0o755);
    await mergePackageJson(targetDir, {
        scripts: { prepare: 'husky install' },
        dependencies: {},
        devDependencies: {},
    });
}
