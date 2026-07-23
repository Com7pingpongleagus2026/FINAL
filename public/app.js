const socket = io();
let myId = null;
let isHost = false;
let roomCode = null;
let gameTimer = null;
let timeLeft = 0;
let cardFlipped = false;

socket.on("connect", () => { myId = socket.id; });

// === SCREENS ===
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// === TOAST ===
function toast(msg, isError) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  setTimeout(() => t.className = "toast", 3000);
}

// === CREATE ROOM ===
function createRoom() {
  const name = document.getElementById("create-name").value.trim();
  if (!name) return toast("กรุณาใส่ชื่อ", true);
  socket.emit("create-room", { playerName: name, settings: { mode: "normal", timer: 480 } });
}

socket.on("room-created", ({ code, players }) => {
  roomCode = code;
  isHost = true;
  document.getElementById("lobby-code").textContent = code;
  document.getElementById("btn-start").style.display = "none";
  document.getElementById("settings-panel").style.display = "flex";
  showScreen("screen-lobby");
  updatePlayerList(players, socket.id);
  toast("สร้างห้องสำเร็จ! รหัส: " + code);
});

// === JOIN ROOM ===
function joinRoom() {
  const name = document.getElementById("join-name").value.trim();
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (!name) return toast("กรุณาใส่ชื่อ", true);
  if (!code || code.length !== 4) return toast("กรุณาใส่รหัสห้อง 4 ตัว", true);
  socket.emit("join-room", { code, playerName: name });
}

socket.on("room-joined", ({ code, players, host }) => {
  roomCode = code;
  isHost = (host === myId);
  document.getElementById("lobby-code").textContent = code;
  document.getElementById("settings-panel").style.display = isHost ? "flex" : "none";
  showScreen("screen-lobby");
  updatePlayerList(players, host);
  toast("เข้าร่วมห้อง " + code + " สำเร็จ!");
});

// === PLAYER LIST ===
socket.on("player-list", ({ players, host }) => {
  isHost = (host === myId);
  updatePlayerList(players, host);
  document.getElementById("settings-panel").style.display = isHost ? "flex" : "none";
});

function updatePlayerList(players, host) {
  const list = document.getElementById("player-list");
  list.innerHTML = players.map(p => {
    const badges = [];
    if (p.id === host) badges.push('<span class="badge badge-host">HOST</span>');
    if (!p.connected) badges.push('<span class="badge" style="background:#666">ออฟไลน์</span>');
    const kickBtn = (isHost && p.id !== myId) ? `<button class="kick-btn" onclick="kickPlayer('${p.id}')">✕</button>` : '';
    return `<div class="player-item"><span class="name">${p.name} ${badges.join(' ')}</span>${kickBtn}</div>`;
  }).join('');

  const startBtn = document.getElementById("btn-start");
  const hint = document.getElementById("lobby-hint");
  if (isHost && players.length >= 3) {
    startBtn.style.display = "block";
    hint.textContent = `ผู้เล่น ${players.length} คน — พร้อมเริ่ม!`;
  } else if (isHost) {
    startBtn.style.display = "none";
    hint.textContent = `ผู้เล่น ${players.length}/3 คน — รออีก ${3 - players.length} คน`;
  } else {
    startBtn.style.display = "none";
    hint.textContent = `ผู้เล่น ${players.length} คน — รอ Host เริ่มเกม`;
  }
}

function kickPlayer(id) { socket.emit("kick-player", { targetId: id }); }

// === SETTINGS ===
function updateSettings() {
  const timer = parseInt(document.getElementById("timer-select").value);
  const mode = document.getElementById("mode-select").value;
  socket.emit("update-settings", { timer, mode });
}
socket.on("settings-updated", (settings) => {
  document.getElementById("timer-select").value = settings.timer;
  document.getElementById("mode-select").value = settings.mode;
});

// === START GAME ===
function startGame() { socket.emit("start-game"); }

socket.on("game-started", ({ assignment, playerCount, timer, mode, players }) => {
  showScreen("screen-game");
  cardFlipped = false;
  document.getElementById("game-card").classList.remove("flipped");
  
  const cardBack = document.querySelector(".card-back");
  if (assignment.isSpy) {
    cardBack.classList.add("spy-card");
    document.getElementById("card-role-label").textContent = "⚠️ คุณคือ...";
    document.getElementById("card-location").textContent = "🕵️ สายลับ";
    document.getElementById("card-role").textContent = "หาให้ได้ว่าที่นี่คือที่ไหน!";
    document.getElementById("btn-spy-guess").style.display = "block";
  } else {
    cardBack.classList.remove("spy-card");
    document.getElementById("card-role-label").textContent = "📍 สถานที่";
    document.getElementById("card-location").textContent = assignment.location;
    document.getElementById("card-role").textContent = "🎭 " + assignment.role;
    document.getElementById("btn-spy-guess").style.display = "none";
  }

  // Player list
  document.getElementById("game-players").innerHTML = players.map(p =>
    `<div class="gp-item">${p.name}${p.isHost ? ' 👑' : ''}</div>`
  ).join('');

  // Timer
  timeLeft = mode === "hard" ? 240 : timer;
  startTimer();
});

function toggleCard() {
  cardFlipped = !cardFlipped;
  document.getElementById("game-card").classList.toggle("flipped", cardFlipped);
}

function startTimer() {
  clearInterval(gameTimer);
  updateTimerDisplay();
  gameTimer = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(gameTimer);
      toast("⏰ หมดเวลา! ถึงเวลาโหวต!");
      callVote();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  const el = document.getElementById("timer-text");
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  el.parentElement.classList.toggle("urgent", timeLeft <= 60);
}

// === VOTE ===
function callVote() {
  clearInterval(gameTimer);
  socket.emit("start-vote");
}

socket.on("vote-started", ({ players }) => {
  showScreen("screen-vote");
  const container = document.getElementById("vote-players");
  container.innerHTML = players.filter(p => p.id !== myId).map(p =>
    `<button class="vote-btn" onclick="castVote('${p.id}', this)">${p.name}</button>`
  ).join('');
  document.getElementById("vote-status").textContent = "เลือกคนที่คุณสงสัย...";
});

function castVote(targetId, btn) {
  document.querySelectorAll(".vote-btn").forEach(b => { b.classList.remove("voted"); b.disabled = true; });
  btn.classList.add("voted");
  socket.emit("cast-vote", { targetId });
}

socket.on("vote-update", ({ votedCount, totalPlayers }) => {
  document.getElementById("vote-status").textContent = `โหวตแล้ว ${votedCount}/${totalPlayers} คน`;
});

socket.on("vote-results", ({ accused, isSpy, spy, location, players }) => {
  showScreen("screen-results");
  clearInterval(gameTimer);
  
  let html = `<div class="result-card">`;
  html += `<h3>🗳️ ผลโหวต</h3>`;
  html += `<p>คนที่ถูกเลือกมากที่สุด: <strong>${accused.name}</strong></p>`;
  if (isSpy) {
    html += `<p style="color:var(--success)">✅ ถูกต้อง! ${accused.name} คือสายลับ!</p>`;
    document.getElementById("result-title").textContent = "🎉 ชาวเมืองชนะ!";
  } else {
    html += `<p style="color:var(--danger)">❌ ผิด! ${accused.name} ไม่ใช่สายลับ</p>`;
    html += `<p class="spy-reveal">🕵️ สายลับคือ: ${spy.name}</p>`;
    document.getElementById("result-title").textContent = "😈 สายลับชนะ!";
  }
  html += `<p class="location-reveal">📍 สถานที่: ${location}</p>`;
  html += `</div>`;

  html += `<div class="result-card"><h3>👥 ผู้เล่นทั้งหมด</h3>`;
  players.forEach(p => {
    html += `<div class="result-player"><span>${p.name}</span><span ${p.isSpy ? 'class="spy-tag"' : ''}>${p.isSpy ? '🕵️ สายลับ' : p.role}</span></div>`;
  });
  html += `</div>`;

  document.getElementById("result-content").innerHTML = html;
  document.getElementById("btn-play-again").style.display = isHost ? "block" : "none";
});

// === SPY GUESS ===
function showSpyGuess() {
  socket.emit("get-locations");
}

socket.on("locations-list", (locs) => {
  showScreen("screen-spy-guess");
  document.getElementById("spy-locations").innerHTML = locs.map(l =>
    `<button class="spy-loc-btn" onclick="spyGuess('${l.replace(/'/g, "\\'")}')">${l}</button>`
  ).join('');
});

function spyGuess(location) {
  socket.emit("spy-guess", { location });
}

socket.on("spy-guess-result", ({ spy, guessedLocation, actualLocation, correct, players }) => {
  showScreen("screen-results");
  clearInterval(gameTimer);

  let html = `<div class="result-card">`;
  html += `<h3>🎯 สายลับทายสถานที่</h3>`;
  html += `<p>🕵️ สายลับ: <strong>${spy.name}</strong></p>`;
  html += `<p>ทาย: <strong>${guessedLocation}</strong></p>`;
  html += `<p>สถานที่จริง: <strong class="location-reveal">${actualLocation}</strong></p>`;
  if (correct) {
    html += `<p style="color:var(--danger)">✅ ทายถูก! สายลับชนะ!</p>`;
    document.getElementById("result-title").textContent = "😈 สายลับชนะ!";
  } else {
    html += `<p style="color:var(--success)">❌ ทายผิด! ชาวเมืองชนะ!</p>`;
    document.getElementById("result-title").textContent = "🎉 ชาวเมืองชนะ!";
  }
  html += `</div>`;

  html += `<div class="result-card"><h3>👥 ผู้เล่นทั้งหมด</h3>`;
  players.forEach(p => {
    html += `<div class="result-player"><span>${p.name}</span><span ${p.isSpy ? 'class="spy-tag"' : ''}>${p.isSpy ? '🕵️ สายลับ' : p.role}</span></div>`;
  });
  html += `</div>`;

  document.getElementById("result-content").innerHTML = html;
  document.getElementById("btn-play-again").style.display = isHost ? "block" : "none";
});

// === PLAY AGAIN ===
function playAgain() { socket.emit("play-again"); }

socket.on("back-to-lobby", ({ players, host }) => {
  isHost = (host === myId);
  document.getElementById("settings-panel").style.display = isHost ? "flex" : "none";
  showScreen("screen-lobby");
  updatePlayerList(players, host);
  toast("🔄 พร้อมเล่นรอบใหม่!");
});

// === LEAVE ===
function leaveRoom() {
  location.reload();
}

// === HOST CHANGED ===
socket.on("host-changed", ({ newHost }) => {
  toast("👑 " + newHost + " เป็น Host คนใหม่");
});

// === KICKED ===
socket.on("kicked", () => {
  toast("คุณถูกเตะออกจากห้อง", true);
  setTimeout(() => location.reload(), 2000);
});

// === ERRORS ===
socket.on("error-msg", (msg) => toast(msg, true));

// === ADMIN ===
const ADMIN_PASS = "JINLAPAT47";
function showAdminLogin() { showScreen("screen-admin-login"); }

function adminLogin() {
  const pass = document.getElementById("admin-pass").value;
  if (pass === ADMIN_PASS) {
    showScreen("screen-admin");
    loadAdminLocations();
  } else {
    toast("รหัสผ่านไม่ถูกต้อง", true);
  }
}

async function loadAdminLocations() {
  try {
    const res = await fetch("/locations.json");
    const locs = await res.json();
    const container = document.getElementById("admin-locations");
    container.innerHTML = locs.map((l, i) => `
      <details class="admin-loc">
        <summary>${i + 1}. ${l.name}</summary>
        <div class="roles">${l.roles.join(', ')}</div>
      </details>
    `).join('');
  } catch (e) { toast("โหลดสถานที่ไม่สำเร็จ", true); }
}
