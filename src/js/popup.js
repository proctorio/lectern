import { brapi } from "./brapi.js";
import * as rxjs from "./vendor/rxjs.js";
import { defaults, getQueryString, getSettings, updateSettings, getCurrentTab, getActiveTab, updateTab, updateWindow, createWindow, domReady, formatError, escapeHtml, isMobileOS, bgPageInvoke, effectiveShowHighlighting, setI18nText, playbackAnnouncementKey, isActivationKey } from "./defaults.js";
import { splitChunkIntoParagraphs } from "./paragraphs.js";
import { registerMessageListener } from "./messaging.js";

var queryString = getQueryString();
const playerCheckIn$ = new rxjs.Subject();

registerMessageListener("popup", {
	playerCheckIn() 
	{
		playerCheckIn$.next();
	}
});

$(function() 
{
	if (queryString.isPopup) $("body").addClass("is-popup");
	else getCurrentTab().then(function(currentTab) { return updateSettings({sourceTabId: currentTab.id}); });
});

getSettings(["showHighlighting", "sourceTabId", "examSafeMode"]).then(async settings =>
{
	// Exam-safe mode never opens windows, so the popout path is skipped and
	// highlighting stays in the popup (milestone M5).
	if (effectiveShowHighlighting(settings.showHighlighting, settings.examSafeMode) == 2 && queryString.isPopup)
	{
		await popout(settings.sourceTabId);
	}
	else
	{
		await init();
	}
}).catch(handleError);

async function popout(tabId) 
{
	const activeTab = await getActiveTab();
	const url = brapi.runtime.getURL("popup.html?tab=" + activeTab.id);
	try 
	{
		if (!tabId) throw "Create";
		const tab = await updateTab(tabId, {url,
																																						active: true});
		await updateWindow(tab.windowId, {focused: true}).catch(console.error);
		window.close();
	}
	catch (err) 
	{
		await createWindow({
			url,
			focused: true,
			type: "popup",
			width: 500,
			height: 600
		});
		window.close();
	}
}

async function init()
{
	await domReady();

	setI18nText();
	$("#btnPlay").click(onPlay);
	$("#btnPause").click(onPause);
	$("#btnStop").click(onStop);
	$("#btnSettings").click(onSettings);
	$("#btnForward").click(onForward);
	$("#btnRewind").click(onRewind);
	$("#decrease-font-size").click(changeFontSize.bind(null, -1));
	$("#increase-font-size").click(changeFontSize.bind(null, +1));
	$("#decrease-window-size").click(changeWindowSize.bind(null, -1));
	$("#increase-window-size").click(changeWindowSize.bind(null, +1));
	$("#toggle-dark-mode").click(toggleDarkMode);

	refreshSize();
}

function handleError(err) 
{
	if (!err) return;
	if (err.name == "CancellationException") return;

	if ((/^{/).test(err.message)) 
	{
		var errInfo = JSON.parse(err.message);

		$("#status").html(formatError(errInfo)).show();
		$("#status a").click(function() 
		{
			switch ($(this).attr("href")) 
			{
				case "#open-extension-settings":
					brapi.tabs.create({url: "chrome://extensions/?id=" + brapi.runtime.id});
					break;
				case "#request-permissions":
					brapi.permissions.request(errInfo.perms)
						.then(function(granted) 
						{
							if (granted) 
							{
								if (errInfo.reload) return reloadAndPlay();
								else $("#btnPlay").click();
							}
						});
					break;
			}
		});
	}
	else 
	{
		$("#status").text(err.message).show();
	}
}

rxjs.concat(domReady(), rxjs.interval(500)).subscribe(updateButtons);

// The last playback state the poll observed, so the live region announces
// transitions only, never every poll tick.
var lastPlaybackState = null;

async function updateButtons()
{
	const [settings, stateInfo] = await Promise.all([
		getSettings(),
		bgPageInvoke("getPlaybackState")
	]);
	const showHighlighting = effectiveShowHighlighting(settings.showHighlighting, settings.examSafeMode);
	var state = stateInfo.state;
	const speech = stateInfo.speechInfo;
	var playbackErr = stateInfo.playbackError;

	if (playbackErr) handleError(playbackErr);

	const announcementKey = playbackAnnouncementKey(lastPlaybackState, state);
	lastPlaybackState = state;
	if (announcementKey) $("#playback-status").text(brapi.i18n.getMessage(announcementKey));

	$("#imgLoading").toggle(state == "LOADING");
	$("#btnSettings").toggle(state == "STOPPED");
	$("#btnPlay").toggle(state == "PAUSED" || state == "STOPPED");

	// The play button resumes while paused, so its accessible name must
	// track that behavior change (accessibility spec: do not label a button
	// "play" and change its behavior to pause/resume without changing the
	// accessible name). Only write the attribute when it actually changes.
	const playLabel = brapi.i18n.getMessage(state == "PAUSED" ? "popup_resume_label" : "popup_play_label");
	if ($("#btnPlay").attr("aria-label") != playLabel) $("#btnPlay").attr("aria-label", playLabel);
	$("#btnPause").toggle(state == "PLAYING");
	$("#btnStop").toggle(state == "PAUSED" || state == "PLAYING" || state == "LOADING");
	$("#btnForward, #btnRewind").toggle(state == "PLAYING" || state == "PAUSED");

	// Transport bounds mirror document.js: rewind and forward are no-ops at
	// the first and last chunk, so the buttons disable there. On a short
	// page both can disable at once, hence the stop-button focus fallback.
	const atFirstChunk = !speech || speech.position.index <= 0;
	const atLastChunk = !speech || speech.position.index >= speech.texts.length - 1;
	setStepButtonDisabled("#btnRewind", atFirstChunk, ["#btnForward", "#btnStop"]);
	setStepButtonDisabled("#btnForward", atLastChunk, ["#btnRewind", "#btnStop"]);

	if (showHighlighting && (state == "LOADING" || state == "PAUSED" || state == "PLAYING") && speech)
	{
		$("#highlight, #toolbar").show();
		updateHighlighting(speech);
	}
	else
	{
		$("#highlight, #toolbar").hide();
	}
	applyPopupWidth(settings);
}

function updateHighlighting(speech)
{
	var elem = $("#highlight");
	if (!elem.data("texts") ||
    elem.data("texts").length != speech.texts.length ||
    elem.data("texts").some((text, i) => text != speech.texts[i])
	)
	{
		elem.css("direction", speech.isRTL ? "rtl" : "")
			.data({texts: speech.texts,
										position: null})
			.empty();

		// One clickable span per PARAGRAPH, not per TTS chunk: chunks may
		// merge several short paragraphs, and clicking the second paragraph
		// of a merged chunk must not seek to the chunk start. Each span maps
		// to its chunk index plus the paragraph's character offset within
		// that chunk, and the seek path slices playback at the nearest
		// sentence boundary at or before that offset. The spans are keyboard
		// actionable (role=button, tabindex, Enter and Space reusing the
		// click path) per the accessibility spec's keyboard-only requirement.
		let paragraphNumber = 0;
		for (const entry of mapParagraphs(speech.texts))
		{
			paragraphNumber++;
			const seek = onSeek.bind(null, entry.chunkIndex, entry.offset);
			makeSpan(entry.text)
				.css("cursor", "pointer")
				.data("chunkIndex", entry.chunkIndex)
				.attr({
					role: "button",
					tabindex: 0,
					title: brapi.i18n.getMessage("popup_read_paragraph_label", [String(paragraphNumber)])
				})
				.click(seek)
				.on("keydown", function(event)
				{
					if (isActivationKey(event.key))
					{
						event.preventDefault();
						seek();
					}
				})
				.appendTo(elem);
		}
	}

	const pos = speech.position;
	if (!elem.data("position") || positionDiffers(elem.data("position"), pos))
	{
		elem.data("position", pos);
		elem.find(".active").removeClass("active").removeAttr("aria-current");

		// Playback position is chunk-granular (the whole chunk is one
		// utterance), so every paragraph span of the active chunk highlights,
		// which matches the old one-span-per-chunk visual exactly. The
		// active group also carries aria-current plus a border in CSS, so
		// the playing position is never conveyed by color alone.
		const group = elem.children().filter(function()
		{
			return $(this).data("chunkIndex") == pos.index;
		});
		group.addClass("active").attr("aria-current", "true");
		if (group.length) scrollIntoView(group.first(), elem);
	}
}

function mapParagraphs(texts)
{
	const entries = [];
	for (let i = 0; i < texts.length; i++)
	{
		for (const paragraph of splitChunkIntoParagraphs(texts[i]))
		{
			entries.push({text: paragraph.text,
																	chunkIndex: i,
																	offset: paragraph.offset});
		}
	}

	return entries;
}

function makeSpan(text) 
{
	const html = escapeHtml(text).replaceAll(/\r?\n/g, "<br/>");
	
	return $("<span>").html(html);
}

function positionDiffers(left, right) 
{
	function rangeDiffers(a, b) 
	{
		if (a == null && b == null) return false;
		if (a != null && b != null) return a.startIndex != b.startIndex || a.endIndex != b.endIndex;
		
		return true;
	}
	
	return left.index != right.index ||
    rangeDiffers(left.paragraph, right.paragraph) ||
    rangeDiffers(left.sentence, right.sentence) ||
    rangeDiffers(left.word, right.word);
}

function scrollIntoView(child, scrollParent) 
{
	const childTop = child.offset().top - scrollParent.offset().top;
	const childBottom = childTop + child.outerHeight();
	if (childTop < 0 || childBottom >= scrollParent.height())
		var target = scrollParent[0].scrollTop + childTop - 10;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) scrollParent[0].scrollTop = target;
	else scrollParent.animate({scrollTop: target});
}

var currentPlayRequestId;

function onPlay() 
{
	$("#status").hide();
	const requestId = currentPlayRequestId = Math.random();
	bgPageInvoke("getPlaybackState")
		.then(function(stateInfo) 
		{
			if (stateInfo.state == "PAUSED") return bgPageInvoke("resume");
			else return bgPageInvoke("playTab", queryString.tab ? [Number(queryString.tab)] : []);
		})
		.then(updateButtons)
		.catch(err => 
		{
			if (requestId == currentPlayRequestId) handleError(err);
			else console.debug("Ignoring error from an earlier request", err);
		});
}

function reloadAndPlay() 
{
	$("#status").hide();
	bgPageInvoke("reloadAndPlayTab", queryString.tab ? [Number(queryString.tab)] : [])
		.then(updateButtons)
		.catch(handleError);
}

function onPause() 
{
	bgPageInvoke("pause")
		.then(updateButtons)
		.catch(handleError);
}

function onStop() 
{
	bgPageInvoke("stop")
		.then(updateButtons)
		.catch(handleError);
}

function onSettings() 
{
	location.href = "options.html?referer=popup.html";
}

function onForward() 
{
	bgPageInvoke("forward")
		.then(updateButtons)
		.catch(handleError);
}

function onRewind() 
{
	bgPageInvoke("rewind")
		.then(updateButtons)
		.catch(handleError);
}

function onSeek(n, offset)
{
	bgPageInvoke("seek", [n, offset])
		.then(updateButtons)
		.catch(handleError);
}

// Step bounds shared by the click guards and the disabled states: the font
// steps map to getFontSize's cases, the window steps to getWindowSize's.
var FONT_SIZE_RANGE = [1, 8];
var WINDOW_SIZE_RANGE = [1, 3];

function changeFontSize(delta)
{
	getSettings(["highlightFontSize"])
		.then(function(settings)
		{
			var newSize = (settings.highlightFontSize || defaults.highlightFontSize) + delta;
			if (newSize >= FONT_SIZE_RANGE[0] && newSize <= FONT_SIZE_RANGE[1]) return updateSettings({highlightFontSize: newSize}).then(refreshSize);
		})
		.catch(handleError);
}

function changeWindowSize(delta)
{
	getSettings(["highlightWindowSize"])
		.then(function(settings)
		{
			var newSize = (settings.highlightWindowSize || defaults.highlightWindowSize) + delta;
			if (newSize >= WINDOW_SIZE_RANGE[0] && newSize <= WINDOW_SIZE_RANGE[1]) return updateSettings({highlightWindowSize: newSize}).then(refreshSize);
		})
		.catch(handleError);
}

function refreshSize()
{
	return getSettings(["highlightFontSize", "highlightWindowSize"])
		.then(function(settings)
		{
			$("#highlight").css({
				"font-size": getFontSize(settings)
			});
			updateSizeButtons(settings);
			if (queryString.isPopup)
			{
				$("#highlight").css({height: getWindowSize(settings)[1]});
				applyPopupWidth(settings);
			}
		});
}

// Disables a step button at its bound. When the button being disabled holds
// keyboard focus, focus moves to the first visible enabled counterpart so
// the focus position is never silently dropped to the page (disabled
// buttons leave the tab order).
function setStepButtonDisabled(id, disabled, counterpartIds)
{
	var button = $(id);
	if (disabled && button.is(":focus"))
	{
		for (const counterpartId of counterpartIds)
		{
			var counterpart = $(counterpartId);
			if (counterpart.is(":visible") && !counterpart.prop("disabled"))
			{
				counterpart.trigger("focus");
				break;
			}
		}
	}
	button.prop("disabled", disabled);
}

function updateSizeButtons(settings)
{
	var fontSize = settings.highlightFontSize || defaults.highlightFontSize;
	var windowSize = settings.highlightWindowSize || defaults.highlightWindowSize;
	setStepButtonDisabled("#decrease-font-size", fontSize <= FONT_SIZE_RANGE[0], ["#increase-font-size"]);
	setStepButtonDisabled("#increase-font-size", fontSize >= FONT_SIZE_RANGE[1], ["#decrease-font-size"]);
	setStepButtonDisabled("#decrease-window-size", windowSize <= WINDOW_SIZE_RANGE[0], ["#increase-window-size"]);
	setStepButtonDisabled("#increase-window-size", windowSize >= WINDOW_SIZE_RANGE[1], ["#decrease-window-size"]);
}

// The toolbar popup window follows an explicit width set on BOTH html and
// body: Chrome's popup auto-resize only ever grows intrinsic widths (height
// shrinks fine, width ratchets; verified against a real popup via
// chrome.action.openPopup), and a definite width on the html element is
// what releases the ratchet so the window also shrinks. The body is
// border-box (popup.css), so the window width equals the value set here:
// the configured window size while the transcript shows, a compact
// constant when idle.
var IDLE_POPUP_WIDTH = 250;

function applyPopupWidth(settings)
{
	if (!queryString.isPopup || isMobileOS()) return;
	const width = $("#highlight").is(":visible") ? getWindowSize(settings)[0] : IDLE_POPUP_WIDTH;
	$("html, body").css("width", width);
}

function getFontSize(settings)
{
	switch (settings.highlightFontSize || defaults.highlightFontSize)
	{
		case 1: return ".9em";
		case 2: return "1em";
		case 3: return "1.1em";
		case 4: return "1.2em";
		case 5: return "1.3em";
		case 6: return "1.4em";
		case 7: return "1.5em";
		default: return "1.6em";
	}
}

function getWindowSize(settings)
{
	switch (settings.highlightWindowSize || defaults.highlightWindowSize)
	{
		case 1: return [430, 330];
		case 2: return [550, 420];
		default: return [750, 450];
	}
}

function toggleDarkMode() 
{
	const darkMode = document.body.classList.toggle("dark-mode");
	updateSettings({darkMode});
}
