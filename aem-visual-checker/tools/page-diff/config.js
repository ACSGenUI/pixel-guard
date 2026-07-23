// aem-visual-checker/tools/page-diff/config.js
// Self-contained viewport list: page-diff installs independently of the block-testing
// suite, so it cannot import from tools/visual-tests/ (that directory is absent in a
// page-diff-only target project). These four viewports mirror the values in
// tools/visual-tests/config.js's VIEWPORTS -- keep them in sync if that list changes.
export const VIEWPORTS = [
  { label: 'Mobile', width: 320, height: 568 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Desktop', width: 1024, height: 768 },
  { label: 'Large', width: 1440, height: 900 },
];

export const THRESHOLDS = {
  cellSize: 16,
  cellDiffThreshold: 4,
  minClusterAreaPx: 300,
  cropPadding: 24,
  heightMismatchTolerancePx: 50,
  pixelmatchThreshold: 0.1,
  ignoreOverlapRatio: 0.5,
};
