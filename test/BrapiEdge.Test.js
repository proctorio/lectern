/**
 * @description Exercises the brapi resolution fallbacks in a fresh module
 * realm: this file unstubs chrome before importing so the browser and empty
 * fallbacks are reachable.
 */
import { vi } from "vitest";

describe("brapi fallback resolution", () =>
{
	it("falls back to the browser global when chrome is absent", async() =>
	{
		const fakeBrowser = { runtime: { id: "firefoxish" } };
		vi.stubGlobal("chrome", {}.missing);
		vi.stubGlobal("browser", fakeBrowser);

		const { brapi } = await import("../src/js/brapi.js");
		expect(brapi.runtime.id).toBe("firefoxish");
	});
});
