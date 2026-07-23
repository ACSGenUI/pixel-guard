import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReportHtml } from './report-html.js';

const RUN_SUMMARY = {
  runId: '2026-07-21T10-00-00-000Z',
  createdAt: '2026-07-21T10:00:00.000Z',
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
          crops: { live: 'home/desktop/region-0-live.png', migrated: 'home/desktop/region-0-migrated.png', diff: 'home/desktop/region-0-diff.png' },
        },
        {
          index: 1, x: 500, y: 500, width: 20, height: 20, diffPixelCount: 30,
          status: 'ignored', matchedRule: { selector: '.promo' }, elements: null,
          crops: { live: 'home/desktop/region-1-live.png', migrated: 'home/desktop/region-1-migrated.png', diff: 'home/desktop/region-1-diff.png' },
        },
      ],
    }],
  }],
};

test('generateReportHtml includes the pair, viewport, region crops, and ignored-rule marker', () => {
  const html = generateReportHtml(RUN_SUMMARY);

  assert.match(html, /home/);
  assert.match(html, /https:\/\/live\.example\.com\//);
  assert.match(html, /Desktop/);
  assert.match(html, /home\/desktop\/region-0-live\.png/);
  assert.match(html, /home\/desktop\/region-0-migrated\.png/);
  assert.match(html, /home\/desktop\/region-0-diff\.png/);
  assert.match(html, /ignored/i);
  assert.match(html, /\.promo/);
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
