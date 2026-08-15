import { brapi } from "./brapi.js";
import * as rxjs from "./vendor/rxjs.js";
import { defaults, getSettings, getSetting, setI18nText, bgPageInvoke, repeat } from "./defaults.js";
import { registerMessageListener, errorToJson } from "./messaging.js";
import { getSpeechVoice, browserTtsEngine } from "./tts-engines.js";
import { Speech } from "./speech.js";
import { SimpleSource, TabSource, Doc } from "./document.js";

var queryString = new URLSearchParams(location.search);
var activeDoc;
var playbackError = null;

const idleSubject = new rxjs.BehaviorSubject(true);

if (queryString.has("autoclose")) 
{
	idleSubject.pipe(rxjs.switchMap(isIdle =>
		rxjs.iif(
			() => isIdle,
			rxjs.timer(queryString.get("autoclose") == "long" ? 15 * 60 * 1000 : 5 * 60 * 1000),
			rxjs.EMPTY
		))).subscribe(closePlayer);
}

var messageHandlers = {
	playText: playText,
	playTab: playTab,
	stop: stop,
	pause: pause,
	resume: resume,
	getPlaybackState: getPlaybackState,
	forward: forward,
	rewind: rewind,
	seek: seek,
	announce: announce,
	close: closePlayer,
	shouldPlaySilence: shouldPlaySilence.bind({})
};

registerMessageListener("player", messageHandlers);

if (queryString.has("opener")) 
{
	brapi.runtime.sendMessage({dest: queryString.get("opener"),
																												method: "playerCheckIn"})
		.catch(console.error);
}
else 
{
	bgPageInvoke("playerCheckIn")
		.catch(console.error);
}

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() 
{
	setI18nText();

}

function playText(text, opts) 
{
	opts = opts || {};
	playbackError = null;
	if (!activeDoc) 
	{
		openDoc(new SimpleSource(text.split(/(?:\r?\n){2,}/), {lang: opts.lang}), function(err) 
		{
			if (err) playbackError = err;
		});
	}
	const doc = activeDoc;
	
	return activeDoc.play()
		.catch(function(err) 
		{
			if (doc == activeDoc) 
			{
				handleError(err);
				closeDoc();
			}
			throw err;
		});
}

function playTab() 
{
	playbackError = null;
	if (!activeDoc) 
	{
		openDoc(new TabSource(), function(err) 
		{
			if (err) playbackError = err;
		});
	}
	const doc = activeDoc;
	
	return activeDoc.play()
		.catch(function(err) 
		{
			if (doc == activeDoc) 
			{
				handleError(err);
				closeDoc();
			}
			throw err;
		});
}

function stop() 
{
	if (activeDoc) 
	{
		activeDoc.stop();
		closeDoc();
	}
	
	return true;
}

function pause() 
{
	if (activeDoc) return activeDoc.pause();
	else return Promise.resolve();
}

function resume() 
{
	if (activeDoc) return activeDoc.play();
	else return Promise.resolve();
}

function getPlaybackState() 
{
	if (activeDoc) 
	{
		return Promise.all([activeDoc.getState(), activeDoc.getActiveSpeech()])
			.then(function(results) 
			{
				return {
					state: results[0],
					speechInfo: results[1] && results[1].getInfo(),
					playbackError: errorToJson(playbackError)
				};
			})
			.finally(() => 
			{
				playbackError = null;
			});
	}
	else 
	{
		return {
			state: "STOPPED",
			playbackError: errorToJson(playbackError)
		};
	}
}

function openDoc(source, onEnd) 
{
	activeDoc = new Doc(source, function(err) 
	{
		handleError(err);
		closeDoc();
		if (typeof onEnd == "function") onEnd(err);
	});
	idleSubject.next(false);
}

function closeDoc() 
{
	if (activeDoc) 
	{
		activeDoc.close();
		activeDoc = null;
		idleSubject.next(true);
	}
}

function forward() 
{
	if (activeDoc) return activeDoc.forward();
	else return Promise.reject(new Error("Can't forward, not active"));
}

function rewind() 
{
	if (activeDoc) return activeDoc.rewind();
	else return Promise.reject(new Error("Can't rewind, not active"));
}

function seek(n, offset)
{
	if (activeDoc) return activeDoc.seek(n, offset);
	else return Promise.reject(new Error("Can't seek, not active"));
}

/**
 * OVERLAY ANNOUNCEMENTS (finding F6, milestone M5)
 * Speaks an exam intervention through the local browser engine, pausing the
 * active document first and resuming it afterwards. Overlapping
 * announcements serialize through a promise queue so a second overlay can
 * neither clobber the first utterance nor double-resume the document.
 */
var announceQueue = Promise.resolve();

function announce(text)
{
	const result = announceQueue.then(() => speakAnnouncement(text));

	// A failed announcement must not wedge the queue for the next one.
	announceQueue = result.catch(function() {});

	return result;
}

async function speakAnnouncement(text)
{
	text = text != null ? String(text).trim() : "";
	if (!text) return;

	const doc = activeDoc;

	// Wait out the loading phase, bounded: a document still starting up
	// would race the announcement for the shared TTS channel the moment its
	// own first utterance begins.
	await repeat({
		action: () => (doc && doc == activeDoc ? doc.getState() : "STOPPED"),
		until: state => state != "LOADING",
		delay: 250,
		max: 40
	});

	const wasPlaying = Boolean(doc) && doc == activeDoc && await doc.getState() == "PLAYING";
	var resumeIndex = null;
	if (doc && doc == activeDoc)
	{
		const speech = await doc.getActiveSpeech();
		if (speech) resumeIndex = speech.getInfo().position.index;
		await doc.pause();
	}

	// The document and the announcement share the one browser TTS channel,
	// and a paused channel queues new utterances instead of playing them,
	// so clear the channel before speaking the announcement.
	if (browserTtsEngine.stop) browserTtsEngine.stop();

	try
	{
		await speakOnce(text);
	}
	finally
	{
		// The announcement replaced the engine's paused utterance, so a plain
		// resume would wait forever on audio that no longer exists. Seek back
		// to the interrupted chunk instead, and re-pause right away when the
		// document was already paused before the announcement.
		if (doc && doc == activeDoc && resumeIndex != null)
		{
			await Promise.resolve()
				.then(() => doc.seek(resumeIndex))
				.then(() => (wasPlaying ? null : doc.pause()))
				.catch(reportError);
		}
	}
}

// One-off speech for the announcement text, using the current voice
// settings, spoken directly on the local browser engine.
async function speakOnce(text)
{
	const settings = await getSettings();
	const rate = await getSetting("rate" + (settings.voiceName || ""));
	const options = {
		rate: rate || defaults.rate,
		pitch: settings.pitch || defaults.pitch,
		volume: settings.volume || defaults.volume,
		lang: brapi.i18n && brapi.i18n.getUILanguage && brapi.i18n.getUILanguage() || "en-US"
	};
	const voice = await getSpeechVoice(settings.voiceName, options.lang);
	if (!voice) throw new Error(JSON.stringify({code: "error_no_voice",
																																													lang: options.lang}));
	options.voice = voice;
	const speech = new Speech([text], options);

	return new Promise(function(fulfill, reject)
	{
		speech.onEnd = function(err)
		{
			if (err) reject(err);
			else fulfill();
		};
		speech.play();
	});
}

function closePlayer()
{
	if (top == self) window.close();
	else location.href = "about:blank";
}

function handleError(err) 
{
	if (err) reportError(err);
}

function reportError(err) 
{
	if (err && err.stack) 
	{
		var details = err.stack;
		if (!details.startsWith(err.name)) details = err.name + ": " + err.message + "\n" + details;
		console.error(details);
	}
}

async function shouldPlaySilence(providerId) 
{
	const should = await getPlaybackState().then(x => x.state == "PLAYING");
	const now = Date.now();
	if (providerId == this.providerId) 
	{
		this.nextExpectedCheckIn = now + (now - this.lastCheckIn);
		this.lastCheckIn = now;
		
		return should;
	}
	else 
	{
		if (now < this.nextExpectedCheckIn) 
		{
			return false;
		}
		else 
		{
			this.providerId = providerId;
			this.lastCheckIn = now;
			
			return should;
		}
	}
}
