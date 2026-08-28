// Resolves which directory a workflow/tool should operate against.
//
// process.cwd() only happens to be correct when this MCP server is spawned by
// Claude Code from within the target project. Claude Code's own docs recommend
// against relying on cwd and instead set CLAUDE_PROJECT_DIR in the subprocess
// env. Other hosts (Mastra Studio's `mastra dev`, Claude Desktop) don't set cwd
// to the target project at all, so an explicit projectDir input takes priority
// when provided (e.g. filled in via Studio's tool form).
export function resolveProjectDir(projectDir) {
    return projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
