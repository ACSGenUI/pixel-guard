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

// Playwright writes its HTML report on every run, whether tests pass or fail. Given its own
// dedicated line (rather than embedded inside a step message) so it doesn't get lost among
// the other step bullets -- it's useful regardless of overall pass/fail.
export function withReportLine(summary: string, reportUrl: string | null): string {
  return reportUrl ? `${summary}\n\n**Playwright report:** ${reportUrl}` : summary;
}
