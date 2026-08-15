/**
 * Exam-safe mode and the F6 overlay announcement channel (milestone M5).
 * The overlay selector constant ships empty pending decision D15, so these
 * tests configure the temporary examOverlaySelector storage override, turn
 * exam-safe mode on through chrome.storage exactly as the options page
 * would, and drive the built extension end to end.
 *
 * Honest-assertion note: this suite asserts message round trips and the
 * player's state transitions (PLAYING to PAUSED while the announcement
 * speaks, back to PLAYING afterwards). Audible output itself cannot be
 * asserted from Playwright; the state transitions plus an error-free
 * announce round trip are the strongest observable evidence available.
 */
import { test, expect } from "@playwright/test";
import { launchWithExtension } from "./Harness.js";

const FIXTURE_ORIGIN = "http://localhost:8123";
const OVERLAY_TEXT_MARKER = "Exam paused by your proctor";

/**
 * @description Opens the extension popup page, which provides a stable
 * chrome-extension origin for storage writes and runtime messages.
 *
 * @param {Object} context - The persistent browser context.
 * @param {string} extensionId - The extension id.
 * @return {Promise<Object>} - The popup page.
 */
async function openPopupPage(context, extensionId)
{
	const popup = await context.newPage();
	await popup.goto(`chrome-extension://${extensionId}/popup.html?isPopup=1`);

	return popup;
}

/**
 * @description Starts reading the currently active tab through the service
 * worker, the same message the toolbar popup sends.
 *
 * @param {Object} popup - The popup page.
 * @return {Promise<Object>} - The service worker response.
 */
function playActiveTab(popup)
{
	return popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "playTab",
																																																										args: [] }));
}

/**
 * @description Polls the playback state until it reaches one of the target
 * states or reports a playback error, then returns the final state info.
 *
 * @param {Object} popup - The popup page.
 * @param {Array<string>} targets - The acceptable target states.
 * @param {number} intervalMillis - The polling interval in milliseconds.
 * @param {number} attemptsLeft - The number of polls remaining.
 * @return {Promise<Object>} - The playback state info.
 */
async function waitForState(popup, targets, intervalMillis = 250, attemptsLeft = 60)
{
	const info = await popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																																						method: "getPlaybackState",
																																																																						args: [] }));
	if (info && (targets.includes(info.state) || info.playbackError)) return info;
	if (attemptsLeft <= 1) return info;
	await popup.waitForTimeout(intervalMillis);

	return waitForState(popup, targets, intervalMillis, attemptsLeft - 1);
}

/**
 * @description Stops playback through the service worker.
 *
 * @param {Object} popup - The popup page.
 * @return {Promise<Object>} - The service worker response.
 */
function stopPlayback(popup)
{
	return popup.evaluate(() => chrome.runtime.sendMessage({ dest: "serviceWorker",
																																																										method: "stop",
																																																										args: [] }));
}

test.describe("exam-safe mode", () =>
{
	test("the overlay observer announces: playback pauses, then resumes, and nothing read persists", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const popup = await openPopupPage(context, extensionId);

		// Exam-safe mode on plus the D15 placeholder selector override, set
		// before the content script is injected so it wires the observer.
		await popup.evaluate(() => chrome.storage.local.set({ examSafeMode: true,
																																																								examOverlaySelector: "#exam-overlay" }));

		const page = await context.newPage();
		await page.goto(`${FIXTURE_ORIGIN}/overlay.html`);
		await page.bringToFront();
		await playActiveTab(popup);

		// Whichever comes first: normal playback, or the announcement already
		// pausing it (the fixture appends the overlay one second after load,
		// which can beat this poll when injection is quick).
		const started = await waitForState(popup, ["PLAYING", "PAUSED"]);
		expect(started && started.playbackError).toBeFalsy();
		expect(["PLAYING", "PAUSED"]).toContain(started && started.state);

		if (started.state !== "PAUSED")
		{
			// Nudge the DOM once: the observer only sees mutations after the
			// content script attached, so this guarantees a check runs even
			// when the overlay landed before injection finished.
			await page.waitForSelector("#exam-overlay", { state: "attached" });
			await page.evaluate(() => document.body.appendChild(document.createTextNode("")));
		}

		// The announcement pauses the document while it speaks...
		const paused = await waitForState(popup, ["PAUSED"], 150, 100);
		expect(paused && paused.state).toBe("PAUSED");

		// ...and seeks back into playback once the utterance ends.
		const resumed = await waitForState(popup, ["PLAYING"], 250, 120);
		expect(resumed && resumed.playbackError).toBeFalsy();
		expect(resumed && resumed.state).toBe("PLAYING");

		// Exam-safe invariant: neither the page text nor the announcement is
		// persisted anywhere in extension storage.
		const stored = await popup.evaluate(() => chrome.storage.local.get(null));
		const storedJson = JSON.stringify(stored);
		expect(storedJson).not.toContain(OVERLAY_TEXT_MARKER);
		expect(storedJson).not.toContain("passage");

		await stopPlayback(popup);
		await context.close();
	});

	test("announce round trips through the player channel without error", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const popup = await openPopupPage(context, extensionId);

		const page = await context.newPage();
		await page.goto(`${FIXTURE_ORIGIN}/article.html`);
		await page.bringToFront();
		await playActiveTab(popup);
		const playing = await waitForState(popup, ["PLAYING"]);
		expect(playing && playing.state).toBe("PLAYING");

		// Fire announce directly at the player and observe the pause window
		// while the announcement utterance is in flight.
		const announcePromise = popup.evaluate(() => chrome.runtime.sendMessage({ dest: "player",
																																																																												method: "announce",
																																																																												args: ["Attention. This is a direct announcement round trip test."] }));
		const paused = await waitForState(popup, ["PAUSED"], 150, 100);
		expect(paused && paused.state).toBe("PAUSED");

		const response = await announcePromise;
		expect(response && response.error).toBeFalsy();

		const resumed = await waitForState(popup, ["PLAYING"], 250, 120);
		expect(resumed && resumed.state).toBe("PLAYING");

		await stopPlayback(popup);
		await context.close();
	});

	test("refuses to read a tab that is not the active tab", async() =>
	{
		const { context, extensionId } = await launchWithExtension();
		const popup = await openPopupPage(context, extensionId);
		await popup.evaluate(() => chrome.storage.local.set({ examSafeMode: true }));

		const background = await context.newPage();
		await background.goto(`${FIXTURE_ORIGIN}/article.html`);
		const foreground = await context.newPage();
		await foreground.goto(`${FIXTURE_ORIGIN}/overlay.html`);
		await foreground.bringToFront();

		const response = await popup.evaluate(async origin =>
		{
			const [active] = await chrome.tabs.query({ active: true,
																																														lastFocusedWindow: true });
			const tabs = await chrome.tabs.query({ url: `${origin}/*` });
			const inactive = tabs.find(tab => tab.id !== active.id);

			return chrome.runtime.sendMessage({ dest: "serviceWorker",
																																							method: "playTab",
																																							args: [inactive.id] });
		}, FIXTURE_ORIGIN);

		expect(response && response.error && response.error.message).toContain("error_exam_safe_tab");
		await context.close();
	});
});
