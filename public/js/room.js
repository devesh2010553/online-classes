// EduStream — Room Controller v3
// Features: 4K video, pin, speaker detection, screen share w/ mobile fallback, PWA

(function () {
  "use strict";

  // ── URL params ──────────────────────────────────────────────────────────────
  var params   = new URLSearchParams(window.location.search);
  var roomId   = params.get("room");
  var userName = (params.get("name") || "Anonymous").trim().slice(0, 32);

  if (!roomId) {
    alert("No class code found. Redirecting…");
    window.location.href = "/";
    return;
  }

  // ── DOM refs ────────────────────────────────────────────────────────────────
  var videoGrid         = document.getElementById("videoGrid");
  var thumbStrip        = document.getElementById("thumbStrip");
  var chatPanel         = document.getElementById("chatPanel");
  var chatMessages      = document.getElementById("chatMessages");
  var chatInput         = document.getElementById("chatInput");
  var sendMsgBtn        = document.getElementById("sendMsgBtn");
  var micBtn            = document.getElementById("micBtn");
  var camBtn            = document.getElementById("camBtn");
  var shareScreenBtn    = document.getElementById("shareScreenBtn");
  var raiseHandBtn      = document.getElementById("raiseHandBtn");
  var toggleChatBtn     = document.getElementById("toggleChatBtn");
  var closeChatBtn      = document.getElementById("closeChatBtn");
  var leaveBtn          = document.getElementById("leaveBtn");
  var leaveModal        = document.getElementById("leaveModal");
  var cancelLeave       = document.getElementById("cancelLeave");
  var confirmLeave      = document.getElementById("confirmLeave");
  var sessionTimerEl    = document.getElementById("sessionTimer");
  var participantCount  = document.getElementById("participantCount");
  var roomCodeEl        = document.getElementById("roomCode");
  var chatUnread        = document.getElementById("chatUnread");
  var toastContainer    = document.getElementById("toastContainer");
  var screenShareFallback = document.getElementById("screenShareFallback");
  var ssfClose          = document.getElementById("ssfClose");

  // ── State ───────────────────────────────────────────────────────────────────
  var localStream   = null;
  var screenStream  = null;
  var isMicOn       = true;
  var isCamOn       = true;
  var isHandRaised  = false;
  var isChatOpen    = false;
  var unreadCount   = 0;
  var sessionStart  = Date.now();
  var pinnedId      = null;
  var activeSpeaker = null;
  var speakerTimer  = null;
  var peers         = {};   // peerId → RTCPeerConnection
  var peerNames     = {};   // peerId → name
  var audioAnalysers = {};  // id → { ctx, interval }

  // ── Socket ──────────────────────────────────────────────────────────────────
  var socket = io({ transports: ["websocket", "polling"] });

  // ── Room code display ───────────────────────────────────────────────────────
  roomCodeEl.textContent = roomId;

  // ── Session timer ───────────────────────────────────────────────────────────
  setInterval(function () {
    var ms    = Date.now() - sessionStart;
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var p = function (n) { return String(n).padStart(2, "0"); };
    sessionTimerEl.textContent = h > 0
      ? p(h) + ":" + p(m) + ":" + p(s)
      : p(m) + ":" + p(s);
  }, 1000);

  // ──────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────────────────────────────────
  function toast(msg, type, duration) {
    type     = type || "info";
    duration = duration || 3500;
    var el   = document.createElement("div");
    el.className = "toast " + type;
    var icon = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
    el.innerHTML = "<span>" + icon + "</span> " + msg;
    toastContainer.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateY(12px)";
      el.style.transition = "opacity 0.3s, transform 0.3s";
      setTimeout(function () { el.remove(); }, 350);
    }, duration);
  }

  function getInitials(name) {
    return (name || "?").split(" ").slice(0, 2)
      .map(function (w) { return w[0] || ""; })
      .join("").toUpperCase() || "?";
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MEDIA — try 4K → 1080p → 720p → SD → audio-only
  // ──────────────────────────────────────────────────────────────────────────
  var VIDEO_ATTEMPTS = [
    { label: "4K",     v: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } },
    { label: "1080p",  v: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } },
    { label: "720p",   v: { width: { ideal: 1280 }, height: { ideal: 720  }, frameRate: { ideal: 30 } } },
    { label: "480p",   v: { width: { ideal: 640  }, height: { ideal: 480  } } },
    { label: "audio",  v: false },
  ];

  var AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  function getMedia() {
    tryNextQuality(0);
  }

  function tryNextQuality(idx) {
    if (idx >= VIDEO_ATTEMPTS.length) {
      // Complete failure — join without any media
      toast("No camera/mic — joining as viewer", "error");
      localStream = new MediaStream();
      addVideoTile(localStream, socket.id, true, userName, false, false);
      socket.emit("join-room", { roomId: roomId, name: userName });
      return;
    }

    var attempt = VIDEO_ATTEMPTS[idx];
    var constraints = {
      audio: AUDIO_CONSTRAINTS,
      video: attempt.v,
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(function (stream) {
        localStream = stream;
        var hasVideo = stream.getVideoTracks().length > 0;
        if (idx === 0) {
          toast("Camera: " + attempt.label, "success", 2000);
        } else if (idx < 4) {
          toast("Camera: " + attempt.label, "info", 2000);
        }
        addVideoTile(stream, socket.id, true, userName, true, hasVideo);
        setupAudioAnalyser(stream, socket.id, true);
        socket.emit("join-room", { roomId: roomId, name: userName });
      })
      .catch(function (err) {
        console.warn("Media attempt " + attempt.label + " failed:", err.name);
        tryNextQuality(idx + 1);
      });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIO ANALYSER — speaking detection
  // ──────────────────────────────────────────────────────────────────────────
  function setupAudioAnalyser(stream, id, isLocal) {
    if (!stream.getAudioTracks().length) return;
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      var ctx      = new AudioContext();
      var source   = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var prevSpeaking = false;

      var interval = setInterval(function () {
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var speaking = avg > 10;

        // Update tile border
        var tile = document.getElementById("tile-" + id);
        if (tile) tile.classList.toggle("is-speaker", speaking);

        // Update thumb
        var thumb = thumbStrip.querySelector("[data-id='" + id + "']");
        if (thumb) thumb.classList.toggle("is-speaker", speaking);

        if (speaking !== prevSpeaking) {
          prevSpeaking = speaking;
          if (isLocal) {
            socket.emit("speaking", { roomId: roomId, isSpeaking: speaking });
          }
          if (speaking && !pinnedId) {
            activeSpeaker = id;
            updateSpeakerProminence();
            clearTimeout(speakerTimer);
            speakerTimer = setTimeout(function () {
              if (!pinnedId) { activeSpeaker = null; updateSpeakerProminence(); }
            }, 3000);
          }
        }
      }, 200);

      audioAnalysers[id] = { ctx: ctx, interval: interval };
    } catch (e) {
      console.warn("AudioAnalyser failed:", e);
    }
  }

  function teardownAudioAnalyser(id) {
    var a = audioAnalysers[id];
    if (!a) return;
    clearInterval(a.interval);
    try { a.ctx.close(); } catch (_) {}
    delete audioAnalysers[id];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GRID LAYOUT
  // ──────────────────────────────────────────────────────────────────────────
  function updateGridClass() {
    var tiles = videoGrid.querySelectorAll(".video-container");
    var count = tiles.length;
    videoGrid.className = "video-grid";

    if (pinnedId) {
      videoGrid.classList.add("has-pinned");
      tiles.forEach(function (t) {
        t.style.display = (t.id === "tile-" + pinnedId) ? "" : "none";
      });
      return;
    }

    // Show all tiles
    tiles.forEach(function (t) { t.style.display = ""; });

    if      (count === 1)  videoGrid.classList.add("count-1");
    else if (count === 2)  videoGrid.classList.add("count-2");
    else if (count <= 4)   videoGrid.classList.add("count-34");
    else                   videoGrid.classList.add("count-many");

    updateSpeakerProminence();
  }

  function updateSpeakerProminence() {
    videoGrid.querySelectorAll(".video-container").forEach(function (t) {
      t.classList.remove("is-prominent");
    });
    if (activeSpeaker) {
      var t = document.getElementById("tile-" + activeSpeaker);
      if (t) t.classList.add("is-prominent");
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // THUMBNAIL STRIP
  // ──────────────────────────────────────────────────────────────────────────
  function refreshThumbStrip() {
    thumbStrip.innerHTML = "";
    if (!pinnedId) {
      thumbStrip.style.display = "none";
      return;
    }
    thumbStrip.style.display = "flex";

    var tiles = Array.from(videoGrid.querySelectorAll(".video-container"));
    tiles.forEach(function (tile) {
      var id   = tile.id.replace("tile-", "");
      var name = tile.dataset.name || id.slice(0, 8);
      var srcObj = tile._video ? tile._video.srcObject : null;

      var thumb = document.createElement("div");
      thumb.className = "thumb-tile";
      thumb.dataset.id = id;
      if (id === pinnedId)      thumb.classList.add("active-thumb");
      if (id === activeSpeaker) thumb.classList.add("is-speaker");

      var tv = document.createElement("video");
      tv.autoplay   = true;
      tv.playsInline = true;
      tv.muted      = (id === socket.id);
      if (srcObj) tv.srcObject = srcObj;
      thumb.appendChild(tv);

      var nameEl = document.createElement("div");
      nameEl.className = "thumb-name";
      nameEl.textContent = (id === socket.id) ? "You" : name;
      thumb.appendChild(nameEl);

      thumb.addEventListener("click", function () { pinTile(id); });
      thumbStrip.appendChild(thumb);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PIN / UNPIN
  // ──────────────────────────────────────────────────────────────────────────
  function pinTile(id) {
    var wasPinned = (pinnedId === id);

    // Clear old pin
    if (pinnedId) {
      var prev = document.getElementById("tile-" + pinnedId);
      if (prev) {
        prev.classList.remove("pinned");
        var oldTag = prev.querySelector(".pin-tag");
        if (oldTag) oldTag.remove();
      }
      pinnedId = null;
    }

    if (!wasPinned) {
      var tile = document.getElementById("tile-" + id);
      if (!tile) return;
      pinnedId = id;
      tile.classList.add("pinned");
      var nameEl = tile.querySelector(".name");
      if (nameEl) {
        var tag = document.createElement("span");
        tag.className   = "pin-tag";
        tag.textContent = "📌";
        nameEl.appendChild(tag);
      }
      var dispName = tile.dataset.name || "Participant";
      toast("📌 " + dispName + " pinned", "info", 2000);
    }

    updateGridClass();
    refreshThumbStrip();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIDEO TILES
  // ──────────────────────────────────────────────────────────────────────────
  function addVideoTile(stream, id, isLocal, displayName, micOn, camOn) {
    if (document.getElementById("tile-" + id)) return;
    isLocal     = isLocal     !== undefined ? isLocal     : false;
    displayName = displayName || "";
    micOn       = micOn       !== undefined ? micOn       : true;
    camOn       = camOn       !== undefined ? camOn       : true;

    peerNames[id] = displayName;

    var tile = document.createElement("div");
    tile.className = "video-container";
    tile.id        = "tile-" + id;
    tile.dataset.name  = displayName;
    tile.dataset.micOn = String(micOn);
    tile.dataset.camOn = String(camOn);

    // Video element
    var video = document.createElement("video");
    video.srcObject  = stream;
    video.autoplay   = true;
    video.playsInline = true;
    video.muted      = isLocal;
    tile.appendChild(video);

    // Cam-off avatar
    var placeholder = document.createElement("div");
    placeholder.className    = "cam-placeholder";
    placeholder.style.display = camOn ? "none" : "flex";
    var avatar = document.createElement("div");
    avatar.className   = "avatar-circle";
    avatar.textContent = getInitials(displayName);
    placeholder.appendChild(avatar);
    tile.appendChild(placeholder);

    // Pin overlay
    var overlay = document.createElement("div");
    overlay.className = "tile-overlay";
    var pinBtn = document.createElement("button");
    pinBtn.className   = "pin-btn";
    pinBtn.title       = "Pin / Unpin";
    pinBtn.textContent = "📌";
    pinBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      pinTile(id);
    });
    overlay.appendChild(pinBtn);
    tile.appendChild(overlay);

    // Info bar
    var infoBar = document.createElement("div");
    infoBar.className = "video-info";

    var nameSpan = document.createElement("span");
    nameSpan.className   = "name";
    nameSpan.textContent = isLocal ? "You" : (displayName || id.slice(0, 8));
    if (isLocal) {
      var youTag = document.createElement("span");
      youTag.className   = "you-tag";
      youTag.textContent = "YOU";
      nameSpan.appendChild(youTag);
    }

    var mediaIcons = document.createElement("div");
    mediaIcons.className = "media-icons";

    var micIcon = document.createElement("span");
    micIcon.className   = "media-icon";
    micIcon.textContent = micOn ? "🎤" : "🔇";
    if (!micOn) micIcon.classList.add("off");

    var camIcon = document.createElement("span");
    camIcon.className   = "media-icon";
    camIcon.textContent = camOn ? "📷" : "🚫";
    if (!camOn) camIcon.classList.add("off");

    mediaIcons.appendChild(micIcon);
    mediaIcons.appendChild(camIcon);
    infoBar.appendChild(nameSpan);
    infoBar.appendChild(mediaIcons);
    tile.appendChild(infoBar);

    tile._video       = video;
    tile._placeholder = placeholder;
    tile._micIcon     = micIcon;
    tile._camIcon     = camIcon;

    videoGrid.appendChild(tile);
    updateGridClass();
    refreshThumbStrip();
  }

  function removeVideoTile(id) {
    var el = document.getElementById("tile-" + id);
    if (!el) return;
    el.remove();
    teardownAudioAnalyser(id);
    delete peerNames[id];
    if (pinnedId === id)      pinnedId = null;
    if (activeSpeaker === id) activeSpeaker = null;
    updateGridClass();
    refreshThumbStrip();
  }

  function updatePeerMedia(id, micOn, camOn) {
    var tile = document.getElementById("tile-" + id);
    if (!tile) return;
    if (tile._micIcon) {
      tile._micIcon.textContent = micOn ? "🎤" : "🔇";
      tile._micIcon.classList.toggle("off", !micOn);
    }
    if (tile._camIcon) {
      tile._camIcon.textContent = camOn ? "📷" : "🚫";
      tile._camIcon.classList.toggle("off", !camOn);
    }
    if (tile._placeholder) {
      tile._placeholder.style.display = camOn ? "none" : "flex";
    }
  }

  function syncLocalIcons() {
    var tile = document.getElementById("tile-" + socket.id);
    if (!tile) return;
    if (tile._micIcon) {
      tile._micIcon.textContent = isMicOn ? "🎤" : "🔇";
      tile._micIcon.classList.toggle("off", !isMicOn);
    }
    if (tile._camIcon) {
      tile._camIcon.textContent = isCamOn ? "📷" : "🚫";
      tile._camIcon.classList.toggle("off", !isCamOn);
    }
    if (tile._placeholder) {
      tile._placeholder.style.display = isCamOn ? "none" : "flex";
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WebRTC PEERS
  // ──────────────────────────────────────────────────────────────────────────
  var ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478"  },
      // Add TURN here for production cross-NAT support:
      // { urls: "turn:YOUR_TURN_SERVER", username: "user", credential: "pass" }
    ],
    bundlePolicy:   "max-bundle",
    rtcpMuxPolicy:  "require",
  };

  function createPeer(id, initiator, remoteName) {
    if (peers[id]) { peers[id].close(); }

    var peer = new RTCPeerConnection(ICE_CONFIG);
    peers[id]     = peer;
    peerNames[id] = remoteName;

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        peer.addTrack(track, localStream);
      });
    }

    // Receive remote tracks
    peer.ontrack = function (e) {
      var remoteStream = e.streams[0];
      var tile = document.getElementById("tile-" + id);
      if (tile) {
        tile._video.srcObject = remoteStream;
      } else {
        addVideoTile(remoteStream, id, false, remoteName || "Peer", true, true);
      }
      if (e.track.kind === "audio") {
        teardownAudioAnalyser(id);
        setupAudioAnalyser(remoteStream, id, false);
      }
    };

    // ICE candidates
    peer.onicecandidate = function (e) {
      if (e.candidate) {
        socket.emit("signal", { to: id, data: { candidate: e.candidate } });
      }
    };

    // Connection state changes
    peer.onconnectionstatechange = function () {
      var state = peer.connectionState;
      if (state === "connected") {
        applyMaxBandwidth(peer);
      } else if (state === "failed") {
        toast("Connection issue with " + (peerNames[id] || "peer") + ". Reconnecting…", "error");
        if (initiator) {
          peer.restartIce();
          peer.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: true })
            .then(function (o) { return peer.setLocalDescription(o); })
            .then(function () {
              socket.emit("signal", { to: id, data: { sdp: peer.localDescription } });
            })
            .catch(console.error);
        }
      }
    };

    if (initiator) {
      peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then(function (offer) { return peer.setLocalDescription(offer); })
        .then(function () {
          socket.emit("signal", { to: id, data: { sdp: peer.localDescription } });
        })
        .catch(console.error);
    }

    return peer;
  }

  function applyMaxBandwidth(peer) {
    try {
      peer.getSenders().forEach(function (sender) {
        if (sender.track && sender.track.kind === "video") {
          var params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          params.encodings[0].maxBitrate     = 8000000; // 8 Mbps
          params.encodings[0].maxFramerate   = 60;
          params.encodings[0].scaleResolutionDownBy = 1.0;
          sender.setParameters(params).catch(function () {});
        }
      });
    } catch (e) { console.warn("Bandwidth tweak failed:", e); }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOCKET EVENTS
  // ──────────────────────────────────────────────────────────────────────────
  socket.on("connect", function () {
    console.log("Socket connected:", socket.id);
  });

  socket.on("all-users", function (users) {
    users.forEach(function (user) {
      addVideoTile(new MediaStream(), user.id, false, user.name, true, true);
      createPeer(user.id, true, user.name);
    });
  });

  socket.on("user-joined", function (user) {
    toast(user.name + " joined the class", "success");
    addVideoTile(new MediaStream(), user.id, false, user.name, true, true);
    createPeer(user.id, false, user.name);
  });

  socket.on("signal", function (payload) {
    var from = payload.from;
    var data = payload.data;
    var peer = peers[from];
    if (!peer) {
      var tile       = document.getElementById("tile-" + from);
      var remoteName = tile ? tile.dataset.name : "Peer";
      peer = createPeer(from, false, remoteName);
    }
    var p = Promise.resolve();
    if (data.sdp) {
      p = peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function () {
          if (data.sdp.type === "offer") {
            return peer.createAnswer()
              .then(function (ans) { return peer.setLocalDescription(ans); })
              .then(function () {
                socket.emit("signal", { to: from, data: { sdp: peer.localDescription } });
              });
          }
        });
    }
    if (data.candidate) {
      p = p.then(function () {
        return peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      });
    }
    p.catch(function (err) { console.error("Signal error:", err); });
  });

  socket.on("user-left", function (id) {
    var tile = document.getElementById("tile-" + id);
    var name = tile ? tile.dataset.name : "A participant";
    toast(name + " left the class");
    if (peers[id]) { peers[id].close(); delete peers[id]; }
    removeVideoTile(id);
  });

  socket.on("participant-count", function (count) {
    participantCount.textContent = count;
  });

  socket.on("peer-media-state", function (payload) {
    updatePeerMedia(payload.id, payload.micOn, payload.camOn);
  });

  socket.on("peer-raised-hand", function (payload) {
    toast("✋ " + payload.name + " raised their hand", "info");
    var tile = document.getElementById("tile-" + payload.id);
    if (tile && !tile.querySelector(".hand-badge")) {
      var badge = document.createElement("div");
      badge.className   = "hand-badge";
      badge.textContent = "✋ Raised hand";
      tile.appendChild(badge);
      setTimeout(function () { badge.remove(); }, 8000);
    }
  });

  socket.on("peer-speaking", function (payload) {
    var tile = document.getElementById("tile-" + payload.id);
    if (tile) tile.classList.toggle("is-speaker", payload.isSpeaking);
    var thumb = thumbStrip.querySelector("[data-id='" + payload.id + "']");
    if (thumb) thumb.classList.toggle("is-speaker", payload.isSpeaking);
    if (payload.isSpeaking && !pinnedId) {
      activeSpeaker = payload.id;
      updateSpeakerProminence();
      clearTimeout(speakerTimer);
      speakerTimer = setTimeout(function () {
        if (!pinnedId) { activeSpeaker = null; updateSpeakerProminence(); }
      }, 3000);
    }
  });

  socket.on("peer-screen-share", function (payload) {
    var tile = document.getElementById("tile-" + payload.id);
    if (tile) tile.classList.toggle("is-sharing", payload.isSharing);
    if (payload.isSharing) {
      toast("🖥️ " + payload.name + " is sharing screen", "info");
      if (!pinnedId) pinTile(payload.id);
    } else {
      toast("🖥️ " + payload.name + " stopped sharing", "info");
      if (pinnedId === payload.id) pinTile(payload.id); // unpin
    }
  });

  socket.on("chat-message", function (msg) {
    appendChatMessage(msg.sender, msg.message, false, msg.ts);
    if (!isChatOpen) {
      unreadCount++;
      chatUnread.textContent   = unreadCount;
      chatUnread.style.display = "";
    }
  });

  socket.on("disconnect", function () {
    toast("Disconnected from server", "error");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CHAT
  // ──────────────────────────────────────────────────────────────────────────
  function appendChatMessage(sender, message, isSelf, ts) {
    ts = ts || Date.now();

    if (!sender) {
      var sys = document.createElement("div");
      sys.className   = "chat-system";
      sys.textContent = message;
      chatMessages.appendChild(sys);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "chat-msg " + (isSelf ? "self" : "other");

    if (!isSelf) {
      var senderEl = document.createElement("span");
      senderEl.className   = "msg-sender";
      senderEl.textContent = sender;
      wrap.appendChild(senderEl);
    }

    var bubble = document.createElement("div");
    bubble.className   = "msg-bubble";
    bubble.textContent = message;
    wrap.appendChild(bubble);

    var timeEl = document.createElement("span");
    timeEl.className   = "msg-time";
    timeEl.textContent = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    wrap.appendChild(timeEl);

    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function sendMessage() {
    var msg = chatInput.value.trim();
    if (!msg) return;
    var ts = Date.now();
    socket.emit("chat-message", { roomId: roomId, sender: userName, message: msg, ts: ts });
    appendChatMessage(userName, msg, true, ts);
    chatInput.value = "";
  }

  sendMsgBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CONTROL BUTTONS
  // ──────────────────────────────────────────────────────────────────────────

  // Mic
  micBtn.addEventListener("click", function () {
    isMicOn = !isMicOn;
    if (localStream) {
      localStream.getAudioTracks().forEach(function (t) { t.enabled = isMicOn; });
    }
    micBtn.classList.toggle("active", isMicOn);
    micBtn.classList.toggle("muted",  !isMicOn);
    micBtn.querySelector(".ctrl-label").textContent = isMicOn ? "Mute" : "Unmute";
    syncLocalIcons();
    socket.emit("media-state", { roomId: roomId, micOn: isMicOn, camOn: isCamOn });
  });

  // Camera
  camBtn.addEventListener("click", function () {
    isCamOn = !isCamOn;
    if (localStream) {
      localStream.getVideoTracks().forEach(function (t) { t.enabled = isCamOn; });
    }
    camBtn.classList.toggle("active", isCamOn);
    camBtn.classList.toggle("muted",  !isCamOn);
    camBtn.querySelector(".ctrl-label").textContent = isCamOn ? "Camera" : "Cam Off";
    syncLocalIcons();
    socket.emit("media-state", { roomId: roomId, micOn: isMicOn, camOn: isCamOn });
  });

  // Chat open/close
  toggleChatBtn.addEventListener("click", function () {
    isChatOpen ? closeChat() : openChat();
  });
  closeChatBtn.addEventListener("click", closeChat);

  function openChat() {
    chatPanel.style.display = "flex";
    isChatOpen     = true;
    unreadCount    = 0;
    chatUnread.style.display = "none";
    toggleChatBtn.classList.add("active");
    setTimeout(function () { chatInput.focus(); }, 200);
  }
  function closeChat() {
    chatPanel.style.display = "none";
    isChatOpen = false;
    toggleChatBtn.classList.remove("active");
  }

  // Raise hand
  raiseHandBtn.addEventListener("click", function () {
    isHandRaised = !isHandRaised;
    raiseHandBtn.classList.toggle("hand-active", isHandRaised);
    raiseHandBtn.querySelector(".ctrl-label").textContent = isHandRaised ? "Lower" : "Hand";
    if (isHandRaised) {
      socket.emit("raise-hand", { roomId: roomId });
      toast("You raised your hand ✋");
      setTimeout(function () {
        if (isHandRaised) {
          isHandRaised = false;
          raiseHandBtn.classList.remove("hand-active");
          raiseHandBtn.querySelector(".ctrl-label").textContent = "Hand";
        }
      }, 30000);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SCREEN SHARE
  // ──────────────────────────────────────────────────────────────────────────
  shareScreenBtn.addEventListener("click", function () {
    if (screenStream) {
      stopScreenShare();
      return;
    }
    // Mobile fallback
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || isMobileDevice()) {
      screenShareFallback.style.display = "flex";
      return;
    }
    startScreenShare();
  });

  ssfClose.addEventListener("click", function () {
    screenShareFallback.style.display = "none";
  });

  function startScreenShare() {
    navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: true,
    })
    .then(function (stream) {
      screenStream = stream;
      var screenTrack = stream.getVideoTracks()[0];

      // Replace video track in all peers
      Object.values(peers).forEach(function (peer) {
        var sender = peer.getSenders().find(function (s) { return s.track && s.track.kind === "video"; });
        if (sender) sender.replaceTrack(screenTrack).catch(console.error);
      });

      // Update local tile
      var localTile = document.getElementById("tile-" + socket.id);
      if (localTile) {
        localTile._video.srcObject = stream;
        localTile.classList.add("is-sharing");
      }

      shareScreenBtn.classList.add("screen-active");
      shareScreenBtn.querySelector(".ctrl-label").textContent = "Stop";
      socket.emit("screen-share-state", { roomId: roomId, isSharing: true });
      toast("Screen sharing started 🖥️", "success");

      screenTrack.addEventListener("ended", stopScreenShare);
    })
    .catch(function (err) {
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        toast("Screen share failed: " + err.message, "error");
      }
      screenStream = null;
    });
  }

  function stopScreenShare() {
    if (!screenStream) return;
    var videoTrack = localStream && localStream.getVideoTracks()[0];
    Object.values(peers).forEach(function (peer) {
      var sender = peer.getSenders().find(function (s) { return s.track && s.track.kind === "video"; });
      if (sender && videoTrack) sender.replaceTrack(videoTrack).catch(console.error);
    });
    var localTile = document.getElementById("tile-" + socket.id);
    if (localTile) {
      if (localStream) localTile._video.srcObject = localStream;
      localTile.classList.remove("is-sharing");
    }
    screenStream.getTracks().forEach(function (t) { t.stop(); });
    screenStream = null;
    shareScreenBtn.classList.remove("screen-active");
    shareScreenBtn.querySelector(".ctrl-label").textContent = "Share";
    socket.emit("screen-share-state", { roomId: roomId, isSharing: false });
    toast("Screen sharing stopped");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LEAVE
  // ──────────────────────────────────────────────────────────────────────────
  leaveBtn.addEventListener("click", function () {
    leaveModal.style.display = "flex";
  });
  cancelLeave.addEventListener("click", function () {
    leaveModal.style.display = "none";
  });
  confirmLeave.addEventListener("click", cleanupAndLeave);

  function cleanupAndLeave() {
    Object.keys(peers).forEach(function (id) { peers[id].close(); });
    Object.keys(audioAnalysers).forEach(teardownAudioAnalyser);
    if (localStream)  localStream.getTracks().forEach(function (t) { t.stop(); });
    if (screenStream) screenStream.getTracks().forEach(function (t) { t.stop(); });
    socket.disconnect();
    window.location.href = "/";
  }

  window.addEventListener("beforeunload", function () { socket.disconnect(); });

  // ──────────────────────────────────────────────────────────────────────────
  // START
  // ──────────────────────────────────────────────────────────────────────────
  getMedia();
  appendChatMessage(null, "You joined as " + userName);

})();