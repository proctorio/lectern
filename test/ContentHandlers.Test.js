/**
 * @description Tests for content-handlers.js: the per-site routing table consumed with
 * first-match-wins semantics, each handler's validate gate, and the frame
 * pickers for embedded document viewers. Handler indices below mirror the
 * table order in the source file.
 */
import { contentHandlers } from "../src/js/content-handlers.js";
import { config } from "../src/js/defaults.js";

const UNSUPPORTED = 0;
const FILE = 1;
const GOOGLE_DOCS = 2;
const ONEDRIVE = 3;
const LUOA = 4;
const DEFAULT = 5;

/**
 * @description Parses the JSON payload the handlers throw inside Error messages.
 *
 * @param {Error} err - The thrown or rejected error.
 * @return {Object} - The parsed payload.
 */
function errorInfo(err)
{
	return JSON.parse(err.message);
}

describe("routing matrix, first match wins in table order", () =>
{
	it.each([
		["https://chromewebstore.google.com/detail/x", "", UNSUPPORTED],
		["https://addons.mozilla.org/en-US/firefox/", "", UNSUPPORTED],
		["chrome://extensions/", "", UNSUPPORTED],
		["about:blank", "", UNSUPPORTED],
		["file:///C:/docs/paper.pdf", "", FILE],
		["https://docs.google.com/document/d/abc123/edit", "", GOOGLE_DOCS],
		["https://onedrive.live.com/edit.aspx?resid=1", "Report.docx - OneDrive", ONEDRIVE],
		["https://contoso.sharepoint.com/sites/x/doc.aspx", "", ONEDRIVE],
		["https://www.dropbox.com/s/abc/notes.docx?dl=0", "", ONEDRIVE],
		["https://luoa.instructure.com/courses/123", "", LUOA],
		["https://example.com/article", "", DEFAULT],
		["https://docs.google.com/spreadsheets/d/x/edit", "", DEFAULT],
		["https://onedrive.live.com/edit.aspx?resid=1", "Slides.pptx - OneDrive", DEFAULT],
		["https://www.dropbox.com/s/abc/notes.pdf", "", DEFAULT],
		["https://luoa.instructure.com/about", "", DEFAULT]
	])("routes %s (title %s) to handler %i", (url, title, expectedIndex) =>
	{
		expect(contentHandlers.findIndex(handler => handler.match(url, title))).toBe(expectedIndex);
	});

	it("orders handlers so a specific match shadows the catch-all", () =>
	{
		const url = "https://docs.google.com/document/d/abc/edit";
		const matching = contentHandlers
			.map((handler, index) => (handler.match(url, "") ? index : -1))
			.filter(index => index >= 0);
		expect(matching).toEqual([GOOGLE_DOCS, DEFAULT]);
	});

	it("supports RegExp entries in config.unsupportedSites", () =>
	{
		config.unsupportedSites.push(/^https:\/\/blocked\.example\//u);
		try
		{
			expect(contentHandlers.findIndex(handler => handler.match("https://blocked.example/page", ""))).toBe(UNSUPPORTED);
		}
		finally
		{
			config.unsupportedSites.pop();
		}
	});
});

describe("unsupported sites handler", () =>
{
	it("always rejects the page as unreadable", () =>
	{
		let thrown = null;
		try
		{
			contentHandlers[UNSUPPORTED].validate();
		}
		catch (err)
		{
			thrown = err;
		}
		expect(errorInfo(thrown)).toEqual({ code: "error_page_unreadable" });
	});
});

describe("file scheme handler", () =>
{
	it("validates when file scheme access is granted", async() =>
	{
		chrome.__config.fileSchemeAccess = true;
		await expect(contentHandlers[FILE].validate()).resolves.toBeUndefined();
	});

	it("throws error_file_access when file scheme access is off", async() =>
	{
		chrome.__config.fileSchemeAccess = false;
		const err = await contentHandlers[FILE].validate().catch(caught => caught);
		expect(errorInfo(err)).toEqual({ code: "error_file_access" });
	});
});

describe("google docs handler", () =>
{
	const handler = contentHandlers[GOOGLE_DOCS];

	beforeEach(() =>
	{
		// The alreadyAsked latch is state on the module singleton; clear it so
		// each test exercises the handler from a fresh install state.
		delete handler.alreadyAsked;
	});

	it("asks once for the docs origin permission with a reload flag", async() =>
	{
		chrome.__config.permissionsContains = false;
		const err = await handler.validate().catch(caught => caught);
		expect(errorInfo(err)).toEqual({
			code: "error_add_permissions",
			perms: { origins: ["https://docs.google.com/document/d/"] },
			reload: true
		});

		// Second validate hits the alreadyAsked latch and passes silently even
		// though the permission is still missing.
		expect(typeof handler.validate()).toBe("undefined");
	});

	it("passes when the permission is already granted", async() =>
	{
		chrome.__config.permissionsContains = true;
		await expect(handler.validate()).resolves.toBeUndefined();
	});
});

describe("onedrive document handler", () =>
{
	const handler = contentHandlers[ONEDRIVE];

	it("requires webNavigation plus the word editor origins", async() =>
	{
		chrome.__config.permissionsContains = false;
		const err = await handler.validate().catch(caught => caught);
		const info = errorInfo(err);
		expect(info.code).toBe("error_add_permissions");
		expect(info.perms).toEqual({
			permissions: ["webNavigation"],
			origins: [
				"https://word-edit.officeapps.live.com/",
				"https://usc-word-edit.officeapps.live.com/"
			]
		});
		expect("reload" in info).toBe(false);
	});

	it("passes when permissions are granted", async() =>
	{
		chrome.__config.permissionsContains = true;
		await expect(handler.validate()).resolves.toBeUndefined();
	});

	it("picks the word editor frame from the frame list", () =>
	{
		expect(handler.getFrameId([
			{ frameId: 0,
					url: "https://onedrive.live.com/edit.aspx" },
			{ frameId: 7,
					url: "https://usc-word-edit.officeapps.live.com/we/wordeditorframe.aspx" }
		])).toBe(7);
		expect(handler.getFrameId([
			{ frameId: 3,
					url: "https://word-edit.officeapps.live.com/we/frame.aspx" }
		])).toBe(3);
		expect(typeof handler.getFrameId([{ frameId: 0,
																																						url: "https://other.example/" }])).toBe("undefined");
	});

	it("injects the onedrive content script", () =>
	{
		expect(handler.extraScripts).toEqual(["js/content/onedrive-doc.js"]);
	});
});

describe("luoa.instructure.com handler", () =>
{
	const handler = contentHandlers[LUOA];

	it("requires webNavigation plus the s3 content origin", async() =>
	{
		chrome.__config.permissionsContains = false;
		const err = await handler.validate().catch(caught => caught);
		expect(errorInfo(err)).toEqual({
			code: "error_add_permissions",
			perms: {
				permissions: ["webNavigation"],
				origins: ["https://luoa-content.s3.amazonaws.com/"]
			}
		});
	});

	it("passes when permissions are granted", async() =>
	{
		chrome.__config.permissionsContains = true;
		await expect(handler.validate()).resolves.toBeUndefined();
	});

	it("picks the s3 lesson frame, skipping frames without a url", () =>
	{
		expect(handler.getFrameId([
			{ frameId: 0,
					url: "https://luoa.instructure.com/courses/1" },
			{ frameId: 4 },
			{ frameId: 5,
					url: "https://luoa-content.s3.amazonaws.com/lesson.html" }
		])).toBe(5);
		expect(typeof handler.getFrameId([{ frameId: 0,
																																						url: "https://luoa.instructure.com/courses/1" }])).toBe("undefined");
	});
});

describe("default handler", () =>
{
	it("matches anything and imposes no validation", () =>
	{
		const handler = contentHandlers[DEFAULT];
		expect(handler.match()).toBe(true);
		expect(handler.match("chrome-error://anything", "")).toBe(true);
		expect(typeof handler.validate).toBe("undefined");
	});
});
