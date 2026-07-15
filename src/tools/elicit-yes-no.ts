import type { ToolExecutionContext } from '@mastra/core/tools';

export async function askYesNo(
  mcp: NonNullable<ToolExecutionContext['mcp']>,
  message: string,
  key: string,
): Promise<boolean> {
  try {
    const result = await mcp.elicitation.sendRequest({
      message,
      requestedSchema: {
        type: 'object',
        properties: { [key]: { type: 'boolean', title: 'Yes' } },
        required: [key],
      },
    });
    return result.action === 'accept' && result.content?.[key] === true;
  } catch {
    // Client doesn't support elicitation (or declined the capability) -- treat as "no"
    // rather than failing the whole tool call.
    return false;
  }
}
