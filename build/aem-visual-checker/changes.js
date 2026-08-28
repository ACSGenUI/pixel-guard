export const scripts = {
    "test:visual:figma": "node tools/visual-tests/figma-util.js",
    "test:visual:report": "playwright show-report tools/visual-tests/playwright-report",
    "test:visual:server": "node tools/visual-tests/start-visual-test-server.js",
    "start": "concurrently -k \"npm run test:visual:server\" \"aem up\" --kill-others-on-fail",
    "test:visual:build": "docker compose -f tools/visual-tests/docker-compose.yml build",
    "test:visual": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright",
    "test:visual:update": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright npx playwright test --config=tools/visual-tests/playwright.config.ts --update-snapshots",
    "test:visual:block": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright npx playwright test --config=tools/visual-tests/playwright.config.ts",
    "test:visual:generate": "docker compose -f tools/visual-tests/docker-compose.yml run --rm playwright node tools/visual-tests/generate-visual-tests.js"
};
export const dependenciesToAdd = {
    "@playwright/test": "1.53.1",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "playwright": "1.53.1"
};
export const devDependenciesToAdd = {
    "concurrently": "^8.2.2",
    "husky": "^8.0.3"
};
export const gitignoreLines = [
    "tools/visual-tests/port.txt",
    "playwright-report/",
    "test-results/",
    "tools/visual-tests/playwright-report/",
    "tools/visual-tests/test-results/",
    ".env",
    ".env.local"
];
export const hlxignoreLines = ["tools/visual-tests/*"];
