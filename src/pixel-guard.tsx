import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const IMPLEMENTATION = { name: "Pixel Guard", version: "1.0.0" };

const VIEWPORTS = [
  { width: 320, height: 568, label: "Mobile" },
  { width: 768, height: 1024, label: "Tablet" },
  { width: 1024, height: 768, label: "Desktop" },
  { width: 1440, height: 900, label: "Large" },
];

const DEFAULT_BASE_URL = "http://localhost:3000";
const TEMPLATES_PATH = "/tools/sidekick/library/templates/";
const SNAPSHOTS_PATH = "/tools/visual-tests/visual.spec.js-snapshots";

function buildLibraryUrl(baseUrl: string, blockName: string, index: number): string {
  const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
  const origin = baseUrl.replace(/\/$/, "");
  const path = `${TEMPLATES_PATH}${block}`;
  return `${origin}/tools/sidekick/library.html?plugin=blocks&path=${encodeURIComponent(path)}&index=${index}&vtest=true`;
}

function buildSnapshotUrl(
  baseUrl: string,
  blockName: string,
  index: number,
  viewportLabel: string
): string {
  const block = blockName.toLowerCase().trim().replace(/\s+/g, "-");
  const v = viewportLabel.length > 0
    ? viewportLabel.charAt(0).toUpperCase() + viewportLabel.slice(1).toLowerCase()
    : "Desktop";
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}${SNAPSHOTS_PATH}/${block}-${index}-${v}.png`;
}

function parseToolResultText(text: string): {
  imageUrl?: string;
  imageData?: string;
  componentName?: string;
  viewport?: string;
  libraryUrl?: string;
  blockName?: string;
  variationIndex?: number;
} {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return {
      imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
      imageData: typeof data.imageData === "string" ? data.imageData : undefined,
      componentName:
        typeof data.componentName === "string" ? data.componentName : undefined,
      viewport: typeof data.viewport === "string" ? data.viewport : undefined,
      libraryUrl:
        typeof data.libraryUrl === "string" ? data.libraryUrl : undefined,
      blockName:
        typeof data.blockName === "string" ? data.blockName : undefined,
      variationIndex:
        typeof data.variationIndex === "number" ? data.variationIndex : undefined,
    };
  } catch {
    return {};
  }
}

function PixelGuardApp() {
  const { app, error } = useApp({
    appInfo: IMPLEMENTATION,
    capabilities: {},
  });

  const [blockName, setBlockName] = useState("");
  const [variationIndex, setVariationIndex] = useState(0);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [imageUrlFromTool, setImageUrlFromTool] = useState<string>("");
  const [libraryUrlFromTool, setLibraryUrlFromTool] = useState<string>("");
  const [opacity, setOpacity] = useState(0.5);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [viewportLabel, setViewportLabel] = useState<string>("desktop");
  const [toolbarPosition, setToolbarPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const [imageError, setImageError] = useState(false);
  const [imageDataBase64, setImageDataBase64] = useState<string>("");
  const [testRunning, setTestRunning] = useState(false);
  const [testRunSuccess, setTestRunSuccess] = useState<boolean | null>(null);
  const [testRunOutput, setTestRunOutput] = useState("");
  const [testReportUrl, setTestReportUrl] = useState("");
  const [testError, setTestError] = useState("");

  const blockNameTrimmed = blockName.trim();
  const libraryUrlRaw =
    blockNameTrimmed
      ? buildLibraryUrl(baseUrl, blockNameTrimmed, variationIndex)
      : libraryUrlFromTool;
  const libraryUrl =
    libraryUrlRaw && !libraryUrlRaw.includes("vtest=true")
      ? `${libraryUrlRaw}${libraryUrlRaw.includes("?") ? "&" : "?"}vtest=true`
      : libraryUrlRaw;
  const rawImageUrl =
    blockNameTrimmed
      ? buildSnapshotUrl(baseUrl, blockNameTrimmed, variationIndex, viewportLabel)
      : imageUrlFromTool;
  // Load by URL when host allows via _meta.ui.csp.resourceDomains; use base64 only as fallback from tool result (strict CSP hosts).
  const displayUrl =
    imageDataBase64
      ? `data:image/png;base64,${imageDataBase64}`
      : rawImageUrl;
  const componentName = blockNameTrimmed
    ? blockNameTrimmed.toLowerCase().replace(/\s+/g, "-")
    : "";

  useEffect(() => {
    if (!app) return;
    app.ontoolresult = (result) => {
      const content = result.content;
      if (!content || !Array.isArray(content)) return;
      for (const part of content) {
        if (part.type === "text" && "text" in part) {
          const parsed = parseToolResultText(part.text);
          if (parsed.blockName) {
            setBlockName(parsed.blockName);
            if (parsed.variationIndex !== undefined) setVariationIndex(parsed.variationIndex);
          }
          if (parsed.viewport) setViewportLabel(parsed.viewport);
          if (parsed.imageUrl) setImageUrlFromTool(parsed.imageUrl);
          if (parsed.libraryUrl) setLibraryUrlFromTool(parsed.libraryUrl);
          if (parsed.imageData) setImageDataBase64(parsed.imageData);
          break;
        }
      }
    };
  }, [app]);

  // Optional: under strict CSP, call getBlockSnapshot to get base64 when URL fails. Only run when we have no imageData and URL might be blocked.
  useEffect(() => {
    if (!app || !blockNameTrimmed || imageDataBase64) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      app
        .callServerTool({
          name: "getBlockSnapshot",
          arguments: {
            blockName: blockNameTrimmed,
            variationIndex,
            viewport: viewportLabel,
            baseUrl: baseUrl || undefined,
          },
        })
        .then((res) => {
          if (cancelled) return;
          const content = res?.content;
          if (!content || !Array.isArray(content)) return;
          for (const part of content) {
            if (part.type === "text" && "text" in part) {
              const parsed = parseToolResultText(part.text);
              if (parsed.imageData) setImageDataBase64(parsed.imageData);
              break;
            }
          }
        })
        .catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [app, blockNameTrimmed, variationIndex, viewportLabel, baseUrl, imageDataBase64]);

  const handleAskToValidate = useCallback(async () => {
    if (!app) return;
    try {
      await app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: "Run validateVisual for a block (e.g. tabs, cards, hero) to show the overlay.",
          },
        ],
      });
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }, [app]);

  const handleRunVisualTest = useCallback(async () => {
    const name = blockNameTrimmed || blockName;
    if (!app || !name.trim()) return;
    setTestRunning(true);
    setTestError("");
    setTestRunOutput("");
    setTestReportUrl("");
    setTestRunSuccess(null);
    try {
      const res = await app.callServerTool({
        name: "runVisualTest",
        arguments: { blockName: name.trim() },
      });
      const content = res?.content;
      if (!content || !Array.isArray(content)) {
        setTestError("No response from tool.");
        setTestRunSuccess(false);
        return;
      }
      for (const part of content) {
        if (part.type === "text" && "text" in part) {
          try {
            const data = JSON.parse(part.text) as {
              success?: boolean;
              output?: string;
              stderr?: string;
              reportUrl?: string;
              error?: string;
              details?: string;
              hint?: string;
            };
            setTestRunSuccess(data.success === true);
            setTestReportUrl(typeof data.reportUrl === "string" ? data.reportUrl : "");
            const out = [data.output, data.stderr].filter(Boolean).join("\n");
            setTestRunOutput(out || "");
            if (data.error || data.details) {
              setTestError([data.error, data.details, data.hint].filter(Boolean).join(" — ") || "");
            }
          } catch {
            setTestRunOutput(part.text);
            setTestRunSuccess(false);
          }
          break;
        }
      }
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
      setTestRunSuccess(false);
    } finally {
      setTestRunning(false);
    }
  }, [app, blockNameTrimmed, blockName]);

  const currentViewport =
    VIEWPORTS.find((v) => v.label.toLowerCase() === viewportLabel.toLowerCase()) ??
    VIEWPORTS[2];

  const handleToolbarMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-drag-handle]")) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: toolbarPosition.x,
        startTop: toolbarPosition.y,
      };
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      setToolbarPosition({
        x: dragStartRef.current.startLeft + (e.clientX - dragStartRef.current.startX),
        y: dragStartRef.current.startTop + (e.clientY - dragStartRef.current.startY),
      });
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  if (error)
    return (
      <div style={{ padding: 20, color: "#c00" }}>
        <strong>Error:</strong> {error.message}
      </div>
    );
  if (!app)
    return (
      <div style={{ padding: 20, fontFamily: "system-ui" }}>Loading Pixel Guard…</div>
    );

  return (
    <main
      style={{
        padding: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 900,
        margin: "0 auto",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "22px", marginBottom: 8 }}>
        Pixel Guard – UI Visual Validator
      </h1>
      <p style={{ color: "#555", fontSize: 14, marginBottom: 20 }}>
        Compare baseline/reference images with the overlay. Use the toolbar to
        adjust opacity and toggle visibility.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
          Block name
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="e.g. tabs, cards, hero"
            value={blockName}
            onChange={(e) => {
              setBlockName(e.target.value);
              setImageError(false);
            }}
            style={{
              width: 160,
              padding: "8px 12px",
              border: "1px solid #ccc",
              borderRadius: 6,
              fontSize: 14,
            }}
            aria-label="Block name"
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            Index
            <input
              type="number"
              min={0}
              value={variationIndex}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n) && n >= 0) setVariationIndex(n);
              }}
              style={{
                width: 56,
                padding: "6px 8px",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 13,
              }}
              aria-label="Variation index"
            />
          </label>
          <button
            type="button"
            onClick={handleAskToValidate}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Ask AI to validate
          </button>
          <button
            type="button"
            onClick={handleRunVisualTest}
            disabled={testRunning || !blockNameTrimmed}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              backgroundColor: "#059669",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: testRunning || !blockNameTrimmed ? "not-allowed" : "pointer",
              fontWeight: 500,
              opacity: testRunning || !blockNameTrimmed ? 0.7 : 1,
            }}
          >
            {testRunning ? "Running…" : "Run visual test"}
          </button>
        </div>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "#555" }}>
            Base URL
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{
                width: 280,
                marginLeft: 8,
                padding: "6px 10px",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 13,
              }}
              title="Site origin (library and snapshots; host must allow via CSP resourceDomains)"
            />
          </label>
        </div>
        {blockNameTrimmed && (
          <>
            <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              Block: {componentName} · Index: {variationIndex} · Viewport: {viewportLabel}
            </p>
            <p style={{ fontSize: 12, marginTop: 4 }}>
              Block loads in the view below.{" "}
              <a
                href={libraryUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2563eb" }}
              >
                Open in new tab
              </a>
              <span style={{ color: "#888", marginLeft: 8, fontSize: 11 }}>
                {libraryUrl}
              </span>
            </p>
          </>
        )}
        {imageError && (
          <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>
            Baseline image failed to load. Check base URL and that snapshots exist. Host must allow images from base URL via CSP resourceDomains.
          </p>
        )}
      </div>

      {/* Viewport selector */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {VIEWPORTS.map((vp) => (
          <button
            key={vp.label}
            type="button"
            onClick={() => setViewportLabel(vp.label.toLowerCase())}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              border:
                viewportLabel === vp.label.toLowerCase()
                  ? "2px solid #2563eb"
                  : "1px solid #ccc",
              borderRadius: 6,
              cursor: "pointer",
              background:
                viewportLabel === vp.label.toLowerCase() ? "#eff6ff" : "#fff",
            }}
          >
            {vp.label} ({vp.width}×{vp.height})
          </button>
        ))}
      </div>

      {/* View: iframe (library page) + baseline overlay */}
      <div
        style={{
          position: "relative",
          width: Math.min(currentViewport.width, 800),
          height: Math.min(currentViewport.height, 500),
          maxWidth: "100%",
          border: "1px solid #ddd",
          borderRadius: 8,
          overflow: "hidden",
          background: "#f5f5f5",
        }}
      >
        {!blockNameTrimmed && !libraryUrlFromTool ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
              fontSize: 14,
            }}
          >
            Enter a block name (e.g. tabs, cards, hero) to load the block in this view and show baseline overlay
          </div>
        ) : (
          <>
            {/* Library page inside the app (block opens here, not in a new tab) */}
            {(blockNameTrimmed || libraryUrlFromTool) && (
              <iframe
                title="Block in library"
                src={libraryUrl}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                  zIndex: 1,
                }}
              />
            )}
            {/* Baseline reference image overlay on top of iframe */}
            {displayUrl && (
              <div
                id="visual-overlay"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  opacity: overlayVisible ? opacity : 0,
                  transition: "opacity 0.15s",
                  zIndex: 2,
                }}
              >
                <img
                  src={displayUrl}
                  alt="Baseline reference"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                  onError={() => setImageError(true)}
                  onLoad={() => setImageError(false)}
                />
              </div>
            )}
            {imageError && displayUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(254,242,242,0.9)",
                  color: "#b91c1c",
                  fontSize: 14,
                  zIndex: 3,
                }}
              >
                Baseline image failed to load. Ensure host allows base URL in CSP.
              </div>
            )}
          </>
        )}

        {/* Toolbar - same behavior as tools/visual-overlay */}
        {(displayUrl || blockNameTrimmed) && (
          <div
            role="toolbar"
            aria-label="Overlay controls"
            data-drag-handle-root
            onMouseDown={handleToolbarMouseDown}
            style={{
              position: "absolute",
              left: toolbarPosition.x,
              top: toolbarPosition.y,
              background: "#fff",
              padding: 10,
              borderRadius: 8,
              boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              zIndex: 10000,
              cursor: isDragging ? "grabbing" : "default",
            }}
          >
            <span
              data-drag-handle
              style={{
                cursor: "grab",
                display: "flex",
                userSelect: "none",
              }}
              aria-hidden
            >
              <GrabIcon />
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ width: 100, accentColor: "#666" }}
              aria-label="Overlay opacity"
            />
            <span style={{ fontSize: 12, color: "#555", minWidth: 36 }}>
              {Math.round(opacity * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setOverlayVisible((v) => !v)}
              aria-label={overlayVisible ? "Hide overlay" : "Show overlay"}
              style={{
                border: "1px solid #b1b1b1",
                background: "none",
                borderRadius: 4,
                padding: 4,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                color: "#555",
              }}
            >
              {overlayVisible ? <OpenEyeIcon /> : <ClosedEyeIcon />}
            </button>
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
        Drag the toolbar to move it. Use the slider to adjust overlay opacity and
        the eye icon to show/hide the baseline image.
      </p>

      {/* Visual test report section */}
      {(testReportUrl || testRunOutput || testError) && (
        <section
          style={{
            marginTop: 24,
            padding: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            background: "#fafafa",
          }}
          aria-label="Visual test report"
        >
          <h2 style={{ fontSize: 16, marginBottom: 12, marginTop: 0 }}>
            Visual test result
            {testRunSuccess === true && (
              <span style={{ color: "#059669", marginLeft: 8, fontWeight: "normal" }}>Passed</span>
            )}
            {testRunSuccess === false && (
              <span style={{ color: "#b91c1c", marginLeft: 8, fontWeight: "normal" }}>Failed</span>
            )}
          </h2>
          {testError && (
            <p style={{ fontSize: 13, color: "#b91c1c", marginBottom: 8 }}>{testError}</p>
          )}
          {testRunOutput && (
            <pre
              style={{
                fontSize: 12,
                padding: 12,
                background: "#1f2937",
                color: "#e5e7eb",
                borderRadius: 6,
                overflow: "auto",
                maxHeight: 240,
                margin: "0 0 12px 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {testRunOutput}
            </pre>
          )}
          {testReportUrl && (
            <p style={{ margin: 0, fontSize: 13 }}>
              <a
                href={testReportUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2563eb", fontWeight: 500 }}
              >
                Open Playwright report in new tab
              </a>
              {testRunSuccess === true && (
                <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 12 }}>
                  Report is also rendered in the dedicated report view.
                </span>
              )}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function GrabIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={9} cy={5} r={1} />
      <circle cx={9} cy={12} r={1} />
      <circle cx={9} cy={19} r={1} />
      <circle cx={15} cy={5} r={1} />
      <circle cx={15} cy={12} r={1} />
      <circle cx={15} cy={19} r={1} />
    </svg>
  );
}

function OpenEyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.30147 15.5771C4.77832 14.2684 3.6904 12.7726 3.18002 12C3.6904 11.2274 4.77832 9.73158 6.30147 8.42294C7.87402 7.07185 9.81574 6 12 6C14.1843 6 16.1261 7.07185 17.6986 8.42294C19.2218 9.73158 20.3097 11.2274 20.8201 12C20.3097 12.7726 19.2218 14.2684 17.6986 15.5771C16.1261 16.9282 14.1843 18 12 18C9.81574 18 7.87402 16.9282 6.30147 15.5771ZM12 4C9.14754 4 6.75717 5.39462 4.99812 6.90595C3.23268 8.42276 2.00757 10.1376 1.46387 10.9698C1.05306 11.5985 1.05306 12.4015 1.46387 13.0302C2.00757 13.8624 3.23268 15.5772 4.99812 17.0941C6.75717 18.6054 9.14754 20 12 20C14.8525 20 17.2429 18.6054 19.002 17.0941C20.7674 15.5772 21.9925 13.8624 22.5362 13.0302C22.947 12.4015 22.947 11.5985 22.5362 10.9698C21.9925 10.1376 20.7674 8.42276 19.002 6.90595C17.2429 5.39462 14.8525 4 12 4ZM10 12C10 10.8954 10.8955 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8955 14 10 13.1046 10 12ZM12 8C9.7909 8 8.00004 9.79086 8.00004 12C8.00004 14.2091 9.7909 16 12 16C14.2092 16 16 14.2091 16 12C16 9.79086 14.2092 8 12 8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClosedEyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.7071 5.70711C20.0976 5.31658 20.0976 4.68342 19.7071 4.29289C19.3166 3.90237 18.6834 3.90237 18.2929 4.29289L14.032 8.55382C13.4365 8.20193 12.7418 8 12 8C9.79086 8 8 9.79086 8 12C8 12.7418 8.20193 13.4365 8.55382 14.032L4.29289 18.2929C3.90237 18.6834 3.90237 19.3166 4.29289 19.7071C4.68342 20.0976 5.31658 20.0976 5.70711 19.7071L9.96803 15.4462C10.5635 15.7981 11.2582 16 12 16C14.2091 16 16 14.2091 16 12C16 11.2582 15.7981 10.5635 15.4462 9.96803L19.7071 5.70711Z"
        fill="currentColor"
      />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PixelGuardApp />
  </StrictMode>
);
