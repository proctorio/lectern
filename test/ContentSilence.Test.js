/**
 * @description Tests the Bluetooth silence-gap keepalive in content.js. The
 * module reads the setting at import time, so this file seeds storage first
 * and imports the module dynamically to get a fresh instance with the
 * feature enabled. One sequenced test drives all keepalive branches because
 * the interval is registered once per module instance.
 */
import { vi } from "vitest";
import { registerMessageListener } from "../src/js/messaging.js";

describe("silence track keepalive", () =>
{
	it("plays and stops on the player verdict, skips without activation, survives errors", async() =>
	{
		vi.useFakeTimers();
		const activation = { hasBeenActive: true };
		vi.stubGlobal("navigator", { userActivation: activation });
		await chrome.storage.local.set({ fixBtSilenceGap: true });

		const verdicts = [true, false];
		let calls = 0;
		registerMessageListener("player", {
			shouldPlaySilence: () =>
			{
				calls++;
				if (verdicts.length) return verdicts.shift();
				throw new Error("player gone");
			}
		});

		await import("../src/js/content.js");
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toBe(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toBe(2);

		activation.hasBeenActive = false;
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toBe(2);

		activation.hasBeenActive = true;
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toBe(3);

		vi.useRealTimers();
	});
});
