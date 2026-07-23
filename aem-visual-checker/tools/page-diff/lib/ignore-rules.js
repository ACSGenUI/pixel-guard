import { readFile } from 'node:fs/promises';

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export async function loadIgnoreRules(ignoreFilePath) {
  try {
    const raw = await readFile(ignoreFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${ignoreFilePath} must contain a JSON array of ignore rules.`);
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

export function matchRulesForContext(rules, { pairSlug, liveUrl, viewportLabel }) {
  return rules.filter((rule) => {
    let matchesPair = false;
    if (rule.pairSlug) {
      matchesPair = rule.pairSlug === pairSlug;
    } else if (rule.urlPattern) {
      matchesPair = wildcardToRegExp(rule.urlPattern).test(liveUrl);
    }
    if (!matchesPair) return false;
    if (rule.viewport && rule.viewport !== viewportLabel) return false;
    return true;
  });
}

export function overlapRatio(regionBox, ruleBox) {
  const x1 = Math.max(regionBox.x, ruleBox.x);
  const y1 = Math.max(regionBox.y, ruleBox.y);
  const x2 = Math.min(regionBox.x + regionBox.width, ruleBox.x + ruleBox.width);
  const y2 = Math.min(regionBox.y + regionBox.height, ruleBox.y + ruleBox.height);
  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const regionArea = regionBox.width * regionBox.height;
  return regionArea === 0 ? 0 : intersectionArea / regionArea;
}

export function applyIgnoreStatus(regions, ignoredBoxes, overlapThreshold) {
  return regions.map((region) => {
    const match = ignoredBoxes.find(({ box }) => overlapRatio(region, box) >= overlapThreshold);
    return match
      ? { ...region, status: 'ignored', matchedRule: match.rule }
      : { ...region, status: 'failed', matchedRule: null };
  });
}

// Browser-dependent: resolves each rule's ignore box against the live migrated page. Selector
// rules need a real DOM to query, so this isn't unit-tested here -- exercised end-to-end when
// compare-page-diff.js runs against real pages (Task 8).
export async function resolveIgnoreBoxes(page, rules) {
  const boxes = [];
  for (const rule of rules) {
    if (rule.region) {
      boxes.push({ box: rule.region, rule });
      continue;
    }
    if (rule.selector) {
      // eslint-disable-next-line no-await-in-loop
      const selectorBoxes = await page.evaluate((selector) => Array.from(document.querySelectorAll(selector)).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height,
        };
      }), rule.selector);
      selectorBoxes.forEach((box) => boxes.push({ box, rule }));
    }
  }
  return boxes;
}
