import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Three projects: Node.js unit tests, Web Audio tests inside Chromium, and end-to-end tests
// of the application driven by Playwright.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "node",
                    include: ["tests/**/*.test.ts"],
                    exclude: ["tests/browser/**", "tests/e2e/**"],
                },
            },
            {
                test: {
                    name: "e2e",
                    include: ["tests/e2e/**/*.test.ts"],
                    fileParallelism: false,
                },
            },
            {
                test: {
                    name: "browser",
                    include: ["tests/browser/**/*.test.ts"],
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(),
                        instances: [{ browser: "chromium" }],
                    },
                },
            },
        ],
    },
});
