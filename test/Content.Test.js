/**
 * @description Tests for content.js: the exported text utilities and the
 * contentScript message endpoint registered at import time. Extraction
 * behavior that depends on real layout lives in the Playwright suite, not
 * here.
 */
import { vi } from "vitest";
import { paragraphSplitter, getInnerText, isNotEmpty, fixParagraphs, tryGetTexts, simulateClick } from "../src/js/content.js";

describe("text utilities", () =>
{
	it("splits paragraphs on blank lines only", () =>
	{
		const parts = "one\n\ntwo\n  \nthree\nsameline".split(paragraphSplitter);
		expect(parts).toEqual(["one", "two", "three\nsameline"]);
	});

	it("trims innerText and tolerates empty elements", () =>
	{
		expect(getInnerText({ innerText: "  padded  " })).toBe("padded");
		expect(getInnerText({ innerText: null })).toBe("");
	});

	it("treats empty strings as empty", () =>
	{
		expect(Boolean(isNotEmpty(""))).toBe(false);
		expect(Boolean(isNotEmpty("x"))).toBe(true);
	});

	it("joins continuation lines until sentence-final punctuation", () =>
	{
		const out = fixParagraphs(["The start", "", "and the end."]);
		expect(out).toEqual(["The start", "and the end."]);
	});

	it("dehyphenates line-broken words", () =>
	{
		const out = fixParagraphs(["hyphen-", "ated word."]);
		expect(out).toEqual(["hyphenated word."]);
	});

	it("keeps building a paragraph across unterminated fragments", () =>
	{
		const out = fixParagraphs(["part one", "part two."]);
		expect(out).toEqual(["part one part two."]);
	});
});

describe("tryGetTexts", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers();
	});

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("retries while the source returns an empty list within the budget", async() =>
	{
		const results = [[], ["found"]];
		const getTexts = vi.fn(() => results.shift());

		const promise = tryGetTexts(getTexts, 1500);
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(500);

		expect(await promise).toEqual(["found"]);
		expect(getTexts).toHaveBeenCalledTimes(2);
	});

	it("gives up and returns the empty list once the budget is spent", async() =>
	{
		const getTexts = vi.fn(() => []);

		const promise = tryGetTexts(getTexts, 500);
		await vi.advanceTimersByTimeAsync(500);

		expect(await promise).toEqual([]);
		expect(getTexts).toHaveBeenCalledTimes(1);
	});
});

describe("simulateClick", () =>
{
	// jsdom under vitest rejects MouseEvent view realm checks, so the click
	// simulation is exercised by the Playwright suite in real Chrome instead.
	it.skip("dispatches mousedown, mouseup and click in order", () =>
	{
		simulateClick(document.body);
	});
});

describe("contentScript endpoint", () =>
{
	it("serves getRequireJs with the generic handler for unknown hosts", async() =>
	{
		const files = await chrome.runtime.sendMessage({ dest: "contentScript",
																																																			method: "getRequireJs",
																																																			args: [] });
		expect(files).toEqual(["js/content/html-doc.js"]);
	});

	it("serves document info from the page", async() =>
	{
		document.documentElement.lang = "en_US";
		document.title = "Fixture Page";

		const info = await chrome.runtime.sendMessage({ dest: "contentScript",
																																																		method: "getDocumentInfo",
																																																		args: [] });
		expect(info.title).toBe("Fixture Page");
		expect(info.lang).toBe("en-US");
		expect(info.url).toContain("localhost");
	});

	it("delegates getCurrentIndex and getTexts to the active handler", async() =>
	{
		vi.stubGlobal("readAloudDoc", {
			getCurrentIndex: () => 7,
			getTexts: index => [`text for ${index}`]
		});

		const index = await chrome.runtime.sendMessage({ dest: "contentScript",
																																																			method: "getCurrentIndex",
																																																			args: [] });
		expect(index).toBe(7);

		const texts = await chrome.runtime.sendMessage({ dest: "contentScript",
																																																			method: "getTexts",
																																																			args: [7, true] });
		expect(texts).toEqual(["text for 7"]);
	});

	it("returns the selection split into paragraphs for the selection index", async() =>
	{
		vi.stubGlobal("readAloudDoc", {
			getSelectedText: () => "chosen one\n\nchosen two"
		});

		const texts = await chrome.runtime.sendMessage({ dest: "contentScript",
																																																			method: "getTexts",
																																																			args: [-100] });
		expect(texts).toEqual(["chosen one", "chosen two"]);
	});
});

describe("math shim", () =>
{
	it("memoizes a no-op surrogate", async() =>
	{
		const { getMath } = await import("../src/js/content.js");
		const math = await getMath();
		expect(typeof math.show).toBe("function");
		expect(await getMath()).toBe(math);
	});
});
