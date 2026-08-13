
var contentHandlers = [
  // Unsupported Sites --------------------------------------------------------
  {
    match: function(url) {
      return config.unsupportedSites.some(function(site) {
        return (typeof site == "string" && url.startsWith(site)) || (site instanceof RegExp && site.test(url));
      })
    },
    validate: function() {
      throw new Error(JSON.stringify({code: "error_page_unreadable"}));
    }
  },

  // file:// ------------------------------------------------------------------
  {
    match: function(url) {
      return /^file:/.test(url);
    },
    validate: function() {
      return new Promise(function(fulfill) {
        brapi.extension.isAllowedFileSchemeAccess(fulfill);
      })
      .then(function(allowed) {
        if (!allowed) throw new Error(JSON.stringify({code: "error_file_access"}));
      })
    }
  },

  // Google Docs ---------------------------------------------------------------
  {
    match: function(url) {
      return url.startsWith("https://docs.google.com/document/d/")
    },
    validate: function() {
      if (this.alreadyAsked) return
      else this.alreadyAsked = true
      const perms = {
        origins: ["https://docs.google.com/document/d/"]
      }
      return brapi.permissions.contains(perms)
        .then(has => {
          if (!has) throw new Error(JSON.stringify({code: "error_add_permissions", perms: perms, reload: true}))
        })
    },
  },

  // OneDrive Doc -----------------------------------------------------------
  {
    match: function(url, title) {
      return url.startsWith("https://onedrive.live.com/edit.aspx") && title.includes(".docx")
        || /^https:\/\/[^/]+\.sharepoint\.com\//.test(url)
        || url.startsWith("https://www.dropbox.com/") && url.split("?")[0].endsWith(".docx")
    },
    targetOrigins: [
      "https://word-edit.officeapps.live.com/",
      "https://usc-word-edit.officeapps.live.com/",
    ],
    validate: function() {
      var perms = {
        permissions: ["webNavigation"],
        origins: this.targetOrigins
      }
      return brapi.permissions.contains(perms)
        .then(function(has) {
          if (!has) throw new Error(JSON.stringify({code: "error_add_permissions", perms: perms}));
        })
    },
    getFrameId: function(frames) {
      const frame = frames.find(frame => this.targetOrigins.some(origin => frame.url.startsWith(origin)))
      return frame && frame.frameId;
    },
    extraScripts: ["js/content/onedrive-doc.js"]
  },

  // Liberty University ---------------------------------------------------------
  {
    match: function(url) {
      return url.startsWith("https://luoa.instructure.com/courses/")
    },
    validate: function() {
      var perms = {
        permissions: ["webNavigation"],
        origins: ["https://luoa-content.s3.amazonaws.com/"]
      }
      return brapi.permissions.contains(perms)
        .then(function(has) {
          if (!has) throw new Error(JSON.stringify({code: "error_add_permissions", perms: perms}))
        })
    },
    getFrameId: function(frames) {
      var frame = frames.find(function(frame) {
        return frame.url && frame.url.startsWith("https://luoa-content.s3.amazonaws.com/")
      })
      return frame && frame.frameId
    }
  },

  // default -------------------------------------------------------------------
  {
    match: function() {
      return true;
    }
  }
]
