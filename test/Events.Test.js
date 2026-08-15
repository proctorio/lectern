/**
 * @description Tests for the service worker's context menu unification
 * (finding F8): top-frame selection clicks route through playTab so the
 * content script reads the selection with structure preserved, and the
 * flattened selection text is used only where injection is impossible.
 * Importing events.js registers its listeners against the chrome fake, and
 * the tests drive them through contextMenus.onClicked exactly as chrome
 * would.
 */
import { vi } from "vitest";
import { registerMessageListener } from "../src/js/messaging.js";
import { isTopFrameClick, isInjectionBlocked } from "../src/js/events.js";

/**
 * @description Lets the fire-and-forget context menu handler chain settle
 * by yielding a bounded number of macrotask turns.
 *
 * @param {number} [turns] - The number of turns to yield.
 * @return {Promise<void>} - Resolves when the turns have elapsed.
 */
function settle(turns = 10)
{
	let chain = Promise.resolve();
	for (let i = 0; i < turns; i++)
	{
		chain = chain.then(() => new Promise(resolve => setTimeout(resolve, 0)));
	}

	return chain;
}

/**
 * @description Registers a scripted player endpoint that reports an already
 * existing player and records playTab and playText calls.
 *
 * @param {Function} [playTabImpl] - Optional playTab behavior override.
 * @return {Object} - The recorded calls.
 */
function fakePlayer(playTabImpl)
{
	const calls = { playTab: [],
																	playText: [] };
	registerMessageListener("player", {
		stop: () => true,
		playTab()
		{
			if (playTabImpl) return playTabImpl();
			calls.playTab.push([]);

			return null;
		},
		playText(text, opts)
		{
			calls.playText.push([text, opts]);

			return null;
		}
	});

	return calls;
}

/**
 * @description Emits a read-selection context menu click against the
 * listener events.js registered at import time.
 *
 * @param {Object} overrides - OnClickData overrides.
 * @param {?Object} tab - The tab the click happened in.
 */
function clickReadSelection(overrides, tab)
{
	chrome.contextMenus.onClicked.emit({
		menuItemId: "read-selection",
		selectionText: "Selected words",
		frameId: 0,
		...overrides
	}, tab);
}

describe("context menu read-selection", () =>
{
	it("routes a top-frame selection click through playTab", async() =>
	{
		const calls = fakePlayer();
		clickReadSelection({}, chrome.tabs.__tabs[0]);
		await settle();

		expect(calls.playTab).toHaveLength(1);
		expect(calls.playText).toHaveLength(0);
		const { sourceUri } = await chrome.storage.local.get(["sourceUri"]);
		expect(sourceUri).toBe("contentscript:1");
	});

	it("falls back to the flattened selection text on unscriptable pages", async() =>
	{
		chrome.tabs.__tabs[0].url = "chrome://settings/";
		const calls = fakePlayer();
		clickReadSelection({}, chrome.tabs.__tabs[0]);
		await settle();

		expect(calls.playTab).toHaveLength(0);
		expect(calls.playText).toEqual([["Selected words", { lang: "en" }]]);
	});

	it("falls back when the selection click came from a subframe", async() =>
	{
		const calls = fakePlayer();
		clickReadSelection({ frameId: 7 }, chrome.tabs.__tabs[0]);
		await settle();

		expect(calls.playTab).toHaveLength(0);
		expect(calls.playText).toHaveLength(1);
	});

	it("does not fall back on errors that are not injection failures", async() =>
	{
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => null);
		const calls = fakePlayer(() =>
		{
			throw new Error("engine exploded");
		});
		clickReadSelection({}, chrome.tabs.__tabs[0]);
		await settle();

		expect(calls.playText).toHaveLength(0);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("isInjectionBlocked", () =>
{
	it("matches the unreadable, file access, and permission validations", () =>
	{
		for (const code of ["error_page_unreadable", "error_file_access", "error_add_permissions"])
		{
			expect(isInjectionBlocked(new Error(JSON.stringify({ code })))).toBe(true);
		}
	});

	it("matches browser injection refusals", () =>
	{
		expect(isInjectionBlocked(new Error("Cannot access a chrome:// URL"))).toBe(true);
		expect(isInjectionBlocked(new Error("Cannot access contents of the page."))).toBe(true);
		expect(isInjectionBlocked(new Error("The extensions gallery cannot be scripted."))).toBe(true);
		expect(isInjectionBlocked(new Error("Missing host permission for the tab"))).toBe(true);
	});

	it("does not match playback errors or empty values", () =>
	{
		expect(isInjectionBlocked(new Error("TTS voice missing"))).toBe(false);
		expect(isInjectionBlocked(null)).toBe(false);
		expect(isInjectionBlocked({})).toBe(false);
	});
});

describe("isTopFrameClick", () =>
{
	it("treats frame zero and a missing frame id as top frame", () =>
	{
		expect(isTopFrameClick({ frameId: 0 })).toBe(true);
		expect(isTopFrameClick({})).toBe(true);
	});

	it("treats a nonzero frame id as a subframe", () =>
	{
		expect(isTopFrameClick({ frameId: 7 })).toBe(false);
	});
});
