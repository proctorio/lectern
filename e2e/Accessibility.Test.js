/**
 * Axe gates for the extension pages. The phase 6 (accessibility hardening)
 * gate is active: every scanned page must report ZERO axe violations in both
 * the light and dark themes, per docs/lectern/05-accessibility-spec.md
 * ("Zero violations, not 'zero criticals.'"). Violation JSON attaches to the
 * report whenever a scan finds anything, so failures stay debuggable.
 * Phase 3.5's non-failing baseline recording lived here before the flip.
 */
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { launchWithExtension } from "./Harness.js";

// Every page a user can reach. The popup is scanned in its toolbar-popup
// form; shortcuts.html is only reachable on non-Chromium browsers, so the
// Chrome-facing surface is these four.
const GATED_PAGES = [
	"popup.html?isPopup=1",
	"options.html",
	"languages.html",
	"advanced-options.html"
];

/**
 * @description Runs axe against an extension page in one theme and attaches
 * the findings when there are any.
 *
 * @param {Object} context - The persistent browser context.
 * @param {string} extensionId - The extension id.
 * @param {string} pagePath - The extension-relative page path.
 * @param {string} theme - Either "light" or "dark".
 * @param {Object} info - The Playwright test info for attachments.
 * @return {Promise<Array>} - The axe violations.
 */
async function scanPage(context, extensionId, pagePath, theme, info)
{
	const page = await context.newPage();
	await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
	await page.waitForTimeout(500);

	// Dark mode is a body class the pages toggle themselves (defaults.js);
	// forcing it scans the exact selectors real dark mode uses.
	if (theme == "dark")
	{
		await page.evaluate(() => document.body.classList.add("dark-mode"));
	}

	const results = await new AxeBuilder({ page }).analyze();
	if (results.violations.length > 0)
	{
		await info.attach(`axe-${theme}-${pagePath.replaceAll(/[^a-z]/gu, "-")}`, {
			body: JSON.stringify(results.violations, null, 2),
			contentType: "application/json"
		});
		for (const violation of results.violations)
		{
			console.info(`axe ${pagePath} [${theme}]: ${violation.id} (${violation.impact}) x${violation.nodes.length}`);
		}
	}
	await page.close();

	return results.violations;
}

test.describe("accessibility gates", () =>
{
	test("axe reports zero violations on every page in both themes", async() =>
	{
		test.setTimeout(120000);
		const info = test.info();
		const { context, extensionId } = await launchWithExtension();

		// Each scan runs in its own page, so the page/theme matrix runs
		// concurrently inside the one context.
		const scans = await Promise.all(GATED_PAGES.flatMap(pagePath => ["light", "dark"].map(theme =>
			scanPage(context, extensionId, pagePath, theme, info)
				.then(violations => ({ pagePath,
																											theme,
																											violations })))));

		for (const { pagePath, theme, violations } of scans)
		{
			// Soft so every page's result reports even when one fails; the
			// test itself fails hard on any violation.
			expect.soft(violations.length, `${pagePath} [${theme}] axe violations`).toBe(0);
		}
		await context.close();
	});

	test("popup reflows at 320 CSS pixels without horizontal scroll", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const page = await context.newPage();
		await page.setViewportSize({ width: 320,
																															height: 600 });
		await page.goto(`chrome-extension://${extensionId}/popup.html?isPopup=1`);
		await page.waitForTimeout(500);

		// The playback surfaces only appear during playback, which the
		// harness cannot start (no TTS voices), so they are forced visible
		// with representative content before measuring.
		await page.evaluate(() =>
		{
			document.body.classList.add("is-popup");
			const highlight = document.getElementById("highlight");
			highlight.style.display = "block";
			highlight.textContent = "Representative sentence long enough to need wrapping at narrow widths.";
			document.getElementById("toolbar").style.display = "flex";
			document.getElementById("status").style.display = "block";
			document.getElementById("status").textContent = "Representative error text";
			for (const control of document.querySelectorAll("#buttons button, #imgLoading"))
			{
				control.style.display = "inline-block";
			}
		});

		const metrics = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth
		}));
		expect(metrics.scrollWidth, "horizontal overflow at 320px").toBeLessThanOrEqual(metrics.clientWidth);
		await context.close();
	});
});

test.describe("accessibility during playback", () =>
{
	test("axe reports zero violations on the popup while reading", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const article = await context.newPage();
		await article.goto("http://localhost:8123/article.html");

		const popup = await context.newPage();
		await popup.goto(`chrome-extension://${extensionId}/popup.html?isPopup=1`);
		await article.bringToFront();
		await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "playTab",
																																																										args: [] }));
		await popup.waitForTimeout(2500);

		const results = await new AxeBuilder({ page: popup }).analyze();
		for (const violation of results.violations)
		{
			console.info(`axe popup playing: ${violation.id} (${violation.impact}) x${violation.nodes.length}`);
		}
		expect(results.violations.length).toBe(0);
		await context.close();
	});
});
