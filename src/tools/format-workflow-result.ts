export interface WorkflowStepSummary {
  label: string;
  success: boolean;
  message: string;
}

export function formatWorkflowResult(title: string, steps: WorkflowStepSummary[]): string {
  const overallSuccess = steps.every((step) => step.success);
  const lines = steps.map((step) => `${step.success ? '✅' : '❌'} **${step.label}** — ${step.message}`);
  return [
    `## ${title}`,
    '',
    `**Overall: ${overallSuccess ? '✅ Success' : '❌ Failed'}**`,
    '',
    ...lines,
  ].join('\n');
}

export function appendErrorOutput(summary: string, errorOutput: string | null): string {
  return errorOutput ? `${summary}\n\n### Error output\n\n\`\`\`\n${errorOutput}\n\`\`\`` : summary;
}
