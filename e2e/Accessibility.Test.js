/**
 * Axe scans of the extension pages. Phase 3.5 records the baseline as test
 * attachments without failing; phase 6 (accessibility hardening) flips these
 * to hard zero-violation gates per docs/lectern/05-accessibility-spec.md.
 */
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { launchWithExtension } from "./Harness.js";

/**
 * @description Runs axe against an extension page and attaches the findings.
 *
 * @param {Object} context - The persistent browser context.
 * @param {string} extensionId - The extension id.
 * @param {string} pagePath - The extension-relative page path.
 * @param {Object} info - The Playwright test info for attachments.
 * @return {Promise<number>} - The violation count.
 */
async function scanPage(context, extensionId, pagePath, info)
{
	const page = await context.newPage();
	await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
	await page.waitForTimeout(500);

	const results = await new AxeBuilder({ page }).analyze();
	await info.attach(`axe-${pagePath.replaceAll(/[^a-z]/gu, "-")}`, {
		body: JSON.stringify(results.violations, null, 2),
		contentType: "application/json"
	});
	for (const violation of results.violations)
	{
		console.info(`axe ${pagePath}: ${violation.id} (${violation.impact}) x${violation.nodes.length}`);
	}

	return results.violations.length;
}

test.describe("accessibility baseline", () =>
{
	test("records axe findings for popup and options", async() =>
	{
		const info = test.info();
		const { context, extensionId } = await launchWithExtension();

		const popupViolations = await scanPage(context, extensionId, "popup.html?isPopup=1", info);
		const optionsViolations = await scanPage(context, extensionId, "options.html", info);

		// Baseline recording only. Phase 6 replaces this with toBe(0) gates.
		expect(popupViolations).toBeGreaterThanOrEqual(0);
		expect(optionsViolations).toBeGreaterThanOrEqual(0);
		await context.close();
	});
});
