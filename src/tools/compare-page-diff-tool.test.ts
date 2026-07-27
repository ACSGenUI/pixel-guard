import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary } from './compare-page-diff-tool.js';

const base = {
  pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
  viewports: [{ viewportLabel: 'Desktop', status: 'fail', errorMessage: null, pageLengthMismatch: null, regions: [] }],
};

test('renders a ranked Blocks affected section grouped by kind when blockSummary is present', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      ...base,
      blockSummary: [
        {
          kind: 'block', name: 'carousel-testimonial', selector: 's',
          regionCount: 9, totalDiffPx: 1712285, coverage: 0.61,
          viewportsAffected: ['Desktop', 'Large', 'Tablet'], severityScore: 0.61,
          worstViewport: 'Large', worstCrop: 'x-diff.png',
        },
        {
          kind: 'landmark', name: 'nav', selector: 's2',
          regionCount: 2, totalDiffPx: 6904, coverage: 0.05,
          viewportsAffected: ['Large'], severityScore: 0.05,
          worstViewport: 'Large', worstCrop: null,
        },
      ],
    }],
  } as any;
  const text = formatSummary(summary);
  assert.match(text, /Blocks affected \(ranked\)/);
  assert.match(text, /Blocks:/);
  assert.match(text, /Landmarks:/);
  assert.match(text, /Block "carousel-testimonial" — coverage 61%, 3 viewports \[Desktop, Large, Tablet\], 9 regions, 1,712,285 px/);
  assert.match(text, /Landmark "nav" — coverage 5%, 1 viewport \[Large\], 2 regions, 6,904 px/);
});

test('omits the Blocks affected section when blockSummary is absent', () => {
  const summary = { runId: 'r', createdAt: 'c', pairs: [{ ...base }] } as any;
  assert.doesNotMatch(formatSummary(summary), /Blocks affected/);
});
