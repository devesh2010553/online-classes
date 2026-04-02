// EduStream — Join Page v4
(function () {
  var joinBtn   = document.getElementById("joinBtn");
  var nameInput = document.getElementById("name");
  var roomInput = document.getElementById("roomId");
  var errBox    = document.getElementById("errBox");
  var bgCanvas  = document.getElementById("bgCanvas");

  // ── Animated background particles ────────────────────────────────────────
  if (bgCanvas) {
    var ctx = bgCanvas.getContext("2d");
    var particles = [];
    function resizeCanvas() {
      bgCanvas.width  = window.innerWidth;
      bgCanvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    for (var i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.5 + 0.3,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        o: Math.random() * 0.5 + 0.1,
      });
    }

    function drawParticles() {
      ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      particles.forEach(function (p) {
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0) p.x = bgCanvas.width;
        if (p.x > bgCanvas.width) p.x = 0;
        if (p.y < 0) p.y = bgCanvas.height;
        if (p.y > bgCanvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(99,102,241," + p.o + ")";
        ctx.fill();
      });
      // Draw connecting lines
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dist = Math.hypot(particles[a].x - particles[b].x, particles[a].y - particles[b].y);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.strokeStyle = "rgba(99,102,241," + (0.06 * (1 - dist / 100)) + ")";
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(drawParticles);
    }
    drawParticles();
  }

  // ── Force uppercase room code ─────────────────────────────────────────────
  roomInput.addEventListener("input", function () {
    var pos = roomInput.selectionStart;
    roomInput.value = roomInput.value.toUpperCase().replace(/\s/g, "");
    roomInput.setSelectionRange(pos, pos);
  });

  // ── Enter key ─────────────────────────────────────────────────────────────
  [nameInput, roomInput].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); handleJoin(); }
    });
  });
  joinBtn.addEventListener("click", function (e) { e.preventDefault(); handleJoin(); });

  // ── Join logic ────────────────────────────────────────────────────────────
  function handleJoin() {
    hideErr();
    var name   = nameInput.value.trim();
    var roomId = roomInput.value.trim().toUpperCase();

    if (!name)   { showErr("Please enter your name."); shake(nameInput); nameInput.focus(); return; }
    if (!roomId) { showErr("Please enter a class code."); shake(roomInput); roomInput.focus(); return; }

    setLoading(true);
    setTimeout(function () {
      window.location.href = "/room?room=" + encodeURIComponent(roomId) + "&name=" + encodeURIComponent(name);
    }, 350);
  }

  function setLoading(on) {
    var text    = joinBtn.querySelector(".join-btn-text");
    var arrow   = joinBtn.querySelector(".join-btn-arrow");
    var spinner = joinBtn.querySelector(".join-btn-spinner");
    if (on) {
      text.textContent        = "Connecting…";
      arrow.style.display     = "none";
      spinner.style.display   = "flex";
      joinBtn.disabled        = true;
      joinBtn.style.opacity   = "0.8";
    } else {
      text.textContent        = "Enter Class";
      arrow.style.display     = "";
      spinner.style.display   = "none";
      joinBtn.disabled        = false;
      joinBtn.style.opacity   = "";
    }
  }

  function showErr(msg) {
    errBox.textContent   = "⚠ " + msg;
    errBox.style.display = "block";
  }
  function hideErr() { errBox.style.display = "none"; }

  function shake(el) {
    var wrap = el.closest(".field-input-wrap");
    if (!wrap) return;
    wrap.classList.remove("shake");
    void wrap.offsetWidth;
    wrap.classList.add("shake");
    wrap.addEventListener("animationend", function () { wrap.classList.remove("shake"); }, { once: true });
  }

  var style = document.createElement("style");
  style.textContent = "@keyframes shakeAnim{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}.shake{animation:shakeAnim 0.4s ease!important}";
  document.head.appendChild(style);
})();