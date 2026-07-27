import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReportHtml } from './report-html.js';

const RUN_SUMMARY = {
  runId: '2026-07-23T10-00-00-000Z',
  createdAt: '2026-07-23T10:00:00.000Z',
  pairs: [{
    pairSlug: 'home',
    liveUrl: 'https://live.example.com/',
    migratedUrl: 'https://migrated.example.com/',
    viewports: [{
      viewportLabel: 'Desktop',
      status: 'fail',
      errorMessage: null,
      pageLengthMismatch: null,
      regions: [
        {
          index: 0, x: 10, y: 10, width: 100, height: 50, diffPixelCount: 500,
          status: 'failed', matchedRule: null, elements: null,
          block: { name: 'hero', selector: 'main > div:nth-of-type(1) > div', kind: 'block', boundingBox: { x: 0, y: 0, width: 1200, height: 400 } },
          crops: { live: 'home/desktop/region-0-live.png', migrated: 'home/desktop/region-0-migrated.png', diff: 'home/desktop/region-0-diff.png' },
        },
        {
          index: 1, x: 20, y: 20, width: 30, height: 30, diffPixelCount: 120,
          status: 'failed', matchedRule: null, elements: null,
          block: { name: 'hero', selector: 'main > div:nth-of-type(1) > div', kind: 'block', boundingBox: { x: 0, y: 0, width: 1200, height: 400 } },
          crops: { live: 'home/desktop/region-1-live.png', migrated: 'home/desktop/region-1-migrated.png', diff: 'home/desktop/region-1-diff.png' },
        },
        {
          index: 2, x: 500, y: 900, width: 40, height: 40, diffPixelCount: 200,
          status: 'ignored', matchedRule: { selector: '.promo' }, elements: null,
          block: { name: 'columns', selector: 'main > div:nth-of-type(2) > div', kind: 'block', boundingBox: { x: 0, y: 800, width: 1200, height: 300 } },
          crops: { live: 'home/desktop/region-2-live.png', migrated: 'home/desktop/region-2-migrated.png', diff: 'home/desktop/region-2-diff.png' },
        },
        {
          index: 3, x: 700, y: 1500, width: 25, height: 25, diffPixelCount: 90,
          status: 'failed', matchedRule: null, elements: null,
          block: null,
          crops: { live: 'home/desktop/region-3-live.png', migrated: 'home/desktop/region-3-migrated.png', diff: 'home/desktop/region-3-diff.png' },
        },
      ],
    }],
  }],
};

test('generateReportHtml groups regions by their owning block and shows both crops of the hero group', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  // Block group headers.
  assert.match(html, /hero/);
  assert.match(html, /columns/);
  // Both hero regions' crops appear under the one hero group.
  assert.match(html, /home\/desktop\/region-0-diff\.png/);
  assert.match(html, /home\/desktop\/region-1-diff\.png/);
  // The two hero regions are grouped: "hero" appears once as a group header, not once per region.
  const heroHeaderMatches = html.match(/data-group-name="hero"/g) ?? [];
  assert.equal(heroHeaderMatches.length, 1);
});

test('generateReportHtml renders an ignored-only group as ignored and an Unattributed group for block-less regions', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  // columns group has only an ignored region -> group marked ignored.
  assert.match(html, /class="group[^"]*\bignored\b[^"]*"[^>]*data-group-name="columns"/);
  // Region 3 has no block -> Unattributed group present.
  assert.match(html, /Unattributed/);
  assert.match(html, /home\/desktop\/region-3-diff\.png/);
});

test('generateReportHtml nests location, breakpoint, block, and region as collapsible accordions with an expand/collapse control', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  assert.match(html, /<details class="pair"/);
  assert.match(html, /<details class="viewport/);
  assert.match(html, /<details class="group/);
  assert.match(html, /<details class="region/);
  // Expand/collapse-all control present.
  assert.match(html, /data-action="expand"/);
  assert.match(html, /data-action="collapse"/);
});

test('generateReportHtml escapes HTML-sensitive characters in URLs', () => {
  const withHtmlChars = {
    ...RUN_SUMMARY,
    pairs: [{ ...RUN_SUMMARY.pairs[0], liveUrl: 'https://live.example.com/?a=1&b=<2>' }],
  };

  const html = generateReportHtml(withHtmlChars);

  assert.doesNotMatch(html, /b=<2>/);
  assert.match(html, /b=&lt;2&gt;/);
});

test('renders a Block impact panel from pair.blockSummary, grouped by kind and escaped', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{
      pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/',
      blockSummary: [
        {
          kind: 'block', name: 'carousel-testimonial', selector: 's',
          regionCount: 9, totalDiffPx: 1712285, coverage: 0.61,
          viewportsAffected: ['Desktop', 'Large', 'Tablet'], severityScore: 0.61,
          worstViewport: 'Large', worstCrop: 'home/large/region-5-diff.png',
        },
        {
          kind: 'landmark', name: 'nav', selector: 's2',
          regionCount: 2, totalDiffPx: 6904, coverage: 0.05,
          viewportsAffected: ['Large'], severityScore: 0.05,
          worstViewport: 'Large', worstCrop: null,
        },
      ],
      viewports: [],
    }],
  };
  const html = generateReportHtml(summary);
  assert.match(html, /Block impact/);
  assert.match(html, /Blocks<\/h4>/);
  assert.match(html, /Landmarks<\/h4>/);
  assert.match(html, /carousel-testimonial/);
  assert.match(html, /61% coverage/);
  assert.match(html, /home\/large\/region-5-diff\.png/);
});

test('omits the Block impact panel when a pair has no blockSummary', () => {
  const summary = {
    runId: 'r', createdAt: 'c',
    pairs: [{ pairSlug: 'home', liveUrl: 'https://l/', migratedUrl: 'https://m/', viewports: [] }],
  };
  assert.doesNotMatch(generateReportHtml(summary), /Block impact/);
});
