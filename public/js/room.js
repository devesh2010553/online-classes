// EduStream Room Controller v4
// Real-time 4K · Mobile Camera Share · Speaker Detection · Pin · Simulcast
"use strict";
(function () {

  // ── URL params ─────────────────────────────────────────────────────────────
  var P      = new URLSearchParams(window.location.search);
  var ROOM   = P.get("room");
  var ME     = (P.get("name") || "Anonymous").trim().slice(0, 32);

  if (!ROOM) { alert("No room code — redirecting."); location.href = "/"; return; }

  // ── DOM ────────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var videoGrid       = $("videoGrid");
  var thumbStrip      = $("thumbStrip");
  var chatPanel       = $("chatPanel");
  var chatMsgs        = $("chatMsgs");
  var chatInput       = $("chatInput");
  var chatSend        = $("chatSend");
  var chatBtn         = $("chatBtn");
  var chatClose       = $("chatClose");
  var chatBadge       = $("chatBadge");
  var micBtn          = $("micBtn");
  var camBtn          = $("camBtn");
  var shareBtn        = $("shareBtn");
  var handBtn         = $("handBtn");
  var leaveBtn        = $("leaveBtn");
  var leaveModal      = $("leaveModal");
  var cancelLeave     = $("cancelLeave");
  var confirmLeave    = $("confirmLeave");
  var shareModal      = $("shareModal");
  var shareModalClose = $("shareModalClose");
  var desktopShareOpt = $("desktopShareOpt");
  var mobileShareOpt  = $("mobileShareOpt");
  var mobileLimitNote = $("mobileLimitNote");
  var startDesktopShare    = $("startDesktopShare");
  var startMobileCamShare  = $("startMobileCamShare");
  var timerEl         = $("sessionTimer");
  var countEl         = $("participantCount");
  var roomCodeEl      = $("roomCode");
  var qualityBadge    = $("qualityBadge");
  var toasts          = $("toasts");

  // ── State ──────────────────────────────────────────────────────────────────
  var localStream      = null;   // main cam/mic stream
  var shareStream      = null;   // screen or cam-share stream
  var isMicOn          = true;
  var isCamOn          = true;
  var isChatOpen       = false;
  var isHandRaised     = false;
  var unread           = 0;
  var pinnedId         = null;
  var activeSpeaker    = null;
  var speakerTimer     = null;
  var sessionStart     = Date.now();
  var peers            = {};     // peerId → RTCPeerConnection
  var peerNames        = {};     // peerId → displayName
  var analysers        = {};     // peerId → { ctx, interval }
  var isMobileShare    = false;  // currently sharing via mobile cam
  var isDesktopShare   = false;  // currently sharing via getDisplayMedia
  var acquiredQuality  = "HD";

  roomCodeEl.textContent = ROOM;

  // ── Mobile detection ───────────────────────────────────────────────────────
  var IS_MOBILE = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform));

  var HAS_DISPLAY_MEDIA = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  // ── Session timer ──────────────────────────────────────────────────────────
  setInterval(function () {
    var t = Math.floor((Date.now() - sessionStart) / 1000);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var z = function (n) { return String(n).padStart(2, "0"); };
    timerEl.textContent = h ? z(h)+":"+z(m)+":"+z(s) : z(m)+":"+z(s);
  }, 1000);

  // ── Socket ─────────────────────────────────────────────────────────────────
  var socket = io({ transports: ["websocket", "polling"] });

  // ══════════════════════════════════════════════════════════════════════════
  //  TOAST
  // ══════════════════════════════════════════════════════════════════════════
  function toast(msg, type, ms) {
    type = type || "info"; ms = ms || 3500;
    var el = document.createElement("div");
    el.className = "toast toast-" + type;
    var icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
    el.innerHTML = "<span class='toast-icon'>" + (icons[type]||"ℹ️") + "</span><span>" + msg + "</span>";
    toasts.appendChild(el);
    setTimeout(function () {
      el.classList.add("toast-out");
      el.addEventListener("transitionend", function () { el.remove(); }, { once: true });
    }, ms);
  }

  function getInitials(name) {
    return (name || "?").split(" ").slice(0, 2)
      .map(function (w) { return (w[0] || "").toUpperCase(); }).join("") || "?";
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MEDIA — 4K cascade with quality badge
  // ══════════════════════════════════════════════════════════════════════════
  var QUALITY_LEVELS = [
    {
      label: "4K", badge: "4K",
      video: {
        width:     { ideal: 3840, max: 3840 },
        height:    { ideal: 2160, max: 2160 },
        frameRate: { ideal: 30,  max: 60   },
        facingMode: "user",
      },
    },
    {
      label: "1080p", badge: "1080p",
      video: {
        width:     { ideal: 1920 },
        height:    { ideal: 1080 },
        frameRate: { ideal: 30 },
        facingMode: "user",
      },
    },
    {
      label: "720p", badge: "HD",
      video: {
        width:     { ideal: 1280 },
        height:    { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: "user",
      },
    },
    {
      label: "480p", badge: "SD",
      video: { width: { ideal: 854 }, height: { ideal: 480 }, facingMode: "user" },
    },
    {
      label: "audio-only", badge: "🎙",
      video: false,
    },
  ];

  var AUDIO_CONSTRAINTS = {
    echoCancellation:  true,
    noiseSuppression:  true,
    autoGainControl:   true,
    sampleRate:        48000,
    channelCount:      1,
  };

  function startMedia(idx) {
    idx = idx || 0;
    if (idx >= QUALITY_LEVELS.length) {
      toast("No camera/mic found — joining as viewer", "warn");
      localStream = new MediaStream();
      addTile(localStream, socket.id, true, ME, false, false);
      socket.emit("join-room", { roomId: ROOM, name: ME });
      return;
    }
    var q = QUALITY_LEVELS[idx];
    navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: q.video })
      .then(function (stream) {
        localStream   = stream;
        acquiredQuality = q.badge;
        qualityBadge.textContent = q.badge;
        qualityBadge.className   = "badge-quality q-" + q.label.replace(/\s/g,"");
        var hasVideo = stream.getVideoTracks().length > 0;
        if (idx < 2) toast("Camera quality: " + q.label + " 🎥", "success", 2000);
        addTile(stream, socket.id, true, ME, true, hasVideo);
        setupAnalyser(stream, socket.id, true);
        socket.emit("join-room", { roomId: ROOM, name: ME });
        // Try to upgrade to 4K silently after connecting
        if (idx > 0) tryUpgrade();
      })
      .catch(function (err) {
        console.warn("Quality " + q.label + " failed:", err.name);
        startMedia(idx + 1);
      });
  }

  // Try to upgrade to 4K after initial connection (background attempt)
  function tryUpgrade() {
    var best = QUALITY_LEVELS[0];
    navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: best.video })
      .then(function (newStream) {
        // Swap local tile video source
        var tile = document.getElementById("tile-" + socket.id);
        if (tile && tile._video) {
          tile._video.srcObject = newStream;
        }
        // Replace tracks in all peers
        var newVideoTrack = newStream.getVideoTracks()[0];
        var newAudioTrack = newStream.getAudioTracks()[0];
        Object.values(peers).forEach(function (pc) {
          pc.getSenders().forEach(function (sender) {
            if (sender.track) {
              if (sender.track.kind === "video" && newVideoTrack)
                sender.replaceTrack(newVideoTrack).catch(function () {});
              if (sender.track.kind === "audio" && newAudioTrack)
                sender.replaceTrack(newAudioTrack).catch(function () {});
            }
          });
        });
        // Stop old tracks
        localStream.getTracks().forEach(function (t) { t.stop(); });
        localStream = newStream;
        acquiredQuality = best.badge;
        qualityBadge.textContent = best.badge;
        qualityBadge.className   = "badge-quality q-4K";
        setupAnalyser(newStream, socket.id, true);
        toast("Upgraded to 4K! 🚀", "success", 2000);
      })
      .catch(function () { /* silently ignore upgrade failure */ });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AUDIO ANALYSER — real-time speaking detection
  // ══════════════════════════════════════════════════════════════════════════
  function setupAnalyser(stream, id, isLocal) {
    teardownAnalyser(id);
    if (!stream.getAudioTracks().length) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      var ctx      = new AC();
      var src      = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize              = 256;
      analyser.smoothingTimeConstant = 0.85;
      src.connect(analyser);
      var buf  = new Uint8Array(analyser.frequencyBinCount);
      var prev = false;

      var iv = setInterval(function () {
        analyser.getByteFrequencyData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += buf[i];
        var isSpeaking = (sum / buf.length) > 8;

        // Update tile
        var tile = document.getElementById("tile-" + id);
        if (tile) tile.classList.toggle("speaking", isSpeaking);
        // Update thumb
        var thumb = thumbStrip.querySelector("[data-id='" + id + "']");
        if (thumb) thumb.classList.toggle("tsp", isSpeaking);

        if (isSpeaking !== prev) {
          prev = isSpeaking;
          if (isLocal) socket.emit("speaking", { roomId: ROOM, isSpeaking: isSpeaking });
          if (isSpeaking && !pinnedId) {
            activeSpeaker = id;
            applyProminence();
            clearTimeout(speakerTimer);
            speakerTimer = setTimeout(function () {
              if (!pinnedId) { activeSpeaker = null; applyProminence(); }
            }, 2500);
          }
        }
      }, 150);

      analysers[id] = { ctx: ctx, interval: iv };
    } catch (e) { console.warn("Analyser failed:", e); }
  }

  function teardownAnalyser(id) {
    var a = analysers[id];
    if (!a) return;
    clearInterval(a.interval);
    try { a.ctx.close(); } catch (_) {}
    delete analysers[id];
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GRID LAYOUT
  // ══════════════════════════════════════════════════════════════════════════
  function updateGrid() {
    var tiles = videoGrid.querySelectorAll(".vtile");
    var n = tiles.length;

    if (pinnedId) {
      videoGrid.className = "video-grid grid-pinned";
      tiles.forEach(function (t) {
        t.style.display = (t.id === "tile-" + pinnedId) ? "" : "none";
      });
      return;
    }

    tiles.forEach(function (t) { t.style.display = ""; });
    var cls = n <= 1 ? "grid-1"
            : n === 2 ? "grid-2"
            : n <= 4 ? "grid-4"
            : n <= 6 ? "grid-6"
            : "grid-many";
    videoGrid.className = "video-grid " + cls;
    applyProminence();
  }

  function applyProminence() {
    videoGrid.querySelectorAll(".vtile").forEach(function (t) {
      t.classList.remove("prominent");
    });
    if (activeSpeaker && !pinnedId) {
      var sp = document.getElementById("tile-" + activeSpeaker);
      if (sp) sp.classList.add("prominent");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  THUMBNAIL STRIP
  // ══════════════════════════════════════════════════════════════════════════
  function rebuildThumbs() {
    thumbStrip.innerHTML = "";
    if (!pinnedId) { thumbStrip.style.display = "none"; return; }
    thumbStrip.style.display = "flex";

    videoGrid.querySelectorAll(".vtile").forEach(function (tile) {
      var tid  = tile.id.replace("tile-", "");
      var name = peerNames[tid] || tid.slice(0, 8);
      var srcObj = tile._video ? tile._video.srcObject : null;

      var th = document.createElement("div");
      th.className = "thumb";
      th.dataset.id = tid;
      if (tid === pinnedId)      th.classList.add("thumb-pinned");
      if (tid === activeSpeaker) th.classList.add("tsp");

      var tv = document.createElement("video");
      tv.autoplay   = true;
      tv.playsInline = true;
      tv.muted      = (tid === socket.id);
      if (srcObj) tv.srcObject = srcObj;
      th.appendChild(tv);

      var tn = document.createElement("div");
      tn.className   = "thumb-name";
      tn.textContent = (tid === socket.id) ? "You" : name;
      th.appendChild(tn);

      th.addEventListener("click", function () { setPin(tid); });
      thumbStrip.appendChild(th);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PIN
  // ══════════════════════════════════════════════════════════════════════════
  function setPin(id) {
    var wasMe = (pinnedId === id);

    // Clear old pin UI
    if (pinnedId) {
      var prev = document.getElementById("tile-" + pinnedId);
      if (prev) {
        prev.classList.remove("pinned");
        var pt = prev.querySelector(".pin-tag");
        if (pt) pt.remove();
      }
      pinnedId = null;
    }

    if (!wasMe) {
      var tile = document.getElementById("tile-" + id);
      if (!tile) return;
      pinnedId = id;
      tile.classList.add("pinned");
      var nm = tile.querySelector(".vtile-name");
      if (nm) {
        var pt2 = document.createElement("span");
        pt2.className   = "pin-tag";
        pt2.textContent = "📌";
        nm.appendChild(pt2);
      }
      toast("📌 " + (peerNames[id] || "Participant") + " pinned", "info", 1800);
    }

    updateGrid();
    rebuildThumbs();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  VIDEO TILES
  // ══════════════════════════════════════════════════════════════════════════
  function addTile(stream, id, isLocal, name, micOn, camOn) {
    if (document.getElementById("tile-" + id)) return;
    isLocal = !!isLocal;
    name    = name || "";
    micOn   = micOn !== false;
    camOn   = camOn !== false;
    peerNames[id] = name;

    var tile = document.createElement("div");
    tile.className   = "vtile";
    tile.id          = "tile-" + id;
    tile.dataset.name = name;

    // Video
    var vid = document.createElement("video");
    vid.autoplay    = true;
    vid.playsInline  = true;
    vid.muted       = isLocal;
    vid.srcObject   = stream;
    tile.appendChild(vid);

    // Cam-off avatar
    var ava = document.createElement("div");
    ava.className   = "tile-avatar";
    ava.style.display = camOn ? "none" : "flex";
    var av2 = document.createElement("div");
    av2.className   = "avatar-ring";
    av2.textContent = getInitials(name);
    ava.appendChild(av2);
    tile.appendChild(ava);

    // Pin button overlay
    var ovr = document.createElement("div");
    ovr.className = "tile-overlay";
    var pb = document.createElement("button");
    pb.className   = "tile-pin-btn";
    pb.title       = "Pin";
    pb.textContent = "📌";
    pb.addEventListener("click", function (e) { e.stopPropagation(); setPin(id); });
    ovr.appendChild(pb);
    tile.appendChild(ovr);

    // Info bar
    var bar = document.createElement("div");
    bar.className = "tile-bar";

    var nm = document.createElement("span");
    nm.className   = "vtile-name";
    nm.textContent = isLocal ? "You" : (name || id.slice(0, 8));
    if (isLocal) {
      var yt = document.createElement("span");
      yt.className   = "you-tag";
      yt.textContent = "YOU";
      nm.appendChild(yt);
    }

    var icons = document.createElement("span");
    icons.className = "tile-icons";

    var mi = document.createElement("span");
    mi.className   = "tile-icon" + (micOn ? "" : " off");
    mi.textContent = micOn ? "🎤" : "🔇";

    var ci = document.createElement("span");
    ci.className   = "tile-icon" + (camOn ? "" : " off");
    ci.textContent = camOn ? "📷" : "🚫";

    icons.appendChild(mi);
    icons.appendChild(ci);
    bar.appendChild(nm);
    bar.appendChild(icons);
    tile.appendChild(bar);

    tile._video   = vid;
    tile._avatar  = ava;
    tile._micIcon = mi;
    tile._camIcon = ci;

    videoGrid.appendChild(tile);
    updateGrid();
    rebuildThumbs();
  }

  function removeTile(id) {
    var el = document.getElementById("tile-" + id);
    if (!el) return;
    el.remove();
    teardownAnalyser(id);
    delete peerNames[id];
    if (pinnedId === id)      pinnedId = null;
    if (activeSpeaker === id) activeSpeaker = null;
    updateGrid();
    rebuildThumbs();
  }

  function updateTileMedia(id, micOn, camOn) {
    var tile = document.getElementById("tile-" + id);
    if (!tile) return;
    if (tile._micIcon) { tile._micIcon.textContent = micOn ? "🎤" : "🔇"; tile._micIcon.className = "tile-icon" + (micOn ? "" : " off"); }
    if (tile._camIcon) { tile._camIcon.textContent = camOn ? "📷" : "🚫"; tile._camIcon.className = "tile-icon" + (camOn ? "" : " off"); }
    if (tile._avatar)  { tile._avatar.style.display = camOn ? "none" : "flex"; }
  }

  function syncLocalIcons() {
    updateTileMedia(socket.id, isMicOn, isCamOn);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WebRTC PEERS — 4K bandwidth + simulcast
  // ══════════════════════════════════════════════════════════════════════════
  var ICE = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302"  },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478"  },
      // Production: add TURN here
      // { urls: "turn:your-server:3478", username: "u", credential: "p" }
    ],
    bundlePolicy:  "max-bundle",
    rtcpMuxPolicy: "require",
    sdpSemantics:  "unified-plan",
  };

  // SDP modifier: inject max bitrate for 4K (b=AS line)
  function boostSDP(sdp) {
    // Set video bandwidth to 20 Mbps for 4K
    return sdp.replace(
      /m=video (\d+) /g,
      function (match) {
        return match;
      }
    ).replace(
      /(m=video[^\n]*\n)/g,
      "$1b=AS:20000\n"
    );
  }

  function createPeer(id, initiator, remoteName) {
    if (peers[id]) { peers[id].close(); }

    var pc = new RTCPeerConnection(ICE);
    peers[id]     = pc;
    peerNames[id] = remoteName;

    // Add local tracks with simulcast encoding for 4K
    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        if (track.kind === "video") {
          // Simulcast: 3 layers — quarter, half, full
          pc.addTransceiver(track, {
            streams: [localStream],
            sendEncodings: [
              { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 500_000  },
              { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 2_000_000 },
              { rid: "f", scaleResolutionDownBy: 1, maxBitrate: 20_000_000 },
            ],
          });
        } else {
          pc.addTrack(track, localStream);
        }
      });
    }

    // Remote track
    pc.ontrack = function (e) {
      var rs   = e.streams[0];
      var tile = document.getElementById("tile-" + id);
      if (tile) {
        tile._video.srcObject = rs;
      } else {
        addTile(rs, id, false, remoteName || "Peer", true, true);
      }
      if (e.track.kind === "audio") {
        teardownAnalyser(id);
        setTimeout(function () { setupAnalyser(rs, id, false); }, 500);
      }
    };

    // ICE
    pc.onicecandidate = function (e) {
      if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } });
    };

    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === "connected")    { applyMaxBitrate(pc); }
      if (s === "failed")       { handlePeerFailed(id, initiator); }
    };

    if (initiator) doOffer(pc, id);
    return pc;
  }

  function doOffer(pc, id) {
    pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(function (offer) {
        offer.sdp = boostSDP(offer.sdp);
        return pc.setLocalDescription(offer);
      })
      .then(function () {
        socket.emit("signal", { to: id, data: { sdp: pc.localDescription } });
      })
      .catch(console.error);
  }

  function handlePeerFailed(id, initiator) {
    toast("Connection issue with " + (peerNames[id] || "peer") + " — reconnecting…", "warn");
    if (initiator && peers[id]) {
      peers[id].restartIce();
      peers[id].createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then(function (o) { o.sdp = boostSDP(o.sdp); return peers[id].setLocalDescription(o); })
        .then(function () { socket.emit("signal", { to: id, data: { sdp: peers[id].localDescription } }); })
        .catch(console.error);
    }
  }

  // Force maximum bitrate on all video senders after connection
  function applyMaxBitrate(pc) {
    pc.getSenders().forEach(function (sender) {
      if (!sender.track || sender.track.kind !== "video") return;
      var params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) {
        params.encodings = [{}];
      }
      params.encodings.forEach(function (enc) {
        enc.maxBitrate   = 20_000_000; // 20 Mbps per encoding layer
        enc.maxFramerate = 60;
        if (!enc.rid) enc.scaleResolutionDownBy = 1; // full res for non-simulcast
      });
      sender.setParameters(params).catch(function () {});
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SOCKET EVENTS
  // ══════════════════════════════════════════════════════════════════════════
  socket.on("connect", function () { console.log("Socket:", socket.id); });

  socket.on("all-users", function (users) {
    users.forEach(function (u) {
      addTile(new MediaStream(), u.id, false, u.name, true, true);
      createPeer(u.id, true, u.name);
    });
  });

  socket.on("user-joined", function (u) {
    toast(u.name + " joined", "success");
    addTile(new MediaStream(), u.id, false, u.name, true, true);
    createPeer(u.id, false, u.name);
  });

  socket.on("signal", function (payload) {
    var from = payload.from, data = payload.data;
    var pc   = peers[from];
    if (!pc) {
      var t = document.getElementById("tile-" + from);
      pc = createPeer(from, false, t ? t.dataset.name : "Peer");
    }

    var p = Promise.resolve();
    if (data.sdp) {
      p = pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function () {
          if (data.sdp.type === "offer") {
            return pc.createAnswer()
              .then(function (ans) { ans.sdp = boostSDP(ans.sdp); return pc.setLocalDescription(ans); })
              .then(function () { socket.emit("signal", { to: from, data: { sdp: pc.localDescription } }); });
          }
        });
    }
    if (data.candidate) {
      p = p.then(function () {
        return pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      });
    }
    p.catch(function (e) { console.error("Signal:", e); });
  });

  socket.on("user-left", function (id) {
    var tile = document.getElementById("tile-" + id);
    toast((tile ? tile.dataset.name : "Someone") + " left");
    if (peers[id]) { peers[id].close(); delete peers[id]; }
    removeTile(id);
  });

  socket.on("participant-count", function (n) { countEl.textContent = n; });

  socket.on("peer-media-state", function (d) { updateTileMedia(d.id, d.micOn, d.camOn); });

  socket.on("peer-raised-hand", function (d) {
    toast("✋ " + d.name + " raised their hand", "info");
    var tile = document.getElementById("tile-" + d.id);
    if (tile && !tile.querySelector(".hand-badge")) {
      var hb = document.createElement("div");
      hb.className   = "hand-badge";
      hb.textContent = "✋ Hand raised";
      tile.appendChild(hb);
      setTimeout(function () { hb.remove(); }, 8000);
    }
  });

  socket.on("peer-speaking", function (d) {
    var tile  = document.getElementById("tile-" + d.id);
    if (tile)  tile.classList.toggle("speaking", d.isSpeaking);
    var thumb = thumbStrip.querySelector("[data-id='" + d.id + "']");
    if (thumb) thumb.classList.toggle("tsp", d.isSpeaking);
    if (d.isSpeaking && !pinnedId) {
      activeSpeaker = d.id;
      applyProminence();
      clearTimeout(speakerTimer);
      speakerTimer = setTimeout(function () {
        if (!pinnedId) { activeSpeaker = null; applyProminence(); }
      }, 2500);
    }
  });

  socket.on("peer-screen-share", function (d) {
    var tile = document.getElementById("tile-" + d.id);
    if (tile) tile.classList.toggle("sharing", d.isSharing);
    if (d.isSharing) {
      toast("🖥️ " + d.name + " is sharing screen", "info");
      if (!pinnedId) setPin(d.id);
    } else {
      toast("🖥️ " + d.name + " stopped sharing", "info");
      if (pinnedId === d.id) setPin(d.id); // unpin
    }
  });

  socket.on("peer-mobile-cam-share", function (d) {
    var tile = document.getElementById("tile-" + d.id);
    if (tile) tile.classList.toggle("sharing", d.isSharing);
    if (d.isSharing) {
      toast("📷 " + d.name + " is sharing via camera", "info");
      if (!pinnedId) setPin(d.id);
    } else {
      toast("📷 " + d.name + " stopped camera share", "info");
      if (pinnedId === d.id) setPin(d.id);
    }
  });

  socket.on("chat-message", function (m) {
    appendChat(m.sender, m.message, false, m.ts);
    if (!isChatOpen) {
      unread++;
      chatBadge.textContent   = unread > 9 ? "9+" : unread;
      chatBadge.style.display = "";
    }
  });

  socket.on("disconnect", function () { toast("Disconnected from server", "error"); });

  // ══════════════════════════════════════════════════════════════════════════
  //  CHAT
  // ══════════════════════════════════════════════════════════════════════════
  function appendChat(sender, message, isSelf, ts) {
    if (!sender) {
      var sys = document.createElement("div");
      sys.className   = "chat-sys";
      sys.textContent = message;
      chatMsgs.appendChild(sys);
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "chat-msg " + (isSelf ? "self" : "other");
    if (!isSelf) {
      var sn = document.createElement("div");
      sn.className   = "chat-sender";
      sn.textContent = sender;
      wrap.appendChild(sn);
    }
    var bubble = document.createElement("div");
    bubble.className   = "chat-bubble";
    bubble.textContent = message;
    wrap.appendChild(bubble);
    var t = document.createElement("div");
    t.className   = "chat-ts";
    t.textContent = new Date(ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    wrap.appendChild(t);
    chatMsgs.appendChild(wrap);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  function sendChat() {
    var msg = chatInput.value.trim();
    if (!msg) return;
    var ts = Date.now();
    socket.emit("chat-message", { roomId: ROOM, sender: ME, message: msg, ts: ts });
    appendChat(ME, msg, true, ts);
    chatInput.value = "";
  }
  chatSend.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  CONTROLS
  // ══════════════════════════════════════════════════════════════════════════

  // Mic
  micBtn.addEventListener("click", function () {
    isMicOn = !isMicOn;
    if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = isMicOn; });
    micBtn.classList.toggle("active", isMicOn);
    micBtn.classList.toggle("muted",  !isMicOn);
    micBtn.querySelector(".ctrl-lbl").textContent = isMicOn ? "Mute" : "Unmute";
    syncLocalIcons();
    socket.emit("media-state", { roomId: ROOM, micOn: isMicOn, camOn: isCamOn });
  });

  // Camera
  camBtn.addEventListener("click", function () {
    isCamOn = !isCamOn;
    if (localStream) localStream.getVideoTracks().forEach(function (t) { t.enabled = isCamOn; });
    camBtn.classList.toggle("active", isCamOn);
    camBtn.classList.toggle("muted",  !isCamOn);
    camBtn.querySelector(".ctrl-lbl").textContent = isCamOn ? "Camera" : "Cam Off";
    syncLocalIcons();
    socket.emit("media-state", { roomId: ROOM, micOn: isMicOn, camOn: isCamOn });
  });

  // Chat open/close
  chatBtn.addEventListener("click", function () { isChatOpen ? closeChat() : openChat(); });
  chatClose.addEventListener("click", closeChat);

  function openChat() {
    chatPanel.style.display = "flex";
    isChatOpen              = true;
    unread                  = 0;
    chatBadge.style.display = "none";
    chatBtn.classList.add("active");
    setTimeout(function () { chatInput.focus(); }, 200);
  }
  function closeChat() {
    chatPanel.style.display = "none";
    isChatOpen              = false;
    chatBtn.classList.remove("active");
  }

  // Raise hand
  handBtn.addEventListener("click", function () {
    isHandRaised = !isHandRaised;
    handBtn.classList.toggle("hand-on", isHandRaised);
    handBtn.querySelector(".ctrl-lbl").textContent = isHandRaised ? "Lower" : "Hand";
    if (isHandRaised) {
      socket.emit("raise-hand", { roomId: ROOM });
      toast("You raised your hand ✋");
      setTimeout(function () {
        isHandRaised = false;
        handBtn.classList.remove("hand-on");
        handBtn.querySelector(".ctrl-lbl").textContent = "Hand";
      }, 30000);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  SHARE — desktop screen capture OR mobile camera share
  // ══════════════════════════════════════════════════════════════════════════
  shareBtn.addEventListener("click", function () {
    // If currently sharing anything, stop it
    if (isDesktopShare || isMobileShare) {
      stopAllSharing();
      return;
    }
    openShareModal();
  });

  shareModalClose.addEventListener("click", function () { shareModal.style.display = "none"; });
  shareModal.addEventListener("click", function (e) {
    if (e.target === shareModal) shareModal.style.display = "none";
  });

  function openShareModal() {
    shareModal.style.display = "flex";

    if (IS_MOBILE || !HAS_DISPLAY_MEDIA) {
      // Mobile: show camera share option + limitation note
      desktopShareOpt.style.display = "none";
      mobileShareOpt.style.display  = "flex";
      mobileLimitNote.style.display = "flex";
    } else {
      // Desktop: show both options
      desktopShareOpt.style.display = "flex";
      // Still offer mobile cam option on desktop (e.g. connected phone cam)
      mobileShareOpt.style.display  = "flex";
      mobileLimitNote.style.display = "none";
    }
  }

  // ── Desktop screen share ───────────────────────────────────────────────────
  startDesktopShare.addEventListener("click", function () {
    shareModal.style.display = "none";

    navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate:   { ideal: 30 },
        width:       { ideal: 1920 },
        height:      { ideal: 1080 },
        displaySurface: "monitor",
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
      },
    })
    .then(function (stream) {
      shareStream      = stream;
      isDesktopShare   = true;
      var vTrack       = stream.getVideoTracks()[0];

      // Replace video track in all peers
      Object.values(peers).forEach(function (pc) {
        var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === "video"; });
        if (sender) sender.replaceTrack(vTrack).catch(console.error);
      });

      // Show on local tile
      var tile = document.getElementById("tile-" + socket.id);
      if (tile) { tile._video.srcObject = stream; tile.classList.add("sharing"); }

      shareBtn.classList.add("sharing-on");
      shareBtn.querySelector(".ctrl-lbl").textContent = "Stop";
      socket.emit("screen-share-state", { roomId: ROOM, isSharing: true, mode: "desktop" });
      toast("🖥️ Screen sharing started", "success");

      vTrack.addEventListener("ended", stopAllSharing);
    })
    .catch(function (err) {
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
        toast("Screen share failed: " + err.message, "error");
      }
    });
  });

  // ── Mobile camera share (document cam / rear camera) ──────────────────────
  startMobileCamShare.addEventListener("click", function () {
    shareModal.style.display = "none";

    // Request rear/environment camera at high resolution
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // rear camera
        width:      { ideal: 1920 },
        height:     { ideal: 1080 },
        frameRate:  { ideal: 30 },
      },
      audio: false,
    })
    .then(function (stream) {
      shareStream    = stream;
      isMobileShare  = true;
      var vTrack     = stream.getVideoTracks()[0];

      // Replace video track in all peers
      Object.values(peers).forEach(function (pc) {
        var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === "video"; });
        if (sender) sender.replaceTrack(vTrack).catch(console.error);
      });

      // Show on local tile
      var tile = document.getElementById("tile-" + socket.id);
      if (tile) { tile._video.srcObject = stream; tile.classList.add("sharing"); }

      shareBtn.classList.add("sharing-on");
      shareBtn.querySelector(".ctrl-lbl").textContent = "Stop";
      socket.emit("mobile-cam-share", { roomId: ROOM, isSharing: true });
      toast("📷 Camera sharing started (rear cam)", "success");

      vTrack.addEventListener("ended", stopAllSharing);
    })
    .catch(function (err) {
      toast("Camera share failed: " + err.message, "error");
    });
  });

  function stopAllSharing() {
    if (!shareStream) return;

    // Restore original video track in peers
    var origVideo = localStream && localStream.getVideoTracks()[0];
    Object.values(peers).forEach(function (pc) {
      var sender = pc.getSenders().find(function (s) { return s.track && s.track.kind === "video"; });
      if (sender && origVideo) sender.replaceTrack(origVideo).catch(console.error);
    });

    // Restore local tile
    var tile = document.getElementById("tile-" + socket.id);
    if (tile) {
      if (localStream) tile._video.srcObject = localStream;
      tile.classList.remove("sharing");
    }

    shareStream.getTracks().forEach(function (t) { t.stop(); });
    shareStream = null;

    if (isDesktopShare) socket.emit("screen-share-state", { roomId: ROOM, isSharing: false });
    if (isMobileShare)  socket.emit("mobile-cam-share",   { roomId: ROOM, isSharing: false });

    isDesktopShare = false;
    isMobileShare  = false;

    shareBtn.classList.remove("sharing-on");
    shareBtn.querySelector(".ctrl-lbl").textContent = "Share";
    toast("Sharing stopped");
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LEAVE
  // ══════════════════════════════════════════════════════════════════════════
  leaveBtn.addEventListener("click", function () { leaveModal.style.display = "flex"; });
  cancelLeave.addEventListener("click", function () { leaveModal.style.display = "none"; });
  confirmLeave.addEventListener("click", cleanup);

  function cleanup() {
    Object.keys(peers).forEach(function (id) { peers[id].close(); });
    Object.keys(analysers).forEach(teardownAnalyser);
    if (localStream)  localStream.getTracks().forEach(function (t) { t.stop(); });
    if (shareStream)  shareStream.getTracks().forEach(function (t) { t.stop(); });
    socket.disconnect();
    location.href = "/";
  }

  window.addEventListener("beforeunload", function () { socket.disconnect(); });

  // ══════════════════════════════════════════════════════════════════════════
  //  START
  // ══════════════════════════════════════════════════════════════════════════
  startMedia(0);
  appendChat(null, "You joined as " + ME);

})();