const KIND_ORDER = { block: 0, landmark: 1, section: 2 };

// Aggregates a pair's failing, block-attributed regions into one ranked roll-up per block type.
// Grouping key is `kind:name`; coverage is the max across viewports of (sum diff px / block area),
// clamped to [0,1]. See docs/superpowers/specs/2026-07-27-page-diff-block-impact-rollup-design.md.
export function buildBlockSummary(viewports) {
  const groups = new Map();

  for (const viewport of viewports ?? []) {
    for (const region of viewport.regions ?? []) {
      if (region.status !== 'failed') continue;
      const block = region.block;
      if (!block) continue;

      const key = `${block.kind}:${block.name}`;
      if (!groups.has(key)) {
        groups.set(key, { kind: block.kind, name: block.name, perViewport: new Map() });
      }
      const group = groups.get(key);
      if (!group.perViewport.has(viewport.viewportLabel)) {
        const box = block.boundingBox;
        group.perViewport.set(viewport.viewportLabel, {
          diffPx: 0,
          area: box.width * box.height,
          selector: block.selector,
          regions: [],
        });
      }
      const pv = group.perViewport.get(viewport.viewportLabel);
      pv.diffPx += region.diffPixelCount;
      pv.regions.push(region);
    }
  }

  const rollups = [];
  for (const group of groups.values()) {
    let regionCount = 0;
    let totalDiffPx = 0;
    let coverage = 0;
    let worstViewport = null;
    let worstViewportDiffPx = -1;
    const viewportsAffected = [];

    for (const [label, pv] of group.perViewport) {
      regionCount += pv.regions.length;
      totalDiffPx += pv.diffPx;
      viewportsAffected.push(label);
      const vpCoverage = pv.area > 0 ? Math.min(1, pv.diffPx / pv.area) : 0;
      if (vpCoverage > coverage || (vpCoverage === coverage && pv.diffPx > worstViewportDiffPx)) {
        coverage = vpCoverage;
        worstViewport = label;
        worstViewportDiffPx = pv.diffPx;
      }
    }

    viewportsAffected.sort();
    const worst = group.perViewport.get(worstViewport);
    const worstRegion = worst.regions.reduce((a, b) => (b.diffPixelCount > a.diffPixelCount ? b : a));

    rollups.push({
      kind: group.kind,
      name: group.name,
      selector: worst.selector,
      regionCount,
      totalDiffPx,
      coverage,
      viewportsAffected,
      severityScore: coverage,
      worstViewport,
      worstCrop: worstRegion?.crops?.diff ?? null,
    });
  }

  rollups.sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (b.viewportsAffected.length !== a.viewportsAffected.length) {
      return b.viewportsAffected.length - a.viewportsAffected.length;
    }
    return b.totalDiffPx - a.totalDiffPx;
  });

  return rollups;
}
