const ESCAPE_MAP = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

function renderRegion(region) {
  const statusLabel = region.status === 'ignored'
    ? `IGNORED (${escapeHtml(JSON.stringify(region.matchedRule))})`
    : 'FAILED';
  const elementsHtml = (region.elements ?? [])
    .map((el) => `<li><code>${escapeHtml(el.selector)}</code> — ${escapeHtml(JSON.stringify(el.computedStyle))}</li>`)
    .join('');

  return `
    <div class="region ${region.status}">
      <h4>Region ${region.index} — ${statusLabel} (${region.diffPixelCount} px)</h4>
      <div class="crops">
        <figure><img src="${escapeHtml(region.crops.live)}" alt="live"><figcaption>Live</figcaption></figure>
        <figure><img src="${escapeHtml(region.crops.migrated)}" alt="migrated"><figcaption>Migrated</figcaption></figure>
        <figure><img src="${escapeHtml(region.crops.diff)}" alt="diff"><figcaption>Diff</figcaption></figure>
      </div>
      ${elementsHtml ? `<ul class="elements">${elementsHtml}</ul>` : ''}
    </div>
  `;
}

function renderViewport(viewport) {
  const mismatch = viewport.pageLengthMismatch
    ? `<p class="mismatch">Page length mismatch: live ${viewport.pageLengthMismatch.liveHeight}px vs migrated ${viewport.pageLengthMismatch.migratedHeight}px (Δ${viewport.pageLengthMismatch.deltaPx}px)</p>`
    : '';
  return `
    <section class="viewport ${viewport.status}">
      <h3>${escapeHtml(viewport.viewportLabel)} — ${viewport.status.toUpperCase()}</h3>
      ${viewport.errorMessage ? `<p class="error">${escapeHtml(viewport.errorMessage)}</p>` : ''}
      ${mismatch}
      ${viewport.regions.map(renderRegion).join('')}
    </section>
  `;
}

function renderPair(pair) {
  return `
    <article class="pair">
      <h2>${escapeHtml(pair.pairSlug)}</h2>
      <p>${escapeHtml(pair.liveUrl)} → ${escapeHtml(pair.migratedUrl)}</p>
      ${pair.viewports.map(renderViewport).join('')}
    </article>
  `;
}

export function generateReportHtml(runSummary) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>page-diff report — ${escapeHtml(runSummary.runId)}</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; }
    .pair { border-top: 2px solid #ccc; padding-top: 1rem; margin-top: 1rem; }
    .viewport.pass { color: #2e7d32; }
    .viewport.fail, .viewport.error { color: #d32f2f; }
    .region.ignored { opacity: 0.5; }
    .crops { display: flex; gap: 1rem; }
    .crops img { max-width: 240px; border: 1px solid #ccc; }
    .elements code { background: #f5f5f5; padding: 2px 4px; }
  </style>
</head>
<body>
  <h1>page-diff report</h1>
  <p>Run: ${escapeHtml(runSummary.runId)} — generated ${escapeHtml(runSummary.createdAt)}</p>
  ${runSummary.pairs.map(renderPair).join('')}
</body>
</html>`;
}
