import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PlaywrightTestOutcome {
  title: string;
  passed: boolean;
  errorMessage: string | null;
  diffImagePaths: string[];
}

interface RawAttachment {
  name: string;
  contentType: string;
  path?: string;
}

interface RawTestResult {
  status: string;
  errors?: Array<{ message?: string }>;
  attachments?: RawAttachment[];
}

interface RawTest {
  results?: RawTestResult[];
}

interface RawSpec {
  title: string;
  ok: boolean;
  tests?: RawTest[];
}

interface RawSuite {
  specs?: RawSpec[];
  suites?: RawSuite[];
}

interface RawReport {
  suites?: RawSuite[];
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Playwright's JSON reporter nests suites recursively (one level per test.describe() block
// and per spec file), so specs have to be collected via a recursive walk rather than a
// flat suites[0].specs access -- verified empirically against a describe()-wrapped spec.
function collectSpecs(suite: RawSuite, specs: RawSpec[]): void {
  for (const spec of suite.specs ?? []) {
    specs.push(spec);
  }
  for (const child of suite.suites ?? []) {
    collectSpecs(child, specs);
  }
}

// Reads the JSON report Playwright writes alongside the HTML report (see
// aem-visual-checker/tools/visual-tests/playwright.config.ts) for a precise, structured
// per-test breakdown -- title, pass/fail, clean error message, and the exact diff-image
// paths attached to that specific test's result. Returns null when the file doesn't exist
// (e.g. a project installed before the JSON reporter was added; re-run aemVisualTestInstall
// to pick it up), so callers can fall back to a coarser summary.
export async function parsePlaywrightResults(targetDir: string): Promise<PlaywrightTestOutcome[] | null> {
  const resultsPath = join(targetDir, 'tools', 'visual-tests', 'test-results', 'results.json');
  let raw: RawReport;
  try {
    raw = JSON.parse(await readFile(resultsPath, 'utf8'));
  } catch {
    return null;
  }

  const specs: RawSpec[] = [];
  for (const suite of raw.suites ?? []) {
    collectSpecs(suite, specs);
  }

  return specs.map((spec) => {
    const result = spec.tests?.[0]?.results?.at(-1);
    const errorMessage = (result?.errors ?? [])
      .map((error) => error.message ?? '')
      .filter(Boolean)
      .join('\n')
      .replace(ANSI_PATTERN, '') || null;
    const diffImagePaths = (result?.attachments ?? [])
      .filter((attachment): attachment is RawAttachment & { path: string } => Boolean(attachment.path) && attachment.name.endsWith('-diff.png'))
      .map((attachment) => attachment.path);

    return {
      title: spec.title,
      passed: spec.ok,
      errorMessage,
      diffImagePaths,
    };
  });
}
