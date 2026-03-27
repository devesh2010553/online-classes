document.addEventListener("DOMContentLoaded", () => {
  const joinBtn = document.getElementById("joinBtn");

  joinBtn.addEventListener("click", () => {
    const nameEl = document.getElementById("name");
    const roomEl = document.getElementById("roomId");

    if (!nameEl || !roomEl) {
      alert("Input fields are missing!");
      return;
    }

    const name = nameEl.value.trim();
    const roomId = roomEl.value.trim();

    if (!name || !roomId) {
      alert("Please enter your name and class code.");
      return;
    }

    // Redirect to room.html with name and room query params
    window.location.href = `room.html?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`;
  });
});
