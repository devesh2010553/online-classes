// EduStream — Join Page Controller

(function () {
  var joinBtn   = document.getElementById("joinBtn");
  var nameInput = document.getElementById("name");
  var roomInput = document.getElementById("roomId");
  var errorMsg  = document.getElementById("errorMsg");

  // Force uppercase as user types
  roomInput.addEventListener("input", function () {
    var pos = roomInput.selectionStart;
    roomInput.value = roomInput.value.toUpperCase().replace(/\s/g, "");
    roomInput.setSelectionRange(pos, pos);
  });

  // Enter key triggers join on both fields
  nameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); handleJoin(); }
  });
  roomInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); handleJoin(); }
  });

  joinBtn.addEventListener("click", function (e) {
    e.preventDefault();
    handleJoin();
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = "block";
  }

  function clearError() {
    errorMsg.style.display = "none";
    errorMsg.textContent = "";
  }

  function setLoading(on) {
    var btnText   = joinBtn.querySelector(".btn-text");
    var btnArrow  = joinBtn.querySelector(".btn-arrow");
    var btnLoader = joinBtn.querySelector(".btn-loader");
    if (on) {
      btnText.textContent       = "Connecting…";
      btnArrow.style.display    = "none";
      btnLoader.style.display   = "flex";
      joinBtn.disabled          = true;
    } else {
      btnText.textContent       = "Enter Class";
      btnArrow.style.display    = "";
      btnLoader.style.display   = "none";
      joinBtn.disabled          = false;
    }
  }

  function handleJoin() {
    clearError();

    var name   = nameInput.value.trim();
    var roomId = roomInput.value.trim().toUpperCase();

    if (!name) {
      showError("Please enter your name.");
      shake(nameInput);
      nameInput.focus();
      return;
    }
    if (!roomId) {
      showError("Please enter a class code.");
      shake(roomInput);
      roomInput.focus();
      return;
    }

    setLoading(true);

    // Use setTimeout so the loading state renders before redirect
    setTimeout(function () {
      window.location.href =
        "/room?room=" + encodeURIComponent(roomId) +
        "&name=" + encodeURIComponent(name);
    }, 400);
  }

  function shake(el) {
    var wrap = el.closest(".input-wrap");
    if (!wrap) return;
    wrap.classList.remove("shake");
    // Force reflow
    void wrap.offsetWidth;
    wrap.classList.add("shake");
    wrap.addEventListener("animationend", function () {
      wrap.classList.remove("shake");
    }, { once: true });
  }

  // Inject shake animation
  var s = document.createElement("style");
  s.textContent =
    "@keyframes shake{" +
      "0%,100%{transform:translateX(0)}" +
      "20%{transform:translateX(-8px)}" +
      "40%{transform:translateX(8px)}" +
      "60%{transform:translateX(-5px)}" +
      "80%{transform:translateX(5px)}" +
    "}" +
    ".shake{animation:shake 0.4s ease!important;}";
  document.head.appendChild(s);
})();