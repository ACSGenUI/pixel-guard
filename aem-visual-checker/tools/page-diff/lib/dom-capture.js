export function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function overlapArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function filterOverlappingElements(elements, regionBox) {
  return elements
    .filter((el) => boxesOverlap(el.boundingBox, regionBox))
    .sort((a, b) => (a.boundingBox.width * a.boundingBox.height) - (b.boundingBox.width * b.boundingBox.height));
}

const CURATED_STYLE_PROPERTIES = [
  'position', 'display', 'width', 'height', 'color', 'backgroundColor',
  'fontFamily', 'fontSize', 'fontWeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'transform', 'opacity', 'zIndex',
];

// Browser-dependent: walks the live DOM of the migrated page. Exercised end-to-end in Task 9,
// not unit-tested here (no headless browser in this test file).
export async function collectAllBoundingBoxes(page) {
  return page.evaluate(() => {
    function cssPath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        let selector = node.tagName.toLowerCase();
        if (node.id) {
          selector += `#${node.id}`;
          parts.unshift(selector);
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === node.tagName);
          if (siblings.length > 1) {
            selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
        }
        parts.unshift(selector);
        node = parent;
      }
      return parts.join(' > ');
    }

    return Array.from(document.querySelectorAll('*')).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        selector: cssPath(el),
        boundingBox: {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
      };
    });
  });
}

export async function collectElementDetails(page, selectors) {
  return page.evaluate(({ selectors: sels, styleProps }) => sels.map((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const boundingBox = {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
    const computed = window.getComputedStyle(el);
    const computedStyle = {};
    styleProps.forEach((prop) => { computedStyle[prop] = computed[prop]; });
    return {
      selector, boundingBox, outerHTML: el.outerHTML.slice(0, 2000), computedStyle,
    };
  }).filter(Boolean), { selectors, styleProps: CURATED_STYLE_PROPERTIES });
}
