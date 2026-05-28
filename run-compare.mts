import { comparePages } from "./compare-pages.ts";

const result = await comparePages({
  sourceUrl: process.argv[2]!,
  destinationUrl: process.argv[3]!,
  viewport: (process.argv[4] as "desktop" | undefined) ?? "desktop",
});

console.log(
  JSON.stringify(
    {
      reportId: result.reportId,
      status: result.status,
      summary: result.summary,
      diffPixelRatio: result.diffPixelRatio,
      diffPixelCount: result.diffPixelCount,
      totalPixels: result.totalPixels,
      dimensions: result.dimensions,
      sourceUrl: result.sourceUrl,
      destinationUrl: result.destinationUrl,
      reportUrl: `http://localhost:3003${result.reportBasePath}/manifest.json`,
      reportBasePath: result.reportBasePath,
    },
    null,
    2
  )
);
