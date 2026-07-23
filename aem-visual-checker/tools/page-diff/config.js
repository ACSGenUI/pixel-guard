// aem-visual-checker/tools/page-diff/config.js
import { VIEWPORTS as RAW_VIEWPORTS } from '../visual-tests/config.js';

export const VIEWPORTS = RAW_VIEWPORTS.map((viewport) => ({
  label: viewport.label,
  width: parseInt(viewport.width, 10),
  height: parseInt(viewport.height, 10),
}));

export const THRESHOLDS = {
  cellSize: 16,
  cellDiffThreshold: 4,
  minClusterAreaPx: 300,
  cropPadding: 24,
  heightMismatchTolerancePx: 50,
  pixelmatchThreshold: 0.1,
  ignoreOverlapRatio: 0.5,
};
