import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const echoTool = createTool({
  id: 'echo',
  description: 'Echoes back the provided message.',
  inputSchema: z.object({
    message: z.string().describe('The message to echo back'),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  execute: async (inputData) => {
    return { message: inputData.message };
  },
});
