import type { ToolExecutionContext } from '@mastra/core/tools';

export async function askYesNo(
  mcp: NonNullable<ToolExecutionContext['mcp']>,
  message: string,
  key: string,
): Promise<boolean> {
  const result = await askMultipleYesNo(mcp, message, { [key]: 'Yes' });
  return result[key] ?? false;
}

// Presents several independent yes/no options in a single elicitation form (e.g. "GitHub
// workflow" and "Husky pre-commit hook" as two checkboxes in one prompt) rather than two
// separate round-trips. `fields` maps each result key to its checkbox title.
export async function askMultipleYesNo(
  mcp: NonNullable<ToolExecutionContext['mcp']>,
  message: string,
  fields: Record<string, string>,
): Promise<Record<string, boolean>> {
  const keys = Object.keys(fields);
  try {
    const result = await mcp.elicitation.sendRequest({
      message,
      requestedSchema: {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, { type: 'boolean', title: fields[key] }])),
        required: keys,
      },
    });
    if (result.action !== 'accept') {
      return Object.fromEntries(keys.map((key) => [key, false]));
    }
    return Object.fromEntries(keys.map((key) => [key, result.content?.[key] === true]));
  } catch {
    // Client doesn't support elicitation (or declined the capability) -- treat as "no"
    // rather than failing the whole tool call.
    return Object.fromEntries(keys.map((key) => [key, false]));
  }
}
