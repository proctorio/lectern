import { brapi } from "./brapi.js";
import * as rxjs from "./vendor/rxjs.js";
import { setI18nText, bgPageInvoke } from "./defaults.js";
import { registerMessageListener, errorToJson } from "./messaging.js";
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

function seek(n) 
{
	if (activeDoc) return activeDoc.seek(n);
	else return Promise.reject(new Error("Can't seek, not active"));
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
