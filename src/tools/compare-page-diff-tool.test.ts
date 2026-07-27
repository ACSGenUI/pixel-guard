import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSummary } from './compare-page-diff-tool.js';

const base = {
  pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
  viewports: [{ viewportLabel: 'Desktop', status: 'fail', errorMessage: null, pageLengthMismatch: null, regions: [] }],
};

test('renders a top-to-bottom Blocks affected section (in listed order) when blockSummary is present', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      ...base,
      blockSummary: [
        {
          kind: 'landmark', name: 'nav', selector: 's2',
          regionCount: 2, totalDiffPx: 6904, coverage: 0.05,
          viewportsAffected: ['Large'], severityScore: 0.05, topY: 0,
          worstViewport: 'Large', worstCrop: null,
        },
        {
          kind: 'block', name: 'carousel-testimonial', selector: 's',
          regionCount: 9, totalDiffPx: 1712285, coverage: 0.61,
          viewportsAffected: ['Desktop', 'Large', 'Tablet'], severityScore: 0.61, topY: 1800,
          worstViewport: 'Large', worstCrop: 'x-diff.png',
        },
      ],
    }],
  } as any;
  const text = formatSummary(summary);
  assert.match(text, /Blocks affected \(top to bottom\)/);
  assert.match(text, /Landmark "nav" — coverage 5%, 1 viewport \[Large\], 2 regions, 6,904 px/);
  assert.match(text, /Block "carousel-testimonial" — coverage 61%, 3 viewports \[Desktop, Large, Tablet\], 9 regions, 1,712,285 px/);
  // header/nav first, then down the page
  assert.ok(text.indexOf('"nav"') < text.indexOf('"carousel-testimonial"'));
});

test('omits the Blocks affected section when blockSummary is absent', () => {
  const summary = { runId: 'r', createdAt: 'c', pairs: [{ ...base }] } as any;
  assert.doesNotMatch(formatSummary(summary), /Blocks affected/);
});

test('appends a next-steps directive steering to the report summary and block-fix tools when there are failures', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
      blockSummary: [{
        kind: 'block', name: 'hero-spotlight', selector: 's', regionCount: 2, totalDiffPx: 1000,
        coverage: 0.4, viewportsAffected: ['Desktop'], severityScore: 0.4, worstViewport: 'Desktop', worstCrop: null,
      }],
      viewports: [{ viewportLabel: 'Desktop', status: 'fail', errorMessage: null, pageLengthMismatch: null, regions: [] }],
    }],
  } as any;
  const text = formatSummary(summary);
  assert.match(text, /Next steps/);
  assert.match(text, /summary/i);
  assert.match(text, /captureLiveBlock/);
  assert.match(text, /compareBlock/);
});

test('omits the next-steps directive when everything passed', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
      viewports: [{ viewportLabel: 'Desktop', status: 'pass', errorMessage: null, pageLengthMismatch: null, regions: [] }],
    }],
  } as any;
  assert.doesNotMatch(formatSummary(summary), /Next steps/);
});
