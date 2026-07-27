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

function viewportCounts(viewport) {
  let failed = 0;
  let ignored = 0;
  if (viewport.regions.length > 0) {
    groupRegionsByBlock(viewport.regions).forEach((group) => {
      if (groupStatus(group) === 'failed') failed += 1;
      else ignored += 1;
    });
  }
  return { failed, ignored };
}

function pairStatus(pair) {
  return pair.viewports.some((viewport) => viewport.status === 'fail' || viewport.status === 'error')
    ? 'fail'
    : 'pass';
}

// Region accordion — collapsed by default so its (large) crop images stay hidden until drilled into.
function renderRegion(region) {
  const statusLabel = region.status === 'ignored'
    ? `Ignored — ${escapeHtml(JSON.stringify(region.matchedRule))}`
    : 'Failed';
  const elementsHtml = (region.elements ?? [])
    .map((el) => `<li><code>${escapeHtml(el.selector)}</code><span class="styles">${escapeHtml(JSON.stringify(el.computedStyle))}</span></li>`)
    .join('');

  return `
        <details class="region ${escapeHtml(region.status)}">
          <summary>
            <span class="region-title">Region ${region.index}</span>
            <span class="chip ${escapeHtml(region.status)}">${statusLabel}</span>
            <span class="meta">${region.diffPixelCount} px · (${region.x},${region.y}) ${region.width}×${region.height}</span>
          </summary>
          <div class="crops">
            <figure><img loading="lazy" src="${escapeHtml(region.crops.live)}" alt="live"><figcaption>Live</figcaption></figure>
            <figure><img loading="lazy" src="${escapeHtml(region.crops.migrated)}" alt="migrated"><figcaption>Migrated</figcaption></figure>
            <figure><img loading="lazy" src="${escapeHtml(region.crops.diff)}" alt="diff"><figcaption>Diff</figcaption></figure>
          </div>
          ${elementsHtml ? `<ul class="elements">${elementsHtml}</ul>` : ''}
        </details>`;
}

// Block group accordion — open by default so the per-component findings are visible at a glance.
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

// Breakpoint (viewport) accordion — open by default.
// Full-page live/migrated/diff screenshots, shown before the region/block breakdown.
// The files are written by compare-page-diff.js at <pairSlug>/<viewport>/{live,migrated,diff}.png;
// only present for non-error viewports (an errored viewport never got past screenshotting).
function renderFullPage(pairSlug, viewport) {
  if (viewport.status === 'error') return '';
  const base = `${pairSlug}/${viewport.viewportLabel.toLowerCase()}`;
  return `
      <details class="fullpage" open>
        <summary><span class="region-title">Full page</span></summary>
        <div class="crops">
          <figure><img loading="lazy" src="${escapeHtml(base)}/live.png" alt="live full page"><figcaption>Live</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(base)}/migrated.png" alt="migrated full page"><figcaption>Migrated</figcaption></figure>
          <figure><img loading="lazy" src="${escapeHtml(base)}/diff.png" alt="diff full page"><figcaption>Diff</figcaption></figure>
        </div>
      </details>`;
}

function renderViewport(viewport, pairSlug) {
  const chip = `<span class="chip ${escapeHtml(viewport.status)}">${escapeHtml(viewport.status.toUpperCase())}</span>`;
  const { failed, ignored } = viewportCounts(viewport);
  const counts = viewport.regions.length > 0
    ? `<span class="meta">${failed} failed · ${ignored} ignored group${failed + ignored === 1 ? '' : 's'}</span>`
    : '<span class="meta">no differences</span>';
  const mismatch = viewport.pageLengthMismatch
    ? `<p class="banner mismatch">Page length mismatch: live ${viewport.pageLengthMismatch.liveHeight}px vs migrated ${viewport.pageLengthMismatch.migratedHeight}px (Δ${viewport.pageLengthMismatch.deltaPx}px)</p>`
    : '';
  const error = viewport.errorMessage ? `<p class="banner error">${escapeHtml(viewport.errorMessage)}</p>` : '';
  const groups = viewport.regions.length > 0
    ? groupRegionsByBlock(viewport.regions).map(renderGroup).join('')
    : '<p class="empty">No differing regions.</p>';
  return `
    <details class="viewport ${escapeHtml(viewport.status)}" open>
      <summary>
        <span class="vp-name">${escapeHtml(viewport.viewportLabel)}</span>
        ${chip}
        ${counts}
      </summary>
      ${error}
      ${mismatch}
      ${renderFullPage(pairSlug, viewport)}
      ${groups}
    </details>`;
}

function renderBlockImpactRow(item) {
  const pct = Math.round(item.coverage * 100);
  const vpChips = item.viewportsAffected
    .map((v) => `<span class="vp-chip">${escapeHtml(v)}</span>`).join('');
  const thumb = item.worstCrop
    ? `<img class="bi-thumb" loading="lazy" src="${escapeHtml(item.worstCrop)}" alt="worst diff crop">`
    : '';
  return `
      <div class="bi-row">
        ${thumb}
        <div class="bi-main">
          <div class="bi-name">${escapeHtml(item.name)} <span class="kind">${escapeHtml(item.kind)}</span></div>
          <div class="bi-bar"><span style="width:${pct}%"></span></div>
        </div>
        <div class="bi-meta">
          <span class="bi-cov">${pct}% coverage</span>
          <span>${item.viewportsAffected.length} viewport${item.viewportsAffected.length === 1 ? '' : 's'}</span>
          ${vpChips}
          <span>${item.regionCount} region${item.regionCount === 1 ? '' : 's'}</span>
          <span>${item.totalDiffPx.toLocaleString('en-US')} px</span>
        </div>
      </div>`;
}

// At-a-glance ranked roll-up at the top of a pair: which blocks are most broken, by coverage.
// The roll-up arrives already ordered top-to-bottom (header/nav first, then down the
// page), so render it as a single list in that order rather than grouping by kind.
function renderBlockImpact(pair) {
  const summary = pair.blockSummary ?? [];
  if (summary.length === 0) return '';
  return `
  <section class="block-impact">
    <h3>Block impact (top to bottom)</h3>
    ${summary.map(renderBlockImpactRow).join('')}
  </section>`;
}

// Location (URL pair) accordion — open by default.
function renderPair(pair) {
  const status = pairStatus(pair);
  return `
  <details class="pair" open>
    <summary>
      <span class="pair-name">${escapeHtml(pair.pairSlug)}</span>
      <span class="chip ${status}">${status.toUpperCase()}</span>
      <span class="urls">${escapeHtml(pair.liveUrl)} <span class="arrow">→</span> ${escapeHtml(pair.migratedUrl)}</span>
    </summary>
    ${renderBlockImpact(pair)}
    ${pair.viewports.map((viewport) => renderViewport(viewport, pair.pairSlug)).join('')}
  </details>`;
}

function countGroups(runSummary) {
  let failed = 0;
  let ignored = 0;
  runSummary.pairs.forEach((pair) => pair.viewports.forEach((viewport) => {
    const counts = viewportCounts(viewport);
    failed += counts.failed;
    ignored += counts.ignored;
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
    header.run { padding: 1.25rem 2rem; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
    header.run h1 { margin: 0 0 .25rem; font-size: 1.25rem; }
    header.run .sub { color: var(--muted); font-size: .85rem; }
    header.run .totals { margin-top: .5rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .toolbar { margin-left: auto; display: flex; gap: .4rem; }
    .toolbar button { font: inherit; font-size: .78rem; padding: .25rem .6rem; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; color: var(--ink); }
    .toolbar button:hover { border-color: var(--accent); color: var(--accent); }
    main { padding: 1.25rem 2rem; max-width: 1100px; }
    summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: .55rem; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "▸"; color: var(--muted); font-size: .75rem; transition: transform .12s ease; }
    details[open] > summary::before { transform: rotate(90deg); }
    details.pair { background: transparent; margin-bottom: 1.25rem; }
    details.pair > summary { padding: .5rem 0; font-size: 1.05rem; font-weight: 600; border-bottom: 2px solid var(--line); }
    .pair-name { font-weight: 700; }
    .urls { color: var(--muted); font-size: .8rem; font-weight: 400; word-break: break-all; }
    .urls .arrow { color: var(--accent); }
    details.viewport { margin: .75rem 0 0 .5rem; }
    details.viewport > summary { padding: .4rem 0; font-size: .95rem; font-weight: 600; }
    .vp-name { font-weight: 600; }
    .banner { padding: .5rem .75rem; border-radius: 6px; font-size: .85rem; margin: .4rem 0 .4rem 1.25rem; }
    .banner.error { background: #fff3e0; color: var(--error); }
    .banner.mismatch { background: #fdecea; color: var(--fail); }
    .empty { color: var(--muted); font-size: .85rem; margin: .3rem 0 .3rem 1.25rem; }
    details.group { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: .5rem 0 .5rem 1.25rem; overflow: hidden; }
    details.group.ignored { opacity: .6; }
    details.group > summary { padding: .55rem .8rem; font-weight: 600; }
    .group-name { font-size: .92rem; }
    .kind { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 .35rem; }
    .meta { color: var(--muted); font-weight: 400; font-size: .78rem; margin-left: auto; }
    .chip { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: .1rem .45rem; border-radius: 999px; color: #fff; white-space: nowrap; }
    .chip.pass { background: var(--pass); } .chip.fail, .chip.failed, .chip.error { background: var(--fail); } .chip.ignored { background: var(--ignored); }
    details.fullpage { margin: .4rem 0 .4rem 1.25rem; }
    details.fullpage > summary { padding: .35rem 0; font-size: .84rem; }
    details.region { border-top: 1px solid var(--line); }
    details.region > summary { padding: .5rem .8rem; font-size: .84rem; }
    .region-title { font-weight: 600; }
    .crops { display: flex; gap: .75rem; flex-wrap: wrap; padding: .3rem .8rem .8rem; }
    .crops figure { margin: 0; font-size: .7rem; color: var(--muted); text-align: center; }
    .crops img { display: block; max-width: 260px; max-height: 320px; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
    .elements { margin: 0 0 .7rem; padding: 0 .8rem 0 2rem; font-size: .8rem; }
    .elements code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
    .elements .styles { color: var(--muted); margin-left: .4rem; }
    section.block-impact { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: .6rem 0 .6rem .5rem; padding: .6rem .9rem; }
    section.block-impact h3 { margin: 0 0 .5rem; font-size: .95rem; }
    .bi-row { display: flex; align-items: center; gap: .7rem; padding: .35rem 0; border-top: 1px solid var(--line); }
    .bi-thumb { width: 60px; height: 40px; object-fit: cover; border: 1px solid var(--line); border-radius: 4px; flex: none; }
    .bi-main { flex: 1; min-width: 0; }
    .bi-name { font-weight: 600; font-size: .88rem; }
    .bi-bar { height: 6px; background: var(--line); border-radius: 999px; margin-top: .25rem; overflow: hidden; }
    .bi-bar span { display: block; height: 100%; background: var(--fail); }
    .bi-meta { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .74rem; color: var(--muted); }
    .bi-cov { font-weight: 700; color: var(--ink); }
    .vp-chip { font-size: .66rem; border: 1px solid var(--line); border-radius: 4px; padding: 0 .3rem; }`;

const TOGGLE_SCRIPT = `
    document.querySelector('.toolbar').addEventListener('click', function (event) {
      var action = event.target.getAttribute('data-action');
      if (!action) return;
      document.querySelectorAll('details').forEach(function (node) { node.open = action === 'expand'; });
    });`;

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
      <span class="toolbar">
        <button type="button" data-action="expand">Expand all</button>
        <button type="button" data-action="collapse">Collapse all</button>
      </span>
    </div>
  </header>
  <main>
    ${runSummary.pairs.map(renderPair).join('')}
  </main>
  <script>${TOGGLE_SCRIPT}
  </script>
</body>
</html>`;
}
