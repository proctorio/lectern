/**
 * @description Exemplar test file: establishes the pattern for the suite. Source modules
 * are imported normally (setup.js has already stubbed chrome), the fake is
 * reached through the global, and every behavior assertion targets the unit,
 * not the mock.
 */
import { registerMessageListener, errorToJson } from "../src/js/messaging.js";

describe("registerMessageListener", () =>
{
	it("dispatches by dest and method and returns the handler result", async() =>
	{
		registerMessageListener("unitA", {
			echo: (a, b) => a + b
		});

		const result = await chrome.runtime.sendMessage({ dest: "unitA",
																																																				method: "echo",
																																																				args: [1, 2] });
		expect(result).toBe(3);
	});

	it("ignores messages addressed to another dest", async() =>
	{
		registerMessageListener("unitA", {
			echo: () => "answered"
		});

		const result = await chrome.runtime.sendMessage({ dest: "unitB",
																																																				method: "echo",
																																																				args: [] });
		expect(result).toBeUndefined();
	});

	it("responds with a serialized error for an unknown method", async() =>
	{
		registerMessageListener("unitA", {});

		const result = await chrome.runtime.sendMessage({ dest: "unitA",
																																																				method: "nope",
																																																				args: [] });
		expect(result.error.message).toBe("Bad method nope");
	});

	it("serializes handler rejections through errorToJson", async() =>
	{
		registerMessageListener("unitA", {
			boom: () =>
			{
				throw new TypeError("kaput");
			}
		});

		const result = await chrome.runtime.sendMessage({ dest: "unitA",
																																																				method: "boom",
																																																				args: [] });
		expect(result.error.name).toBe("TypeError");
		expect(result.error.message).toBe("kaput");
	});
});

describe("errorToJson", () =>
{
	it("maps an Error to name, message and stack", () =>
	{
		const json = errorToJson(new RangeError("out of range"));
		expect(json.name).toBe("RangeError");
		expect(json.message).toBe("out of range");
		expect(typeof json.stack).toBe("string");
	});

	it("passes non Error values through unchanged", () =>
	{
		expect(errorToJson({ code: "x" })).toEqual({ code: "x" });
	});
});
