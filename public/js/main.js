document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinBtn");
  const nameInput = document.getElementById("name");
  const roomInput = document.getElementById("roomId");

  // Force uppercase room code
  roomInput.addEventListener("input", () => {
    const pos = roomInput.selectionStart;
    roomInput.value = roomInput.value.toUpperCase();
    roomInput.setSelectionRange(pos, pos);
  });

  // Enter key support
  [nameInput, roomInput].forEach(el => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleJoin();
    });
  });

  joinBtn.addEventListener("click", handleJoin);

  function handleJoin() {
    const name = nameInput.value.trim();
    const roomId = roomInput.value.trim();

    if (!name) {
      shake(nameInput);
      nameInput.focus();
      return;
    }
    if (!roomId) {
      shake(roomInput);
      roomInput.focus();
      return;
    }

    // Show loading state
    const btnText = joinBtn.querySelector(".btn-text");
    const btnArrow = joinBtn.querySelector(".btn-arrow");
    const btnLoader = joinBtn.querySelector(".btn-loader");

    btnText.textContent = "Connecting…";
    btnArrow.style.display = "none";
    btnLoader.classList.remove("hidden");
    joinBtn.disabled = true;

    // Simulate brief connection check before redirect
    setTimeout(() => {
      window.location.href = `/room?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
    }, 500);
  }

  function shake(el) {
    el.closest(".input-wrap").style.animation = "none";
    el.closest(".input-wrap").offsetHeight; // reflow
    el.closest(".input-wrap").style.animation = "shake 0.4s ease";
  }

  // Inject shake keyframe
  const style = document.createElement("style");
  style.textContent = `
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      20%      { transform: translateX(-8px); }
      40%      { transform: translateX(8px); }
      60%      { transform: translateX(-5px); }
      80%      { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
});