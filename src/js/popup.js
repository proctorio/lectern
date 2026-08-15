import { brapi } from "./brapi.js";
import * as rxjs from "./vendor/rxjs.js";
import { defaults, getQueryString, getSettings, updateSettings, getCurrentTab, getActiveTab, updateTab, updateWindow, createWindow, domReady, formatError, escapeHtml, isMobileOS, bgPageInvoke, effectiveShowHighlighting } from "./defaults.js";
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

	$("#imgLoading").toggle(state == "LOADING");
	$("#btnSettings").toggle(state == "STOPPED");
	$("#btnPlay").toggle(state == "PAUSED" || state == "STOPPED");
	$("#btnPause").toggle(state == "PLAYING");
	$("#btnStop").toggle(state == "PAUSED" || state == "PLAYING" || state == "LOADING");
	$("#btnForward, #btnRewind").toggle(state == "PLAYING" || state == "PAUSED");

	if (showHighlighting && (state == "LOADING" || state == "PAUSED" || state == "PLAYING") && speech) 
	{
		$("#highlight, #toolbar").show();
		updateHighlighting(speech);
	}
	else 
	{
		$("#highlight, #toolbar").hide();
	}
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
		// sentence boundary at or before that offset.
		for (const entry of mapParagraphs(speech.texts))
		{
			makeSpan(entry.text)
				.css("cursor", "pointer")
				.data("chunkIndex", entry.chunkIndex)
				.click(onSeek.bind(null, entry.chunkIndex, entry.offset))
				.appendTo(elem);
		}
	}

	const pos = speech.position;
	if (!elem.data("position") || positionDiffers(elem.data("position"), pos))
	{
		elem.data("position", pos);
		elem.find(".active").removeClass("active");

		// Playback position is chunk-granular (the whole chunk is one
		// utterance), so every paragraph span of the active chunk highlights,
		// which matches the old one-span-per-chunk visual exactly.
		const group = elem.children().filter(function()
		{
			return $(this).data("chunkIndex") == pos.index;
		});
		group.addClass("active");
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
		scrollParent.animate({scrollTop: scrollParent[0].scrollTop + childTop - 10});
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

function changeFontSize(delta) 
{
	getSettings(["highlightFontSize"])
		.then(function(settings) 
		{
			var newSize = (settings.highlightFontSize || defaults.highlightFontSize) + delta;
			if (newSize >= 1 && newSize <= 8) return updateSettings({highlightFontSize: newSize}).then(refreshSize);
		})
		.catch(handleError);
}

function changeWindowSize(delta) 
{
	getSettings(["highlightWindowSize"])
		.then(function(settings) 
		{
			var newSize = (settings.highlightWindowSize || defaults.highlightWindowSize) + delta;
			if (newSize >= 1 && newSize <= 3) return updateSettings({highlightWindowSize: newSize}).then(refreshSize);
		})
		.catch(handleError);
}

function refreshSize() 
{
	return getSettings(["highlightFontSize", "highlightWindowSize"])
		.then(function(settings) 
		{
			var fontSize = getFontSize(settings);
			var windowSize = getWindowSize(settings);
			$("#highlight").css({
				"font-size": fontSize
			});
			if (queryString.isPopup) $("#highlight").css({
				width: isMobileOS() ? "100%" : windowSize[0],
				height: windowSize[1]
			});
		});
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
}

function toggleDarkMode() 
{
	const darkMode = document.body.classList.toggle("dark-mode");
	updateSettings({darkMode});
}
