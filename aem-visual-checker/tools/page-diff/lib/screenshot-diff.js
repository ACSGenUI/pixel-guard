import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { clusterDiffRegions } from './region-clustering.js';

function topRows(png, rows) {
  return png.data.subarray(0, png.width * rows * 4);
}

export function diffScreenshots(livePngBuffer, migratedPngBuffer, config) {
  const live = PNG.sync.read(livePngBuffer);
  const migrated = PNG.sync.read(migratedPngBuffer);

  if (live.width !== migrated.width) {
    throw new Error(`Cannot diff screenshots of different widths (live ${live.width}px vs migrated ${migrated.width}px). Both sides must use the same viewport width.`);
  }

  const { width } = live;
  const overlapHeight = Math.min(live.height, migrated.height);
  const deltaPx = Math.abs(live.height - migrated.height);
  const pageLengthMismatch = deltaPx > config.heightMismatchTolerancePx
    ? { liveHeight: live.height, migratedHeight: migrated.height, deltaPx }
    : null;

  const liveData = topRows(live, overlapHeight);
  const migratedData = topRows(migrated, overlapHeight);

  const maskOutput = new PNG({ width, height: overlapHeight });
  pixelmatch(liveData, migratedData, maskOutput.data, width, overlapHeight, {
    threshold: config.pixelmatchThreshold, diffMask: true,
  });
  const diffMask = new Uint8Array(width * overlapHeight);
  for (let i = 0; i < diffMask.length; i += 1) {
    diffMask[i] = maskOutput.data[i * 4 + 3] > 0 ? 1 : 0;
  }

  const visualDiff = new PNG({ width, height: overlapHeight });
  pixelmatch(liveData, migratedData, visualDiff.data, width, overlapHeight, {
    threshold: config.pixelmatchThreshold,
  });

  const regions = clusterDiffRegions(diffMask, width, overlapHeight, config);

  return {
    diffPngBuffer: PNG.sync.write(visualDiff),
    width,
    height: overlapHeight,
    regions,
    pageLengthMismatch,
  };
}
