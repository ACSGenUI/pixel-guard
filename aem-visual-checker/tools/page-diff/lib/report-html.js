const ESCAPE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

// Groups a viewport's regions by owning block (keyed on kind:selector); block-less regions
// collect under a single "Unattributed" group that always sorts last.
function groupRegionsByBlock(regions) {
  const groups = new Map();
  regions.forEach((region) => {
    const block = region.block ?? null;
    const key = block ? `${block.kind}:${block.selector}` : '__unattributed__';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: block ? block.name : 'Unattributed',
        kind: block ? block.kind : 'unattributed',
        regions: [],
      });
    }
    groups.get(key).regions.push(region);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.kind === 'unattributed') return 1;
    if (b.kind === 'unattributed') return -1;
    return 0;
  });
}

function groupStatus(group) {
  return group.regions.some((region) => region.status === 'failed') ? 'failed' : 'ignored';
}

function renderRegion(region) {
  const statusLabel = region.status === 'ignored'
    ? `Ignored — ${escapeHtml(JSON.stringify(region.matchedRule))}`
    : 'Failed';
  const elementsHtml = (region.elements ?? [])
    .map((el) => `<li><code>${escapeHtml(el.selector)}</code><span class="styles">${escapeHtml(JSON.stringify(el.computedStyle))}</span></li>`)
    .join('');

  return `
      <div class="region ${escapeHtml(region.status)}">
        <div class="region-head">
          <span class="region-title">Region ${region.index}</span>
          <span class="chip ${escapeHtml(region.status)}">${statusLabel}</span>
          <span class="meta">${region.diffPixelCount} px · (${region.x},${region.y}) ${region.width}×${region.height}</span>
        </div>
        <div class="crops">
          <figure><img loading="lazy" src="${escapeHtml(region.crops.live)}" alt="live"><figcaption>Live</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(region.crops.migrated)}" alt="migrated"><figcaption>Migrated</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(region.crops.diff)}" alt="diff"><figcaption>Diff</figcaption></figure>
        </div>
        ${elementsHtml ? `<ul class="elements">${elementsHtml}</ul>` : ''}
      </div>`;
}

function renderGroup(group) {
  const status = groupStatus(group);
  const totalPx = group.regions.reduce((sum, region) => sum + region.diffPixelCount, 0);
  const kindLabel = group.kind === 'unattributed' ? '' : `<span class="kind">${escapeHtml(group.kind)}</span>`;
  return `
    <details class="group ${status}" data-group-name="${escapeHtml(group.name)}" open>
      <summary>
        <span class="group-name">${escapeHtml(group.name)}</span>
        ${kindLabel}
        <span class="chip ${status}">${status === 'failed' ? 'Failed' : 'Ignored'}</span>
        <span class="meta">${group.regions.length} region${group.regions.length === 1 ? '' : 's'} · ${totalPx} px</span>
      </summary>
      ${group.regions.map(renderRegion).join('')}
    </details>`;
}

function renderViewport(viewport) {
  const chip = `<span class="chip ${escapeHtml(viewport.status)}">${escapeHtml(viewport.status.toUpperCase())}</span>`;
  const mismatch = viewport.pageLengthMismatch
    ? `<p class="banner mismatch">Page length mismatch: live ${viewport.pageLengthMismatch.liveHeight}px vs migrated ${viewport.pageLengthMismatch.migratedHeight}px (Δ${viewport.pageLengthMismatch.deltaPx}px)</p>`
    : '';
  const error = viewport.errorMessage ? `<p class="banner error">${escapeHtml(viewport.errorMessage)}</p>` : '';
  const groups = viewport.regions.length > 0
    ? groupRegionsByBlock(viewport.regions).map(renderGroup).join('')
    : '<p class="empty">No differing regions.</p>';
  return `
    <section class="viewport">
      <h3>${escapeHtml(viewport.viewportLabel)} ${chip}</h3>
      ${error}
      ${mismatch}
      ${groups}
    </section>`;
}

function renderPair(pair) {
  return `
  <article class="pair">
    <h2>${escapeHtml(pair.pairSlug)}</h2>
    <p class="urls">${escapeHtml(pair.liveUrl)} <span class="arrow">→</span> ${escapeHtml(pair.migratedUrl)}</p>
    ${pair.viewports.map(renderViewport).join('')}
  </article>`;
}

function countGroups(runSummary) {
  let failed = 0;
  let ignored = 0;
  runSummary.pairs.forEach((pair) => pair.viewports.forEach((viewport) => {
    if (viewport.regions.length === 0) return;
    groupRegionsByBlock(viewport.regions).forEach((group) => {
      if (groupStatus(group) === 'failed') failed += 1;
      else ignored += 1;
    });
  }));
  return { failed, ignored };
}

const STYLES = `
    :root {
      --bg: #f7f8fa; --card: #fff; --ink: #1a1a1a; --muted: #666; --line: #e2e5ea;
      --pass: #2e7d32; --fail: #d32f2f; --ignored: #9aa0a6; --error: #b26a00; --accent: #1a73e8;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: var(--bg); color: var(--ink); line-height: 1.5; }
    header.run { padding: 1.5rem 2rem; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
    header.run h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
    header.run .sub { color: var(--muted); font-size: .85rem; }
    header.run .totals { margin-top: .5rem; display: flex; gap: .75rem; }
    main { padding: 1.5rem 2rem; max-width: 1100px; }
    .pair { margin-bottom: 2rem; }
    .pair h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
    .urls { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; word-break: break-all; }
    .urls .arrow { color: var(--accent); }
    .viewport { margin-bottom: 1.25rem; }
    .viewport h3 { font-size: .95rem; margin: 0 0 .5rem; display: flex; align-items: center; gap: .5rem; }
    .banner { padding: .5rem .75rem; border-radius: 6px; font-size: .85rem; }
    .banner.error { background: #fff3e0; color: var(--error); }
    .banner.mismatch { background: #fdecea; color: var(--fail); }
    .empty { color: var(--muted); font-size: .85rem; }
    .group { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: .75rem; overflow: hidden; }
    .group.ignored { opacity: .6; }
    .group > summary { cursor: pointer; padding: .6rem .9rem; display: flex; align-items: center; gap: .6rem; font-weight: 600; list-style: none; }
    .group > summary::-webkit-details-marker { display: none; }
    .group-name { font-size: .95rem; }
    .kind { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 .35rem; }
    .meta { color: var(--muted); font-weight: 400; font-size: .8rem; margin-left: auto; }
    .chip { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: .1rem .45rem; border-radius: 999px; color: #fff; }
    .chip.pass { background: var(--pass); } .chip.fail, .chip.failed, .chip.error { background: var(--fail); } .chip.ignored { background: var(--ignored); }
    .region { border-top: 1px solid var(--line); padding: .75rem .9rem; }
    .region-head { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; font-size: .85rem; }
    .region-title { font-weight: 600; }
    .crops { display: flex; gap: .75rem; flex-wrap: wrap; }
    .crops figure { margin: 0; font-size: .7rem; color: var(--muted); text-align: center; }
    .crops img { display: block; max-width: 260px; max-height: 320px; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
    .elements { margin: .6rem 0 0; padding-left: 1.1rem; font-size: .8rem; }
    .elements code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
    .elements .styles { color: var(--muted); margin-left: .4rem; }`;

export function generateReportHtml(runSummary) {
  const { failed, ignored } = countGroups(runSummary);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>page-diff report — ${escapeHtml(runSummary.runId)}</title>
  <style>${STYLES}
  </style>
</head>
<body>
  <header class="run">
    <h1>page-diff report</h1>
    <div class="sub">Run ${escapeHtml(runSummary.runId)} · generated ${escapeHtml(runSummary.createdAt)}</div>
    <div class="totals">
      <span class="chip failed">${failed} failed group${failed === 1 ? '' : 's'}</span>
      <span class="chip ignored">${ignored} ignored group${ignored === 1 ? '' : 's'}</span>
    </div>
  </header>
  <main>
    ${runSummary.pairs.map(renderPair).join('')}
  </main>
</body>
</html>`;
}
