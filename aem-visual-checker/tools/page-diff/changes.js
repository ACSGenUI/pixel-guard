// aem-visual-checker/tools/page-diff/changes.js
export const scripts = {
  "test:page-diff:compare": "node tools/page-diff/compare-page-diff.js",
  "test:page-diff:localize": "node tools/page-diff/localize-page-diff.js"
};

export const dependenciesToAdd = {
  "playwright": "1.53.1",
  "pixelmatch": "^5.3.0",
  "pngjs": "^7.0.0"
};

export const gitignoreLines = [
  "tools/page-diff/runs/"
];

export const hlxignoreLines = ["tools/page-diff/*"];
