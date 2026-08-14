/**
 * @description Tests for brapi resolution. In the test environment the chrome global is
 * stubbed by setup before import, so brapi must resolve to that exact object,
 * which is the identity every other module test relies on.
 */
import { brapi } from "../src/js/brapi.js";

describe("brapi", () =>
{
	it("resolves to the global chrome object when chrome is present", () =>
	{
		expect(brapi).toBe(chrome);
	});

	it("exposes the extension API surface through the resolved object", () =>
	{
		expect(typeof brapi.runtime.getManifest).toBe("function");
		expect(typeof brapi.storage.local.get).toBe("function");
	});
});
