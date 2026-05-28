import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { getPageComparisonReportBasePath, getReportDir, PROJECT_ROOT } from "./paths.js";
export { PAGE_COMPARE_REPORTS_DIR, PROJECT_ROOT } from "./paths.js";
export const PAGE_COMPARE_VIEWPORTS = ["mobile", "tablet", "desktop", "large"];
export const VIEWPORT_PRESETS = {
    mobile: { width: 320, height: 568 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1024, height: 768 },
    large: { width: 1440, height: 900 },
};
function padImageToSize(img, targetWidth, targetHeight) {
    if (img.width === targetWidth && img.height === targetHeight) {
        return img;
    }
    const padded = new PNG({ width: targetWidth, height: targetHeight });
    PNG.bitblt(img, padded, 0, 0, img.width, img.height, 0, 0);
    return padded;
}
function comparePngBuffers(sourceImg, destImg) {
    const targetWidth = Math.max(sourceImg.width, destImg.width);
    const targetHeight = Math.max(sourceImg.height, destImg.height);
    const src = padImageToSize(sourceImg, targetWidth, targetHeight);
    const dst = padImageToSize(destImg, targetWidth, targetHeight);
    const diff = new PNG({ width: targetWidth, height: targetHeight });
    const diffPixels = pixelmatch(src.data, dst.data, diff.data, targetWidth, targetHeight, { threshold: 0.1 });
    const totalPixels = targetWidth * targetHeight;
    const diffPixelRatio = totalPixels > 0 ? diffPixels / totalPixels : 0;
    return {
        diff,
        diffPixels,
        totalPixels,
        diffPixelRatio,
        width: targetWidth,
        height: targetHeight,
    };
}
/**
 * Capture two page URLs with Playwright, compare screenshots, write report artifacts.
 * Runs entirely inside Pixel Guard — no visual-test server required.
 */
export async function comparePages({ sourceUrl, destinationUrl, viewport = "desktop", maxDiffPixelRatio = 0.01, fullPage = true, }) {
    const preset = VIEWPORT_PRESETS[viewport] ?? VIEWPORT_PRESETS.desktop;
    const reportId = `page-compare-${Date.now()}`;
    const reportDir = getReportDir(reportId);
    await fs.mkdir(reportDir, { recursive: true });
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: preset.width, height: preset.height },
        });
        async function capture(url, name) {
            const page = await context.newPage();
            await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
            const filePath = path.join(reportDir, `${name}.png`);
            await page.screenshot({ path: filePath, fullPage });
            await page.close();
            return filePath;
        }
        await capture(sourceUrl, "source");
        await capture(destinationUrl, "destination");
        const sourceBuf = await fs.readFile(path.join(reportDir, "source.png"));
        const destBuf = await fs.readFile(path.join(reportDir, "destination.png"));
        const sourceImg = PNG.sync.read(sourceBuf);
        const destImg = PNG.sync.read(destBuf);
        const { diff, diffPixels, totalPixels, diffPixelRatio, width, height } = comparePngBuffers(sourceImg, destImg);
        await fs.writeFile(path.join(reportDir, "diff.png"), PNG.sync.write(diff));
        const status = diffPixelRatio <= maxDiffPixelRatio ? "passed" : "failed";
        const summary = `${(diffPixelRatio * 100).toFixed(2)}% of pixels differ (threshold ${(maxDiffPixelRatio * 100).toFixed(2)}%).`;
        const manifest = {
            reportId,
            status,
            sourceUrl,
            destinationUrl,
            viewport: preset,
            viewportName: viewport,
            diffPixelCount: diffPixels,
            diffPixelRatio,
            maxDiffPixelRatio,
            totalPixels,
            dimensions: { width, height },
            summary,
            artifacts: {
                source: "source.png",
                destination: "destination.png",
                diff: "diff.png",
            },
            createdAt: new Date().toISOString(),
            projectRoot: PROJECT_ROOT,
        };
        await fs.writeFile(path.join(reportDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
        return {
            ...manifest,
            reportDir,
            reportBasePath: getPageComparisonReportBasePath(reportId),
        };
    }
    finally {
        await browser.close();
    }
}
