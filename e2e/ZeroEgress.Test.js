/**
 * The zero-egress gate as an automated test: load the built extension in real
 * Chromium, exercise the read pipeline and every extension page, and assert
 * that no network request leaves the browser except the fixture origin and
 * the extension's own resources. This automates the manual DevTools gate in
 * CLAUDE.md and permanently pins the phase 2 de-linking.
 */
import { test, expect } from "@playwright/test";
import { launchWithExtension } from "./Harness.js";

const FIXTURE_ORIGIN = "http://localhost:8123";

/**
 * @description Decides whether a request URL is allowed under the zero-egress
 * contract.
 *
 * @param {string} url - The request URL.
 * @return {boolean} - True when the URL is an allowed origin.
 */
function isAllowed(url)
{
	return url.startsWith("chrome-extension://") ||
		url.startsWith(FIXTURE_ORIGIN) ||
		url.startsWith("data:") ||
		url.startsWith("blob:") ||
		url.startsWith("about:") ||
		url.startsWith("chrome://");
}

test.describe("zero egress", () =>
{
	test("reading a page produces no outbound network requests", async() =>
	{
		const { context, extensionId, worker } = await launchWithExtension();
		const offenders = [];
		context.on("request", request =>
		{
			if (!isAllowed(request.url())) offenders.push(request.url());
		});

		const article = await context.newPage();
		await article.goto(`${FIXTURE_ORIGIN}/article.html`);

		const popup = await context.newPage();
		await popup.goto(`chrome-extension://${extensionId}/popup.html?isPopup=1`);
		await article.bringToFront();

		await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "playTab",
																																																										args: [] }));

		await article.waitForSelector("iframe[src^='chrome-extension://']", { state: "attached",
																																																																								timeout: 10000 });
		await article.waitForTimeout(1500);

		const state = await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																																								method: "getPlaybackState",
																																																																								args: [] }));
		expect(state).toBeTruthy();

		await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "stop",
																																																										args: [] }));

		const options = await context.newPage();
		await options.goto(`chrome-extension://${extensionId}/options.html`);
		await options.waitForTimeout(500);

		expect(worker.url()).toContain(extensionId);
		expect(offenders).toEqual([]);
		await context.close();
	});

	test("the page DOM stays untouched until a read is invoked", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const article = await context.newPage();
		await article.goto(`${FIXTURE_ORIGIN}/article.html`);
		await article.waitForTimeout(1000);

		const before = await article.locator("iframe").count();
		expect(before).toBe(0);

		const popup = await context.newPage();
		await popup.goto(`chrome-extension://${extensionId}/popup.html?isPopup=1`);
		await article.bringToFront();
		await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "playTab",
																																																										args: [] }));

		await article.waitForSelector("iframe[src^='chrome-extension://']", { state: "attached",
																																																																								timeout: 10000 });
		await context.close();
	});
});
