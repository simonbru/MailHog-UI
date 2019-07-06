
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
               .toString(16)
               .substring(1)
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
         s4() + '-' + s4() + s4() + s4()
}

// TODO: configure jquery errors

Vue.component('html-preview', {
  props: {
    content: String,
  },
  template: `<iframe :srcdoc="content" seamless frameborder="0"></iframe>`,
  mounted() {
    this.$el.addEventListener('load', () => {
      this.$el.contentDocument.querySelectorAll('a').forEach(el => {
        el.setAttribute('target', '_blank')
      })
    })
  },
})

new Vue({
  el: '#app',
  data() {
    let itemsPerPage
    if (typeof(Storage) !== "undefined") {
      itemsPerPage = parseInt(localStorage.getItem("itemsPerPage"), 10)
      if (!itemsPerPage) {
        itemsPerPage = 50
        localStorage.setItem("itemsPerPage", 50)
      }
    }

    return {
      host: apiHost,

      cache: {},
      previewAllHeaders: false,
  
      eventsPending: {},
      eventCount: 0,
      eventDone: 0,
      eventFailed: 0,
      
      hasEventSource: false,
      source: null,
  
      itemsPerPage: 50,
      startIndex: 0,

      itemsPerPage,

      messages: [],
      startMessages: 0,
      countMessages: 0,
      totalMessages: 0,

      searchMessages: [],
      startSearchMessages: 0,
      countSearchMessages: 0,
      totalSearchMessages: 0,

      jim: null,

      smtpmech: "NONE",
      selectedOutgoingSMTP: "",
      saveSMTPServer: false,

      searching: false,
      searchText: "",
      preview: null,
      outgoingSMTP: {},  // TODO: value makes sense ?
      keepopen: false,
    }
  },
  mounted() {
    this.openStream()
    if (typeof(Notification) !== "undefined") {
      Notification.requestPermission()
    }

    this.refresh()

    this.getJim()
  },
  methods: {
    getJim() {
      var url = this.host + 'api/v2/jim'
      $.get(url).done(data => {
        this.jim = data
      }).fail(() => {
        this.jim = null
      })
    },
    enableJim() {
      var url = this.host + 'api/v2/jim'
      $.post(url).done(data => {
        this.getJim()
      })
    },
    disableJim() {
      var url = this.host + 'api/v2/jim'
      $.ajax(url, { method: 'DELETE' }).done(data => {
        this.getJim()
      })
    },
  
    getMoment(a) {
      return moment(a)
    },
    backToInbox() {
      this.preview = null
      this.searching = false
    },
    backToInboxFirst() {
      this.preview = null
      this.startIndex = 0
      this.startMessages = 0
      this.searching = false
      this.refresh()
    },

    toggleStream() {
      this.source == null ? this.openStream() : this.closeStream()
    },
    openStream() {
      var host = this.host.replace(/^http/, 'ws') || (
        location.protocol.replace(/^http/, 'ws') + '//'
        + location.hostname
        + (location.port ? ':' + location.port : '')
        + location.pathname
      )
      this.source = new WebSocket(host + 'api/v2/websocket')
      this.source.addEventListener('message', e => {
        this.totalMessages++
        if (this.startIndex > 0) {
          this.startIndex++
          this.startMessages++
          return
        }
        if (this.countMessages < this.itemsPerPage) {
          this.countMessages++
        }
        var message = JSON.parse(e.data)
        this.messages.unshift(message)
        while (this.messages.length > this.itemsPerPage) {
          this.messages.pop()
        }
        if (typeof(Notification) !== "undefined") {
          this.createNotification(message)
        }
      }, false)
      this.source.addEventListener('open', e => {
        this.hasEventSource = true
      }, false)
      this.source.addEventListener('error', e => {
        //if(e.readyState == EventSource.CLOSED) {
        this.hasEventSource = false
        //}
      }, false)
    },
    closeStream() {
      this.source.close()
      this.source = null
      this.hasEventSource = false
    },

    createNotification(message) {
      var title = "Mail from " + this.getSender(message)
      var options = {
        body: this.tryDecodeMime(message.Content.Headers["Subject"][0]),
        tag: "MailHog",
        icon: "images/hog.png"
      }
      var notification = new Notification(title, options)
      notification.addEventListener('click', e => {
        this.selectMessage(message)
        window.focus()
        notification.close()
      })
    },

    tryDecodeMime(str) {
      // Handle [0] indexing on undefined
      return unescapeFromMime(str)
    },
  
    resizePreview() {
      $('.tab-content').height($(window).innerHeight() - $('.tab-content').offset().top)
      $('.tab-content .tab-pane').height($(window).innerHeight() - $('.tab-content').offset().top)
    },
  
    getSender(message) {
      return this.tryDecodeMime(
        this.getDisplayName(message.Content.Headers["From"][0])
        || message.From.Mailbox + "@" + message.From.Domain
      )
    },

    getDisplayName(value) {
      if (!value) { return "" }
  
      res = value.match(/(.*)\<(.*)\>/)
  
      if (res) {
        if (res[1].trim().length > 0) {
          return res[1].trim()
        }
        return res[2]
      }
      return value
    },

    startEvent(name, args, glyphicon) {
      var eID = guid()
      //console.log("Starting event '" + name + "' with id '" + eID + "'")
      const $vm = this
      var e = {
        id: eID,
        name: name,
        started: new Date(),
        complete: false,
        failed: false,
        args: args,
        glyphicon: glyphicon,
        getClass() {
          // FIXME bit nasty
          if (this.failed) {
            return "bg-danger"
          }
          if (this.complete) {
            return "bg-success"
          }
          return "bg-warning" // pending
        },
        done() {
          //delete $vm.eventsPending[eID]
          this.complete = true
          $vm.eventDone++
          if (this.failed) {
            // console.log("Failed event '" + e.name + "' with id '" + eID + "'")
          } else {
            // console.log("Completed event '" + e.name + "' with id '" + eID + "'")
            setTimeout(() => {
              this.remove()
            }, 10000)
          }
        },
        fail() {
          $vm.eventFailed++
          this.failed = true
          this.done()
        },
        remove() {
          // console.log("Deleted event '" + e.name + "' with id '" + eID + "'")
          if (e.failed) {
            $vm.eventFailed--
          }
          $vm.$delete($vm.eventsPending, eID)
          $vm.eventDone--
          $vm.eventCount--
          return false
        }
      }
      this.$set(this.eventsPending, eID, e)
      this.eventCount++
      return e
    },

    messagesDisplayed() {
      return $('.messages .msglist-message').length
    },
  
    refresh() {
      if (this.searching) {
        return this.refreshSearch()
      }
      var e = this.startEvent("Loading messages", null, "glyphicon-download")
      var url = this.host + 'api/v2/messages'
      if (this.startIndex > 0) {
        url += "?start=" + this.startIndex + "&limit=" + this.itemsPerPage
      } else {
        url += "?limit=" + this.itemsPerPage
      }
      $.get(url).done(data => {
        this.messages = data.items
        this.totalMessages = data.total
        this.countMessages = data.count
        this.startMessages = data.start
        e.done()
      })
    },
  
    showNewer() {
      this.startIndex -= this.itemsPerPage
      if(this.startIndex < 0) {
        this.startIndex = 0
      }
      this.refresh()
    },
  
    showUpdated(i) {
      this.itemsPerPage = parseInt(i, 10)
      if (typeof(Storage) !== "undefined") {
          localStorage.setItem("itemsPerPage", this.itemsPerPage)
      }
      this.refresh()
    },
  
    showOlder() {
      this.startIndex += this.itemsPerPage
      this.refresh()
    },
  
    search(kind, text) {
      this.searching = true
      this.searchKind = kind
      this.searchedText = text
      this.searchText = ""
      this.startSearchMessages = 0
      this.countSearchMessages = 0
      this.totalSearchMessages = 0
      this.refreshSearch()
    },
  
    refreshSearch() {
      var url = this.host + 'api/v2/search?kind=' + this.searchKind + '&query=' + this.searchedText
      if (this.startIndex > 0) {
        url += "&start=" + this.startIndex
      }
      $.get(url).done(data => {
        this.searchMessages = data.items
        this.totalSearchMessages = data.total
        this.countSearchMessages = data.count
        this.startSearchMessages = data.start
      })
    },
  
    hasSelection() {
      return $(".messages :checked").length > 0 ? true : false
    },
  
    selectMessage(message) {
      // TODO: setTimeout ?
      setTimeout(() => {
        this.resizePreview()
      }, 0)
      if (this.cache[message.ID]) {
        this.preview = this.cache[message.ID]
        //reflow();
      } else {
        this.preview = message
        var e = this.startEvent("Loading message", message.ID, "glyphicon-download-alt")
        $.get(this.host + 'api/v1/messages/' + message.ID).done(data => {
          this.cache[message.ID] = data
  
          // FIXME
          // - nested mime parts can't be downloaded
          data.$cidMap = {}
          if (data.MIME && data.MIME.Parts.length) {
            for (let p in data.MIME.Parts) {
              for (let h in data.MIME.Parts[p].Headers) {
                if (h.toLowerCase() == "content-id") {
                  cid = data.MIME.Parts[p].Headers[h][0]
                  cid = cid.substr(1,cid.length-2)
                  data.$cidMap[cid] = "api/v1/messages/" + message.ID + "/mime/part/" + p + "/download"
                }
              }
            }
          }
          console.log(data.$cidMap)
          // TODO
          // - scan HTML parts for elements containing CID URI and replace
  
          let h = this.getMessageHTML(data)
          for (c in data.$cidMap) {
            const str = "cid:" + c
            const pat = str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1")
            h = h.replace(new RegExp(pat, 'g'), data.$cidMap[c])
          }
          // TODO: try with complex HTML emails
          data.previewHTML = h
          this.preview = data
          preview = this.cache[message.ID]
          //reflow();
          e.done()
        })
      }
    },
  
    toggleHeaders(val) {
      this.previewAllHeaders = val
      // TODO: setTimeout
      setTimeout(() => {
        this.resizePreview()
      }, 0)
      var t = window.setInterval(() => {
        if (val) {
          if($('#hide-headers').length) {
            window.clearInterval(t)
            //reflow();
          }
        } else {
          if ($('#show-headers').length) {
            window.clearInterval(t)
            //reflow();
          }
        }
      }, 10)
    },
  
    fileSize(bytes) {
      return filesize(bytes)
    },
  
    tryDecodeContent(message) {
      var charset = "UTF-8"
      if (message.Content.Headers["Content-Type"][0]) {
        // TODO
      }
  
      var content = message.Content.Body
      var contentTransferEncoding = message.Content.Headers["Content-Transfer-Encoding"][0]
  
      if (contentTransferEncoding) {
        switch (contentTransferEncoding.toLowerCase()) {
          case 'quoted-printable':
            content = content.replace(/=[\r\n]+/gm,"")
            content = unescapeFromQuotedPrintableWithoutRFC2047(content, charset)
            break
          case 'base64':
            // remove line endings to give original base64-encoded string
            content = content.replace(/\r?\n|\r/gm,"")
            content = unescapeFromBase64(content, charset)
            break
        }
      }
  
      return content
    },
  
    formatMessagePlain(message) {
      var body = this.getMessagePlain(message)
      var escaped = this.escapeHtml(body)
      var formatted = escaped.replace(
        /(https?:\/\/)([-[\]A-Za-z0-9._~:/?#@!$()*+,;=%]|&amp;|&#39;)+/g,
        '<a href="$&" target="_blank">$&</a>'
      )
      return formatted
    },
  
    escapeHtml(html) {
      var entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }
      return html.replace(/[&<>"']/g, function (s) {
        return entityMap[s]
      })
    },
  
    getMessagePlain(message) {
      if (
        message.Content.Headers
        && message.Content.Headers["Content-Type"]
        && message.Content.Headers["Content-Type"][0].match("text/plain")
      ) {
        return this.tryDecode(message.Content)
      }
      var l = this.findMatchingMIME(message, "text/plain")
      if(l != null && l !== "undefined") {
        return this.tryDecode(l)
      }
      return message.Content.Body
    },
  
    findMatchingMIME(part, mime) {
      // TODO cache results
      if (part.MIME) {
        for (var p in part.MIME.Parts) {
          if ("Content-Type" in part.MIME.Parts[p].Headers) {
            if (part.MIME.Parts[p].Headers["Content-Type"].length > 0) {
              if (part.MIME.Parts[p].Headers["Content-Type"][0].match(mime + ";?.*")) {
                return part.MIME.Parts[p]
              } else if (part.MIME.Parts[p].Headers["Content-Type"][0].match(/multipart\/.*/)) {
                var f = this.findMatchingMIME(part.MIME.Parts[p], mime)
                if (f != null) {
                  return f
                }
              }
            }
          }
        }
      }
      return null
    },
    hasHTML(message) {
      // TODO cache this
      for (var header in message.Content.Headers) {
        if (header.toLowerCase() == 'content-type') {
          if (message.Content.Headers[header][0].match("text/html")) {
            return true
          }
        }
      }
  
      var l = this.findMatchingMIME(message, "text/html")
      if (l != null && l !== "undefined") {
        return true
      }
      return false
    },
    getMessageHTML(message) {
      console.log(message)
      for (var header in message.Content.Headers) {
        if (header.toLowerCase() == 'content-type') {
          if (message.Content.Headers[header][0].match("text/html")) {
            return this.tryDecode(message.Content)
          }
        }
      }
  
      var l = this.findMatchingMIME(message, "text/html")
      if (l != null && l !== "undefined") {
        return this.tryDecode(l)
      }
      return "<HTML not found>"
    },
    tryDecode(l) {
      if (l.Headers && l.Headers["Content-Type"] && l.Headers["Content-Transfer-Encoding"]) {
        return this.tryDecodeContent({Content: l})
      } else {
        return l.Body
      }
    },
    date(timestamp) {
      return (new Date(timestamp)).toString()
    },
  
    deleteAll() {
      $('#confirm-delete-all').modal('show')
    },
  
    releaseOne(message) {
      this.releasing = message
  
      $.get(this.host + 'api/v2/outgoing-smtp').done(data => {
        this.outgoingSMTP = data
        $('#release-one').modal('show')
      })
    },
    confirmReleaseMessage() {
      $('#release-one').modal('hide')
      var message = this.releasing
      this.releasing = null
  
      var e = this.startEvent("Releasing message", message.ID, "glyphicon-share")
  
      let authcfg
      if ($('#release-message-outgoing').val().length > 0) {
        authcfg = {
          name: $('#release-message-outgoing').val(),
          email: $('#release-message-email').val(),
        }
      } else {
        authcfg = {
          email: $('#release-message-email').val(),
          host: $('#release-message-smtp-host').val(),
          port: $('#release-message-smtp-port').val(),
          mechanism: $('#release-message-smtp-mechanism').val(),
          username: $('#release-message-smtp-username').val(),
          password: $('#release-message-smtp-password').val(),
          save: $('#release-message-save').is(":checked") ? true : false,
          name: $('#release-message-server-name').val(),
        }
      }
  
      $.post(this.host + 'api/v1/messages/' + message.ID + '/release', authcfg).done(() => {
        e.done()
      }).fail(err => {
        e.fail()
        e.error = err
      })
    },
  
    getSource(message) {
      var source = ""
      $.each(message.Content.Headers, function(k, v) {
        source += k + ": " + v + "\n"
      })
      source += "\n"
      source += message.Content.Body
      return source
    },
  
    deleteAllConfirm() {
      $('#confirm-delete-all').modal('hide')
      var e = this.startEvent("Deleting all messages", null, "glyphicon-remove-circle")
      $.ajax(
        this.host + 'api/v1/messages',
        { method: 'DELETE', dataType: 'text' }
      ).done(() => {
        this.refresh()
        this.preview = null
        e.done()
      })
    },
  
    deleteOne(message) {
      var e = this.startEvent("Deleting message", message.ID, "glyphicon-remove")
      $.ajax(
        this.host + 'api/v1/messages/' + message.ID,
        { method: 'DELETE', dataType: 'text' }
      ).done(() => {
        if (this.preview && this.preview._id == message._id) {
          this.preview = null
        }
        this.refresh()
        e.done()
      })
    },
  },

})
