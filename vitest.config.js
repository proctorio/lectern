import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.{Test,test}.js"],
		globals: true,
		environment: "jsdom",
		setupFiles: ["test/setup.js"],
		reporters: ["default", "junit"],
		outputFile: {
			junit: "./.test_output/test-results.xml"
		},
		coverage: {
			enabled: true,
			provider: "v8",
			include: ["src/js/**"],
			exclude: ["src/js/vendor/**"],
			reporter: ["text", "cobertura"],
			reportsDirectory: "./.test_output",
			thresholds: {
				branches: 80,
				statements: 80,
				functions: 80,
				lines: 80
			}
		}
	}
});
