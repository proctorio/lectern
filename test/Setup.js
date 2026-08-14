/**
 * @description Global test setup. Stubs the chrome API and Web Speech fakes before any
 * source module is imported, so module-scope side effects in src (settings
 * observables, dark mode) run against the fakes. The chrome fake is created
 * ONCE per test file and reset in place between tests, because src modules
 * capture the reference at import time.
 */
import { vi, beforeEach } from "vitest";
import { makeChrome } from "./mocks/chrome.mock.js";
import { makeSpeechSynthesis, FakeUtterance, FakeAudio } from "./mocks/speech_synthesis.mock.js";

const chromeFake = makeChrome();
vi.stubGlobal("chrome", chromeFake);
vi.stubGlobal("speechSynthesis", makeSpeechSynthesis());
vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
vi.stubGlobal("Audio", FakeAudio);

beforeEach(() =>
{
	chromeFake.__reset();
	vi.stubGlobal("speechSynthesis", makeSpeechSynthesis());
});
