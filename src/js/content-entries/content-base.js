import { brapi } from "../brapi.js";
import { getSettings, updateSettings, waitMillis, repeat } from "../defaults.js";
import { paragraphSplitter, getInnerText, isNotEmpty, fixParagraphs, tryGetTexts, simulateMouseEvent, simulateClick, getMath } from "../content.js";

//The per-site handler files under js/content/ stay classic scripts and are
//injected separately, so everything they consume must remain a global in the
//content script world, exactly as when defaults.js, messaging.js, and
//content.js were injected as classic scripts. brapi is also the service
//worker's re-injection sentinel (typeof brapi != "undefined").
globalThis.brapi = brapi
globalThis.getSettings = getSettings
globalThis.updateSettings = updateSettings
globalThis.waitMillis = waitMillis
globalThis.repeat = repeat
globalThis.paragraphSplitter = paragraphSplitter
globalThis.getInnerText = getInnerText
globalThis.isNotEmpty = isNotEmpty
globalThis.fixParagraphs = fixParagraphs
globalThis.tryGetTexts = tryGetTexts
globalThis.simulateMouseEvent = simulateMouseEvent
globalThis.simulateClick = simulateClick
globalThis.getMath = getMath
