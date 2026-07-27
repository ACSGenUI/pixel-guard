import { PNG } from 'pngjs';
import { diffScreenshots } from './screenshot-diff.js';

// Left-align crop a PNG buffer to a narrower width (keeps full height).
function cropWidth(buffer, width) {
  const src = PNG.sync.read(buffer);
  if (src.width === width) return buffer;
  const dst = new PNG({ width, height: src.height });
  PNG.bitblt(src, dst, 0, 0, width, src.height, 0, 0);
  return PNG.sync.write(dst);
}

// Compares a migrated block crop against its saved live baseline. Widths are
// normalized to the common min (diffScreenshots throws on width mismatch); differing
// heights are handled by diffScreenshots itself and surfaced as heightMismatch.
export function compareBlockCrops(baselineBuffer, migratedBuffer, config) {
  const baseline = PNG.sync.read(baselineBuffer);
  const migrated = PNG.sync.read(migratedBuffer);
  const widthDelta = Math.abs(baseline.width - migrated.width);
  const commonWidth = Math.min(baseline.width, migrated.width);

  const {
    diffPngBuffer, regions, pageLengthMismatch,
  } = diffScreenshots(cropWidth(baselineBuffer, commonWidth), cropWidth(migratedBuffer, commonWidth), config);

  const diffPixelCount = regions.reduce((sum, r) => sum + r.diffPixelCount, 0);
  return {
    pass: regions.length === 0,
    diffPixelCount,
    widthDelta,
    heightMismatch: pageLengthMismatch,
    diffPngBuffer,
  };
}
