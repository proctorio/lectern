
var queryString = new URLSearchParams(location.search)
var activeDoc;
var playbackError = null;


const idleSubject = new rxjs.BehaviorSubject(true)

if (queryString.has("autoclose")) {
  idleSubject.pipe(
    rxjs.switchMap(isIdle =>
      rxjs.iif(
        () => isIdle,
        rxjs.timer(queryString.get("autoclose") == "long" ? 15*60*1000 : 5*60*1000),
        rxjs.EMPTY
      )
    )
  ).subscribe(closePlayer)
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
  shouldPlaySilence: shouldPlaySilence.bind({}),
}

registerMessageListener("player", messageHandlers)

if (queryString.has("opener")) {
  brapi.runtime.sendMessage({dest: queryString.get("opener"), method: "playerCheckIn"})
    .catch(console.error)
} else {
  bgPageInvoke("playerCheckIn")
    .catch(console.error)
}

document.addEventListener("DOMContentLoaded", initialize)



async function initialize() {
  setI18nText()

}

function playText(text, opts) {
  opts = opts || {}
  playbackError = null
  if (!activeDoc) {
    openDoc(new SimpleSource(text.split(/(?:\r?\n){2,}/), {lang: opts.lang}), function(err) {
      if (err) playbackError = err
    })
  }
  const doc = activeDoc
  return activeDoc.play()
    .catch(function(err) {
      if (doc == activeDoc) {
        handleError(err);
        closeDoc();
      }
      throw err;
    })
}

function playTab() {
  playbackError = null
  if (!activeDoc) {
    openDoc(new TabSource(), function(err) {
      if (err) playbackError = err
    })
  }
  const doc = activeDoc
  return activeDoc.play()
    .catch(function(err) {
      if (doc == activeDoc) {
        handleError(err);
        closeDoc();
      }
      throw err;
    })
}

function stop() {
  if (activeDoc) {
    activeDoc.stop();
    closeDoc();
  }
  return true;
}

function pause() {
  if (activeDoc) return activeDoc.pause();
  else return Promise.resolve();
}

function resume() {
  if (activeDoc) return activeDoc.play()
  else return Promise.resolve()
}

function getPlaybackState() {
  if (activeDoc) {
    return Promise.all([activeDoc.getState(), activeDoc.getActiveSpeech()])
      .then(function(results) {
        return {
          state: results[0],
          speechInfo: results[1] && results[1].getInfo(),
          playbackError: errorToJson(playbackError),
        }
      })
      .finally(() => {
        playbackError = null
      })
  }
  else {
    return {
      state: "STOPPED",
      playbackError: errorToJson(playbackError),
    }
  }
}

function openDoc(source, onEnd) {
  activeDoc = new Doc(source, function(err) {
    handleError(err);
    closeDoc();
    if (typeof onEnd == "function") onEnd(err);
  })
  idleSubject.next(false)
}

function closeDoc() {
  if (activeDoc) {
    activeDoc.close();
    activeDoc = null;
    idleSubject.next(true)
  }
}

function forward() {
  if (activeDoc) return activeDoc.forward();
  else return Promise.reject(new Error("Can't forward, not active"));
}

function rewind() {
  if (activeDoc) return activeDoc.rewind();
  else return Promise.reject(new Error("Can't rewind, not active"));
}

function seek(n) {
  if (activeDoc) return activeDoc.seek(n);
  else return Promise.reject(new Error("Can't seek, not active"));
}

function closePlayer() {
  if (top == self) window.close()
  else location.href = "about:blank"
}

function handleError(err) {
  if (err) reportError(err);
}

function reportError(err) {
  if (err && err.stack) {
    var details = err.stack;
    if (!details.startsWith(err.name)) details = err.name + ": " + err.message + "\n" + details;
    console.error(details)
  }
}

function playAudio(urlPromise, options, playbackState$) {
  if (brapi.offscreen) {
    return playAudioOffscreen(urlPromise, options, playbackState$)
  }
  else {
    return playAudioHere(requestAudioPlaybackPermission().then(() => urlPromise), options, playbackState$)
  }
}

var requestAudioPlaybackPermission = lazy(async function() {
  const thisTab = await brapi.tabs.getCurrent()
  const prevTab = await brapi.tabs.query({windowId: thisTab.windowId, active: true}).then(tabs => tabs[0])
  await brapi.tabs.update(thisTab.id, {active: true})
  $("#dialog-backdrop, #audio-playback-permission-dialog").show()
  await new Audio(brapi.runtime.getURL("sound/silence.mp3")).play()
  $("#dialog-backdrop, #audio-playback-permission-dialog").hide()
  await brapi.tabs.update(prevTab.id, {active: true})
})

async function createOffscreen() {
  const readyPromise = new Promise(f => messageHandlers.offscreenCheckIn = f)
  brapi.offscreen.createDocument({
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Read Aloud would like to play audio in the background",
    url: brapi.runtime.getURL("offscreen.html")
  })
  await readyPromise
}

function playAudioOffscreen(urlPromise, options, playbackState$) {
  return rxjs.from(urlPromise).pipe(
    rxjs.exhaustMap(url =>
      playbackState$.pipe(
        rxjs.distinctUntilChanged(),
        rxjs.skipWhile(state => state != "resumed"),
        rxjs.scan((playback$, state) => {
          if (state == "resumed") {
            return rxjs.defer(async () => {
              if (!playback$) {
                const result = await sendToOffscreen({method: "play", args: [url, options]})
                if (result != true) throw "Offscreen doc not present"
              } else {
                const result = await sendToOffscreen({method: "resume"})
                if (result != true) throw "Offscreen doc gone"
              }
            }).pipe(
              rxjs.catchError(err => {
                console.debug(err)
                return rxjs.defer(createOffscreen).pipe(
                  rxjs.exhaustMap(async () => {
                    const result = await sendToOffscreen({method: "play", args: [url, options]})
                    if (result != true) throw new Error("Offscreen doc inaccessible")
                  })
                )
              }),
              rxjs.exhaustMap(() =>
                rxjs.NEVER.pipe(
                  rxjs.finalize(() => {
                    sendToOffscreen({method: "pause"})
                      .catch(console.error)
                  })
                )
              )
            )
          } else {
            return rxjs.EMPTY
          }
        }, null),
        rxjs.switchAll()
      )
    ),
    rxjs.mergeWith(
      new rxjs.Observable(observer => {
        messageHandlers.offscreenPlaybackEvent = function(event) {
          if (event.type == "error") observer.error(event.error)
          else observer.next(event)
        }
      })
    ),
    rxjs.takeWhile(event => event.type != "end", true)
  )
}

async function sendToOffscreen(message) {
  message.dest = "offscreen"
  const result = await brapi.runtime.sendMessage(message)
    .catch(err => {
      if (/^(A listener indicated|Could not establish)/.test(err.message)) throw new Error(err.message + " " + message.method)
      throw err
    })
  if (result && result.error) throw result.error
  else return result
}

async function shouldPlaySilence(providerId) {
  const should = await getPlaybackState().then(x => x.state == "PLAYING")
  const now = Date.now()
  if (providerId == this.providerId) {
    this.nextExpectedCheckIn = now + (now - this.lastCheckIn)
    this.lastCheckIn = now
    return should
  }
  else {
    if (now < this.nextExpectedCheckIn) {
      return false
    }
    else {
      this.providerId = providerId
      this.lastCheckIn = now
      return should
    }
  }
}
