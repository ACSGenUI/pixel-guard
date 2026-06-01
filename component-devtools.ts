import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// --- Discovery script (browser + chrome-devtools evaluate_script) ---

export const COMPONENT_DISCOVERY_FUNCTION = `() => {
  const MIN_HEIGHT = 48;
  const MIN_WIDTH = 120;
  const seenKeys = new Map();
  const results = [];

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "");
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function cssPath(el) {
    if (!(el instanceof HTMLElement)) return "";
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const blockClass = [...node.classList].find(
        (c) =>
          c !== "block" &&
          !c.endsWith("-container") &&
          c !== "section" &&
          !c.startsWith("default-content")
      );
      if (blockClass) part += "." + cssEscape(blockClass);
      else if (node.classList.length > 0) part += "." + cssEscape(node.classList[0]);
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      if (parts.length >= 4) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function componentName(el) {
    const dataName = el.getAttribute("data-block-name") || el.dataset?.blockName;
    if (dataName?.trim()) return dataName.trim();
    const blockClass = [...el.classList].find(
      (c) =>
        c !== "block" &&
        !c.endsWith("-container") &&
        c !== "section" &&
        !c.startsWith("default-content")
    );
    if (blockClass) return blockClass;
    const containerClass = [...el.classList].find((c) => c.startsWith("container_"));
    if (containerClass) return containerClass.replace(/^container_/, "");
    const role = el.getAttribute("role");
    if (role) return role;
    return el.tagName.toLowerCase();
  }

  function confidenceFor(el, selector) {
    if (el.hasAttribute("data-block-name")) return "high";
    if (el.classList.contains("block")) return "high";
    if (selector.startsWith("#")) return "high";
    if (el.matches("header, footer, main, section")) return "medium";
    return "low";
  }

  function discoveryMethodFor(el) {
    if (el.hasAttribute("data-block-name")) return "data-attribute";
    if (el.classList.contains("block")) return "eds-block";
    return "chrome-devtools";
  }

  function addCandidate(el) {
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    if (rect.height < MIN_HEIGHT || rect.width < MIN_WIDTH) return;

    const name = componentName(el);
    if (!name) return;

    const pageKey = slugify(name);
    const index = seenKeys.get(pageKey) ?? 0;
    seenKeys.set(pageKey, index + 1);

    let selector = "";
    if (el.hasAttribute("data-block-name")) {
      const blockName = el.getAttribute("data-block-name");
      selector = '[data-block-name="' + blockName + '"]';
      if (index > 0) selector = cssPath(el);
    } else {
      selector = cssPath(el);
    }
    if (!selector) return;

    const captureId = "pg-capture-" + pageKey + "-" + index;
    el.setAttribute("data-pixel-guard-capture", captureId);
    if (!selector.includes("data-pixel-guard-capture")) {
      selector = '[data-pixel-guard-capture="' + captureId + '"]';
    }

    results.push({
      id: pageKey + "-" + index,
      name,
      index,
      selector,
      captureId,
      discoveryMethod: discoveryMethodFor(el),
      confidence: confidenceFor(el, selector),
    });
  }

  const candidates = new Set();
  const selectors = [
    "[data-block-name]",
    "div.block",
    ".block",
    "header",
    "footer",
    "main > section",
    "main > div.section",
    '[class*="container_"]',
    "section",
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) candidates.add(el);
    });
  }

  const deduped = [...candidates].filter((el, _i, arr) => {
    return !arr.some((other) => other !== el && other.contains(el));
  });

  deduped
    .sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    })
    .forEach(addCandidate);

  return results;
}`;

export type DiscoveredComponent = {
  id: string;
  name: string;
  index: number;
  selector: string;
  captureId: string;
  discoveryMethod: string;
  confidence: "high" | "medium" | "low";
};

// --- Chrome DevTools MCP config ---

export type ChromeDevtoolsMcpConfig = {
  command: string;
  args: string[];
};

export const CHROME_DEVTOOLS_MCP_PACKAGE = "chrome-devtools-mcp@1.1.1";

const DEFAULT_CHROME_DEVTOOLS_MCP_ARGS = [
  "-y",
  CHROME_DEVTOOLS_MCP_PACKAGE,
  "--headless",
] as const;

function parseArgs(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [...DEFAULT_CHROME_DEVTOOLS_MCP_ARGS];
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return ensureHeadless(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      // fall through
    }
  }
  return ensureHeadless(trimmed.split(/\s+/).filter(Boolean));
}

function ensureHeadless(args: string[]): string[] {
  const hasHeadlessFlag = args.some(
    (arg) => arg === "--headless" || arg.startsWith("--headless=")
  );
  if (hasHeadlessFlag) return args;
  return [...args, "--headless"];
}

export function getChromeDevtoolsMcpConfig(): ChromeDevtoolsMcpConfig {
  return {
    command: process.env.CHROME_DEVTOOLS_MCP_COMMAND?.trim() || "npx",
    args: parseArgs(process.env.CHROME_DEVTOOLS_MCP_ARGS),
  };
}

// --- Chrome DevTools MCP client ---

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

function extractToolText(result: CallToolResult): string {
  return (
    result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function parseDiscoveryPayload(text: string): DiscoveredComponent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as DiscoveredComponent[];
  } catch {
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(parsed)) return parsed as DiscoveredComponent[];
    }
  }

  return [];
}

function buildTagElementScript(selector: string, marker: string): string {
  return `() => {
    const selector = ${JSON.stringify(selector)};
    const marker = ${JSON.stringify(marker)};
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) return false;
    el.setAttribute("data-pixel-guard-screenshot", marker);
    el.setAttribute("aria-label", marker);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }`;
}

/** Dismiss common cookie/consent banners in the DevTools browser (mirrors Playwright path). */
export const COOKIE_DISMISS_SCRIPT = `() => {
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button#onetrust-accept-btn-handler",
    '[data-testid="cookie-policy-dialog-accept-button"]',
    "#truste-consent-button",
    ".ot-pc-refuse-all-handler",
    ".accept-cookies-button",
    'button[title="Accept All Cookies"]',
  ];
  const texts = ["Accept All Cookies", "Accept All", "I Accept", "Accept Cookies", "Agree"];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn instanceof HTMLElement) {
      btn.click();
      return sel;
    }
  }
  for (const label of texts) {
    const buttons = [...document.querySelectorAll("button, a[role='button']")];
    const match = buttons.find(
      (el) => el.textContent?.trim().toLowerCase() === label.toLowerCase()
    );
    if (match instanceof HTMLElement) {
      match.click();
      return label;
    }
  }
  return null;
}`;

class ChromeDevtoolsMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private preparedPageUrl: string | null = null;

  static async connect(): Promise<ChromeDevtoolsMcpClient> {
    const config = getChromeDevtoolsMcpConfig();
    const instance = new ChromeDevtoolsMcpClient();
    instance.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      stderr: "pipe",
    });
    instance.client = new Client(
      { name: "pixel-guard", version: "1.0.0" },
      { capabilities: {} }
    );
    await instance.client.connect(instance.transport);
    return instance;
  }

  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
    this.preparedPageUrl = null;
  }

  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    if (!this.client) throw new Error("chrome-devtools-mcp client is not connected");
    const result = await this.client.callTool({ name, arguments: args });
    return result as CallToolResult;
  }

  async preparePage(pageUrl: string, viewport: { width: number; height: number }): Promise<void> {
    if (this.preparedPageUrl === pageUrl) return;

    await this.callTool("resize_page", {
      width: viewport.width,
      height: viewport.height,
    });
    await this.callTool("navigate_page", {
      type: "url",
      url: pageUrl,
      timeout: 120000,
    });
    await this.callTool("wait_for", { text: [" "], timeout: 10000 }).catch(() => {});
    await this.callTool("evaluate_script", { function: COOKIE_DISMISS_SCRIPT }).catch(() => {});
    await this.callTool("wait_for", { text: [" "], timeout: 2000 }).catch(() => {});
    await this.callTool("evaluate_script", { function: COOKIE_DISMISS_SCRIPT }).catch(() => {});
    this.preparedPageUrl = pageUrl;
  }

  async discoverComponents(): Promise<DiscoveredComponent[]> {
    const result = await this.callTool("evaluate_script", {
      function: COMPONENT_DISCOVERY_FUNCTION,
    });
    if (result.isError) {
      throw new Error(extractToolText(result) || "chrome-devtools-mcp discovery failed");
    }
    return parseDiscoveryPayload(extractToolText(result));
  }

  async screenshotSelector(selector: string, filePath: string): Promise<void> {
    const marker = `pg-cap-${Date.now()}`;
    const tagged = await this.callTool("evaluate_script", {
      function: buildTagElementScript(selector, marker),
    });
    if (tagged.isError || extractToolText(tagged).trim() !== "true") {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    const snapshot = await this.callTool("take_snapshot", { verbose: true });
    const snapshotText = extractToolText(snapshot);
    const uid = findSnapshotUid(snapshotText, marker);
    if (!uid) {
      throw new Error(`Could not resolve snapshot uid for selector: ${selector}`);
    }

    const shot = await this.callTool("take_screenshot", {
      uid,
      filePath,
      format: "png",
    });
    if (shot.isError) {
      throw new Error(extractToolText(shot) || `take_screenshot failed for selector: ${selector}`);
    }
  }
}

function findSnapshotUid(snapshotText: string, marker: string): string | null {
  const lines = snapshotText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(marker)) continue;
    for (let j = i; j >= Math.max(0, i - 4); j--) {
      const uidMatch = lines[j].match(/uid=([^\s]+)/);
      if (uidMatch) return uidMatch[1];
    }
    for (let j = i; j <= Math.min(lines.length - 1, i + 4); j++) {
      const uidMatch = lines[j].match(/uid=([^\s]+)/);
      if (uidMatch) return uidMatch[1];
    }
  }
  return null;
}

export async function discoverComponentsViaChromeDevtoolsMcp(
  pageUrl: string,
  viewport: { width: number; height: number }
): Promise<ChromeDevtoolsDiscoveryResult> {
  let client: ChromeDevtoolsMcpClient | null = null;
  try {
    client = await ChromeDevtoolsMcpClient.connect();
    await client.preparePage(pageUrl, viewport);
    const components = await client.discoverComponents();
    return { components, engine: "chrome-devtools-mcp" };
  } finally {
    await client?.close();
  }
}

export async function screenshotComponentsViaChromeDevtoolsMcp(
  items: ChromeDevtoolsScreenshotItem[],
  viewport: { width: number; height: number }
): Promise<ChromeDevtoolsScreenshotResult[]> {
  if (items.length === 0) return [];

  let client: ChromeDevtoolsMcpClient | null = null;
  const results: ChromeDevtoolsScreenshotResult[] = [];

  try {
    client = await ChromeDevtoolsMcpClient.connect();
    for (const item of items) {
      try {
        await client.preparePage(item.pageUrl, viewport);
        await client.screenshotSelector(item.selector, item.filePath);
        results.push({ filePath: item.filePath, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ filePath: item.filePath, ok: false, error: message });
      }
    }
  } finally {
    await client?.close();
  }

  return results;
}
