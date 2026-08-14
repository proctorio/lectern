import { brapi } from "./brapi.js";
import { detectTabLanguage, getActiveTab, getTab, getAllFrames } from "./defaults.js";
import { registerMessageListener } from "./messaging.js";
import { contentHandlers } from "./content-handlers.js";

brapi.runtime.onInstalled.addListener(function() {
  installContextMenus()
})


/**
 * IPC handlers
 */
var handlers = {
  playText: playText,
  playTab: playTab,
  reloadAndPlayTab: reloadAndPlayTab,
  stop: stop,
  pause: pause,
  resume: resume,
  getPlaybackState: getPlaybackState,
  forward: forward,
  rewind: rewind,
  seek: seek,
}

registerMessageListener("serviceWorker", handlers)


/**
 * Installers
 */
function installContextMenus() {
  if (brapi.contextMenus)
  brapi.contextMenus.create({
    id: "read-selection",
    title: brapi.i18n.getMessage("context_read_selection"),
    contexts: ["selection"]
  },
  function() {
    if (brapi.runtime.lastError) console.error(brapi.runtime.lastError)
    else console.info("Installed context menus")
  })
}


/**
 * Context menu handlers
 */
if (brapi.contextMenus)
brapi.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId == "read-selection")
    Promise.resolve()
      .then(function() {
        if (tab && tab.id != -1) return detectTabLanguage(tab.id)
        else return undefined
      })
      .then(function(lang) {
        return playText(info.selectionText, {lang: lang})
      })
      .catch(handleHeadlessError)
})


/**
 * Shortcut keys handlers
 */
if (brapi.commands)
brapi.commands.onCommand.addListener(function(command) {
  if (command == "play" || command == "pause") {
    getPlaybackState()
      .then(function(stateInfo) {
        switch (stateInfo.state) {
          case "PLAYING": return command == "pause" ? pause() : stop()
          case "PAUSED": return resume()
          case "STOPPED": return playTab()
        }
      })
      .catch(handleHeadlessError)
  }
  else if (command == "stop") {
    stop()
      .catch(handleHeadlessError)
  }
  else if (command == "forward") {
    forward()
      .catch(handleHeadlessError)
  }
  else if (command == "rewind") {
    rewind()
      .catch(handleHeadlessError)
  }
})


/**
 * METHODS
 */
var currentTask = {
  task: null,
  isActive() {
    return this.task && this.task.isActive
  },
  begin() {
    if (this.task) this.task.cancel()
    return this.task = {
      isActive: true,
      cancel() {
        this.isActive = false
      },
      end() {
        if (!this.isActive) throw new Error("Canceled")
        this.isActive = false
      }
    }
  },
  cancel() {
    if (this.task) {
      this.task.cancel()
      this.task = null
    }
  }
}

async function playText(text, opts) {
  const hasPlayer = await stop().then(res => res == true, err => false)
  if (!hasPlayer) await injectPlayer(await getActiveTab())
  await sendToPlayer({method: "playText", args: [text, opts]})
}

async function playTab(tabId) {
  const tab = tabId ? await getTab(tabId) : await getActiveTab()
  if (!tab) throw new Error(JSON.stringify({code: "error_page_unreadable"}))

  const task = currentTask.begin()
  try {
    const handler = contentHandlers.find(h => h.match(tab.url || "", tab.title))
    if (handler.validate) await handler.validate(tab)
    if (handler.getSourceUri) {
      await brapi.storage.local.set({"sourceUri": handler.getSourceUri(tab)})
    }
    else {
      const frameId = handler.getFrameId && await getAllFrames(tab.id).then(frames => handler.getFrameId(frames))
      if (!await contentScriptAlreadyInjected(tab, frameId)) await injectContentScript(tab, frameId, handler.extraScripts)
      await brapi.storage.local.set({"sourceUri": "contentscript:" + tab.id})
    }
  }
  finally {
    task.end()
  }

  const hasPlayer = await stop().then(res => res == true, err => false)
  if (!hasPlayer) await injectPlayer(tab)
  await sendToPlayer({method: "playTab"})
}

async function reloadAndPlayTab(tabId) {
  const tab = tabId ? await getTab(tabId) : await getActiveTab()

  const task = currentTask.begin()
  try {
    const tabLoadComplete = new Promise(fulfill => {
      function listener(changeTabId, changeInfo) {
        if (changeTabId == tab.id && changeInfo.status == "complete") {
          brapi.tabs.onUpdated.removeListener(listener)
          fulfill()
        }
      }
      brapi.tabs.onUpdated.addListener(listener)
    })
    await brapi.tabs.reload(tab.id)
    await tabLoadComplete
  }
  finally {
    task.end()
  }

  await playTab(tab.id)
}

function stop() {
  currentTask.cancel()
  return sendToPlayer({method: "stop"})
}

function pause() {
  return sendToPlayer({method: "pause"})
}

function resume() {
  return sendToPlayer({method: "resume"})
}

async function getPlaybackState() {
  if (currentTask.isActive()) return {state: "LOADING"}
  try {
    return await sendToPlayer({method: "getPlaybackState"}) || {state: "STOPPED"}
  }
  catch (err) {
    return {state: "STOPPED"}
  }
}

function forward() {
  return sendToPlayer({method: "forward"})
}

function rewind() {
  return sendToPlayer({method: "rewind"})
}

function seek(n) {
  return sendToPlayer({method: "seek", args: [n]})
}



function handleHeadlessError(err) {
  console.error(err)
  //TODO: let user knows somehow
}

async function contentScriptAlreadyInjected(tab, frameId) {
  const items = await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    func: function() {
      return typeof brapi != "undefined"
    }
  })
  return items[0].result == true
}

async function injectContentScript(tab, frameId, extraScripts) {
  await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    files: [
      "js/vendor/jquery-3.7.1.min.js",
      "js/content-entries/content-base.js",
    ]
  })
  const files = extraScripts || await brapi.tabs.sendMessage(tab.id, {dest: "contentScript", method: "getRequireJs"})
  await brapi.scripting.executeScript({
    target: {
      tabId: tab.id,
      frameIds: frameId ? [frameId] : undefined,
    },
    files: files
  })
  console.info("Content handler", files)
}

async function injectPlayer(tab) {
  if (!tab) throw new Error("No tab to host the player")
  if (tab.incognito) {
    //https://developer.chrome.com/docs/extensions/mv3/manifest/incognito/
    throw new Error("Incognito tab")
  }
  const promise = new Promise(f => handlers.playerCheckIn = f)
  await brapi.scripting.executeScript({
    target: {tabId: tab.id},
    func: createPlayerFrame
  })
  await promise
}

function createPlayerFrame() {
  const brapi = (typeof chrome != 'undefined') ? chrome : (typeof browser != 'undefined' ? browser : {})
  const frame = document.createElement("iframe")
  frame.src = brapi.runtime.getURL("player.html")
  frame.style.position = "absolute"
  frame.style.height = "0"
  frame.style.borderWidth = "0"
  document.body.appendChild(frame)
}

async function sendToPlayer(message) {
  message.dest = "player"
  const result = await brapi.runtime.sendMessage(message)
  if (result && result.error) throw result.error
  else return result
}
