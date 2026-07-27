export function normalizeText(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function unionBox(boxes) {
  if (!boxes || boxes.length === 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Confidence = match ratio, penalized when the matched region fills more of the
// viewport than maxAncestorAreaRatio (a sign the matches are scattered, not one block).
export function computeConfidence({ totalAnchors, matchedAnchors, regionArea, viewportArea }, config) {
  if (!totalAnchors) return 0;
  const matchRatio = matchedAnchors / totalAnchors;
  const areaRatio = viewportArea > 0 ? regionArea / viewportArea : 0;
  const maxRatio = config.maxAncestorAreaRatio;
  const penalty = areaRatio > maxRatio ? (areaRatio - maxRatio) / (1 - maxRatio) : 0;
  return Math.max(0, Math.min(1, matchRatio * (1 - penalty)));
}

// --- Browser-dependent (run via page.evaluate; verified manually, not unit-tested) ---

// Reads the migrated block's distinctive content to use as live-page search anchors.
export async function extractAnchors(page, selector) {
  return page.evaluate(({ sel, maxTexts }) => {
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const root = document.querySelector(sel);
    if (!root) return { headings: [], texts: [], images: [] };
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((el) => norm(el.textContent)).filter(Boolean);
    const texts = [...root.querySelectorAll('p,li,span,a,button')]
      .map((el) => norm(el.textContent)).filter((t) => t.length >= 12)
      .sort((a, b) => b.length - a.length).slice(0, maxTexts);
    const images = [...root.querySelectorAll('img')].map((img) => ({
      srcBase: (img.getAttribute('src') || '').split('?')[0].split('/').pop() || '',
      alt: norm(img.getAttribute('alt') || ''),
    })).filter((i) => i.srcBase || i.alt);
    return { headings, texts, images };
  }, { sel: selector, maxTexts: 5 });
}

// Finds the migrated block's anchors on the live page; returns matched element boxes
// (full-page scroll-offset coords) and how many distinct anchors matched.
export async function findAnchorsInLiveDom(page, anchors) {
  return page.evaluate(({ a }) => {
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    const boxOf = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height,
      };
    };
    const all = [...document.querySelectorAll('*')];
    const boxes = [];
    let matched = 0;
    const textAnchors = [...a.headings, ...a.texts];
    for (const anchor of textAnchors) {
      const needle = norm(anchor);
      const hit = all.find((el) => el.children.length === 0 && norm(el.textContent).includes(needle));
      if (hit) { matched += 1; boxes.push(boxOf(hit)); }
    }
    for (const img of a.images) {
      const hit = document.querySelector('img');
      const match = [...document.querySelectorAll('img')].find((el) => {
        const srcBase = (el.getAttribute('src') || '').split('?')[0].split('/').pop() || '';
        return (img.srcBase && srcBase === img.srcBase) || (img.alt && norm(el.getAttribute('alt') || '') === img.alt);
      }) || (img.srcBase || img.alt ? null : hit);
      if (match) { matched += 1; boxes.push(boxOf(match)); }
    }
    const total = textAnchors.length + a.images.length;
    return { matchedBoxes: boxes, matchedCount: matched, totalCount: total };
  }, { a: anchors });
}
