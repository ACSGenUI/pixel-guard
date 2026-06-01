export declare const COMPONENT_DISCOVERY_FUNCTION = "() => {\n  const MIN_HEIGHT = 48;\n  const MIN_WIDTH = 120;\n  const seenKeys = new Map();\n  const results = [];\n\n  function slugify(value) {\n    return String(value || \"\")\n      .toLowerCase()\n      .trim()\n      .replace(/\\s+/g, \"-\")\n      .replace(/[^a-z0-9_-]/g, \"\");\n  }\n\n  function cssEscape(value) {\n    if (typeof CSS !== \"undefined\" && CSS.escape) return CSS.escape(value);\n    return String(value).replace(/[^a-zA-Z0-9_-]/g, \"\\\\$&\");\n  }\n\n  function cssPath(el) {\n    if (!(el instanceof HTMLElement)) return \"\";\n    if (el.id) return \"#\" + cssEscape(el.id);\n    const parts = [];\n    let node = el;\n    while (node && node.nodeType === 1 && node !== document.body) {\n      let part = node.tagName.toLowerCase();\n      const blockClass = [...node.classList].find(\n        (c) =>\n          c !== \"block\" &&\n          !c.endsWith(\"-container\") &&\n          c !== \"section\" &&\n          !c.startsWith(\"default-content\")\n      );\n      if (blockClass) part += \".\" + cssEscape(blockClass);\n      else if (node.classList.length > 0) part += \".\" + cssEscape(node.classList[0]);\n      const parent = node.parentElement;\n      if (parent) {\n        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);\n        if (siblings.length > 1) {\n          part += \":nth-of-type(\" + (siblings.indexOf(node) + 1) + \")\";\n        }\n      }\n      parts.unshift(part);\n      if (parts.length >= 4) break;\n      node = node.parentElement;\n    }\n    return parts.join(\" > \");\n  }\n\n  function componentName(el) {\n    const dataName = el.getAttribute(\"data-block-name\") || el.dataset?.blockName;\n    if (dataName?.trim()) return dataName.trim();\n    const blockClass = [...el.classList].find(\n      (c) =>\n        c !== \"block\" &&\n        !c.endsWith(\"-container\") &&\n        c !== \"section\" &&\n        !c.startsWith(\"default-content\")\n    );\n    if (blockClass) return blockClass;\n    const containerClass = [...el.classList].find((c) => c.startsWith(\"container_\"));\n    if (containerClass) return containerClass.replace(/^container_/, \"\");\n    const role = el.getAttribute(\"role\");\n    if (role) return role;\n    return el.tagName.toLowerCase();\n  }\n\n  function confidenceFor(el, selector) {\n    if (el.hasAttribute(\"data-block-name\")) return \"high\";\n    if (el.classList.contains(\"block\")) return \"high\";\n    if (selector.startsWith(\"#\")) return \"high\";\n    if (el.matches(\"header, footer, main, section\")) return \"medium\";\n    return \"low\";\n  }\n\n  function discoveryMethodFor(el) {\n    if (el.hasAttribute(\"data-block-name\")) return \"data-attribute\";\n    if (el.classList.contains(\"block\")) return \"eds-block\";\n    return \"chrome-devtools\";\n  }\n\n  function addCandidate(el) {\n    if (!(el instanceof HTMLElement)) return;\n    const rect = el.getBoundingClientRect();\n    if (rect.height < MIN_HEIGHT || rect.width < MIN_WIDTH) return;\n\n    const name = componentName(el);\n    if (!name) return;\n\n    const pageKey = slugify(name);\n    const index = seenKeys.get(pageKey) ?? 0;\n    seenKeys.set(pageKey, index + 1);\n\n    let selector = \"\";\n    if (el.hasAttribute(\"data-block-name\")) {\n      const blockName = el.getAttribute(\"data-block-name\");\n      selector = '[data-block-name=\"' + blockName + '\"]';\n      if (index > 0) selector = cssPath(el);\n    } else {\n      selector = cssPath(el);\n    }\n    if (!selector) return;\n\n    const captureId = \"pg-capture-\" + pageKey + \"-\" + index;\n    el.setAttribute(\"data-pixel-guard-capture\", captureId);\n    if (!selector.includes(\"data-pixel-guard-capture\")) {\n      selector = '[data-pixel-guard-capture=\"' + captureId + '\"]';\n    }\n\n    results.push({\n      id: pageKey + \"-\" + index,\n      name,\n      index,\n      selector,\n      captureId,\n      discoveryMethod: discoveryMethodFor(el),\n      confidence: confidenceFor(el, selector),\n    });\n  }\n\n  const candidates = new Set();\n  const selectors = [\n    \"[data-block-name]\",\n    \"div.block\",\n    \".block\",\n    \"header\",\n    \"footer\",\n    \"main > section\",\n    \"main > div.section\",\n    '[class*=\"container_\"]',\n    \"section\",\n  ];\n\n  for (const selector of selectors) {\n    document.querySelectorAll(selector).forEach((el) => {\n      if (el instanceof HTMLElement) candidates.add(el);\n    });\n  }\n\n  const deduped = [...candidates].filter((el, _i, arr) => {\n    return !arr.some((other) => other !== el && other.contains(el));\n  });\n\n  deduped\n    .sort((a, b) => {\n      const pos = a.compareDocumentPosition(b);\n      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;\n      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;\n      return 0;\n    })\n    .forEach(addCandidate);\n\n  return results;\n}";
export type DiscoveredComponent = {
    id: string;
    name: string;
    index: number;
    selector: string;
    captureId: string;
    discoveryMethod: string;
    confidence: "high" | "medium" | "low";
};
export type ChromeDevtoolsMcpConfig = {
    command: string;
    args: string[];
};
export declare const CHROME_DEVTOOLS_MCP_PACKAGE = "chrome-devtools-mcp@1.1.1";
export declare function getChromeDevtoolsMcpConfig(): ChromeDevtoolsMcpConfig;
export type ChromeDevtoolsDiscoveryResult = {
    components: DiscoveredComponent[];
    engine: "chrome-devtools-mcp";
};
export type ChromeDevtoolsScreenshotItem = {
    pageUrl: string;
    selector: string;
    filePath: string;
};
export type ChromeDevtoolsScreenshotResult = {
    filePath: string;
    ok: boolean;
    error?: string;
};
/** Dismiss common cookie/consent banners in the DevTools browser (mirrors Playwright path). */
export declare const COOKIE_DISMISS_SCRIPT = "() => {\n  const selectors = [\n    \"#onetrust-accept-btn-handler\",\n    \"button#onetrust-accept-btn-handler\",\n    '[data-testid=\"cookie-policy-dialog-accept-button\"]',\n    \"#truste-consent-button\",\n    \".ot-pc-refuse-all-handler\",\n    \".accept-cookies-button\",\n    'button[title=\"Accept All Cookies\"]',\n  ];\n  const texts = [\"Accept All Cookies\", \"Accept All\", \"I Accept\", \"Accept Cookies\", \"Agree\"];\n  for (const sel of selectors) {\n    const btn = document.querySelector(sel);\n    if (btn instanceof HTMLElement) {\n      btn.click();\n      return sel;\n    }\n  }\n  for (const label of texts) {\n    const buttons = [...document.querySelectorAll(\"button, a[role='button']\")];\n    const match = buttons.find(\n      (el) => el.textContent?.trim().toLowerCase() === label.toLowerCase()\n    );\n    if (match instanceof HTMLElement) {\n      match.click();\n      return label;\n    }\n  }\n  return null;\n}";
export declare function discoverComponentsViaChromeDevtoolsMcp(pageUrl: string, viewport: {
    width: number;
    height: number;
}): Promise<ChromeDevtoolsDiscoveryResult>;
export declare function screenshotComponentsViaChromeDevtoolsMcp(items: ChromeDevtoolsScreenshotItem[], viewport: {
    width: number;
    height: number;
}): Promise<ChromeDevtoolsScreenshotResult[]>;
