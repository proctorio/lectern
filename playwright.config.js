import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	testMatch: /.*\.Test\.js$/u,
	fullyParallel: false,
	workers: 1,
	reporter: [["list"], ["junit", { outputFile: ".test_output/e2e-results.xml" }]],
	use: {
		trace: "retain-on-failure"
	},
	webServer: {
		command: "node tools/fixture-server.js",
		port: 8123,
		reuseExistingServer: true
	}
});
