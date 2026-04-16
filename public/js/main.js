"use strict";

// Register PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const nameIn  = document.getElementById("f-name");
  const roomIn  = document.getElementById("f-room");
  const joinBtn = document.getElementById("btn-join");

  // Force uppercase + alphanumeric only for room code
  roomIn.addEventListener("input", () => {
    const pos = roomIn.selectionStart;
    const cleaned = roomIn.value.toUpperCase().replace(/[^A-Z0-9\-]/g, "");
    if (roomIn.value !== cleaned) {
      roomIn.value = cleaned;
      try { roomIn.setSelectionRange(pos, pos); } catch (_) {}
    }
  });

  nameIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); roomIn.focus(); } });
  roomIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  joinBtn.addEventListener("click", go);

  function go() {
    const name = nameIn.value.trim();
    const room = roomIn.value.trim();
    if (!name) { shake(nameIn); nameIn.focus(); return; }
    if (!room)  { shake(roomIn); roomIn.focus(); return; }

    const txt  = joinBtn.querySelector(".btn-txt");
    const arr  = joinBtn.querySelector(".btn-arr");
    const spin = joinBtn.querySelector(".btn-spin");
    txt.textContent = "Joining…";
    arr.style.display = "none";
    spin.classList.remove("hidden");
    joinBtn.disabled = true;

    setTimeout(() => {
      window.location.href = `/room?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
    }, 380);
  }

  function shake(el) {
    const w = el.closest(".inp-wrap") || el;
    w.style.animation = "none";
    w.offsetHeight;
    w.style.animation = "shake .45s ease";
  }

  const s = document.createElement("style");
  s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
  document.head.appendChild(s);
});