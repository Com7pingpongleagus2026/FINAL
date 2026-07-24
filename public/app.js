// === SPYFALL ONLINE — Board Game Style ===
const socket = io();
let myId = null;
let isHost = false;
let roomCode = null;
let gameTimer = null;
let timeLeft = 0;
let totalTime = 0;
let myAssignment = null;
let wakeLock = null;

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

// === SOUND (Web Audio) ===
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function playBeep(freq = 800, duration = 0.1) {
  try {
    if (!audioCtx) audioCtx = new AudioCtx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch(e) {}
}
function vibrate(ms = 100) { try { navigator.vibrate(ms); } catch(e) {} }

// === WAKE LOCK ===
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }

// === URL AUTO-FILL ===
(function() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) {
    document.getElementById('join-code').value = room.toUpperCase();
    showScreen('screen-join');
  }
})();

// === CREATE ROOM ===
function createRoom() {
  const name = document.getElementById("create-name").value.trim();
  if (!name) return toast("กรุณาใส่ชื่อ", true);
  socket.emit("create-room", { playerName: name, settings: { timer: 480 } });
}

socket.on("room-created", ({ code, players, host }) => {
  roomCode = code;
  isHost = true;
  document.getElementById("lobby-code").textContent = code;
  document.getElementById("settings-panel").style.display = "block";
  showScreen("screen-lobby");
  updatePlayerList(players, host);
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
  if (isHost) document.getElementById("settings-panel").style.display = "block";
  showScreen("screen-lobby");
  updatePlayerList(players, host);
  toast("เข้าร่วมห้อง " + code + " สำเร็จ!");
});

// === PLAYER LIST ===
function updatePlayerList(players, host) {
  isHost = (host === myId);
  const list = document.getElementById("player-list");
  list.innerHTML = players.map(p => {
    const isMe = p.id === myId;
    const isPlayerHost = p.id === host;
    const badges = [];
    if (isPlayerHost) badges.push('<span class="badge">👑 HOST</span>');
    if (isMe) badges.push('<span class="badge" style="background:#10b981">คุณ</span>');
    if (!p.connected) badges.push('<span class="badge badge-offline">ออฟไลน์</span>');
    const kickBtn = (isHost && !isMe) ? `<button class="kick-btn" onclick="kickPlayer('${p.id}')">✕</button>` : '';
    return `<div class="player-item">
      <div class="player-info">
        <div class="player-avatar" style="background:${p.color}">${p.avatar}</div>
        <span class="player-name">${p.name}</span>${badges.join('')}
      </div>
      ${kickBtn}
    </div>`;
  }).join('');

  const startBtn = document.getElementById("btn-start");
  const hint = document.getElementById("lobby-hint");
  if (isHost) {
    document.getElementById("settings-panel").style.display = "block";
    if (players.length >= 3) {
      startBtn.style.display = "block";
      hint.textContent = `ผู้เล่น ${players.length} คน — พร้อมเริ่ม!`;
    } else {
      startBtn.style.display = "none";
      hint.textContent = `ผู้เล่น ${players.length}/3 — รออีก ${3 - players.length} คน`;
    }
  } else {
    startBtn.style.display = "none";
    hint.textContent = `ผู้เล่น ${players.length} คน — รอ Host เริ่มเกม...`;
  }
}

socket.on("player-list", ({ players, host }) => updatePlayerList(players, host));

// === SETTINGS ===
function updateSettings() {
  const timer = document.getElementById("timer-select").value;
  socket.emit("update-settings", { timer });
}
socket.on("settings-updated", (settings) => {
  document.getElementById("timer-select").value = settings.timer;
});

// === START GAME ===
function startGame() { socket.emit("start-game"); }

socket.on("game-started", ({ assignment, timer, players, locationCount }) => {
  myAssignment = assignment;
  totalTime = timer;
  timeLeft = timer;
  showScreen("screen-game");
  requestWakeLock();

  // Reset card
  document.getElementById("game-card").classList.remove("flipped");
  document.getElementById("btn-ready").style.display = "none";
  document.getElementById("card-phase").style.display = "block";
  document.getElementById("play-phase").style.display = "none";
  document.getElementById("card-phase-title").textContent = "แตะการ์ดเพื่อดู";

  // Set card content
  const cardBack = document.getElementById("card-back");
  const content = document.getElementById("card-content");
  if (assignment.isSpy) {
    cardBack.classList.add("spy-card");
    content.innerHTML = `
      <div class="card-spy-text">🕵️ สายลับ</div>
      <div class="card-spy-sub">คุณไม่รู้สถานที่!<br>ฟังคนอื่นแล้วทาย</div>
    `;
  } else {
    cardBack.classList.remove("spy-card");
    content.innerHTML = `
      <div class="card-label">📍 สถานที่</div>
      <div class="card-location-text">${assignment.location}</div>
      <div class="card-label" style="margin-top:16px">🎭 บทบาท</div>
      <div class="card-role-text">${assignment.role}</div>
    `;
  }

  // Store players for host actions
  window._gamePlayers = players;

  // Show host actions
  document.getElementById("host-game-actions").style.display = isHost ? "block" : "none";

  playBeep(600, 0.2);
  vibrate(200);
});

// === CARD FLIP ===
function flipCard() {
  const card = document.getElementById("game-card");
  if (!card.classList.contains("flipped")) {
    card.classList.add("flipped");
    document.getElementById("btn-ready").style.display = "block";
    document.getElementById("card-phase-title").textContent = "จำให้ได้แล้วกดพร้อม!";
    playBeep(1000, 0.1);
  }
}

function cardReady() {
  // Flip back and go to play phase
  document.getElementById("game-card").classList.remove("flipped");
  setTimeout(() => {
    document.getElementById("card-phase").style.display = "none";
    document.getElementById("play-phase").style.display = "block";
    startTimer();
  }, 400);
}

// === TIMER ===
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 90; // 565.48

function startTimer() {
  updateTimerDisplay();
  gameTimer = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 10 && timeLeft > 0) {
      playBeep(900, 0.05);
      document.getElementById("timer-progress").classList.add("pulse");
    }
    if (timeLeft <= 0) {
      clearInterval(gameTimer);
      vibrate(500);
      playBeep(400, 0.5);
      if (isHost) {
        toast("⏰ หมดเวลา! กดจบรอบเพื่อเฉลย");
      } else {
        toast("⏰ หมดเวลา! รอ Host เฉลย");
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  document.getElementById("timer-text").textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Update circle
  const progress = document.getElementById("timer-progress");
  const offset = CIRCLE_CIRCUMFERENCE * (1 - timeLeft / totalTime);
  progress.style.strokeDasharray = CIRCLE_CIRCUMFERENCE;
  progress.style.strokeDashoffset = offset;

  // Color change
  const ratio = timeLeft / totalTime;
  progress.classList.remove("warning", "danger", "pulse");
  if (ratio <= 0.15) {
    progress.classList.add("danger");
  } else if (ratio <= 0.35) {
    progress.classList.add("warning");
  }
}

// === PEEK CARD ===
function peekCard() {
  const modal = document.getElementById("modal-peek");
  const content = document.getElementById("peek-content");
  if (myAssignment.isSpy) {
    content.innerHTML = `<div class="card-spy-text">🕵️ สายลับ</div><div class="card-spy-sub">คุณไม่รู้สถานที่!</div>`;
  } else {
    content.innerHTML = `<div class="card-label">📍 สถานที่</div><div class="card-location-text">${myAssignment.location}</div><div style="margin-top:12px" class="card-label">🎭 บทบาท</div><div class="card-role-text">${myAssignment.role}</div>`;
  }
  modal.style.display = "flex";
  setTimeout(() => { modal.style.display = "none"; }, 3000);
}
function closePeek(e) { if (e.target === e.currentTarget) e.currentTarget.style.display = "none"; }

// === LOCATIONS LIST ===
function showLocations() {
  socket.emit("get-locations");
}
socket.on("locations-list", (locs) => {
  const grid = document.getElementById("locations-grid");
  grid.innerHTML = locs.map(name => {
    const highlight = (myAssignment && !myAssignment.isSpy && myAssignment.location === name) ? 'style="background:#312e81;color:#a78bfa;font-weight:600"' : '';
    return `<div class="loc-item" ${highlight}>${name}</div>`;
  }).join('');
  document.getElementById("modal-locations").style.display = "flex";
});
function closeModal(e) { if (e.target === e.currentTarget) e.currentTarget.style.display = "none"; }

// === RANDOM QUESTION ===
const questions = [
  "ที่นี่มีกลิ่นอะไรบ้าง?","ปกติคุณมาที่นี่ตอนไหน?","คุณใส่ชุดอะไรมาที่นี่?",
  "ที่นี่มีคนเยอะไหม?","อุณหภูมิที่นี่เป็นยังไง?","คุณมากับใคร?",
  "คุณทำอะไรอยู่ตอนนี้?","ที่นี่ต้องจ่ายเงินไหม?","เด็กมาที่นี่ได้ไหม?",
  "คุณรู้สึกยังไงกับที่นี่?","ถ้าจะไปที่นี่ต้องเตรียมตัวยังไง?","ที่นี่เปิด-ปิดกี่โมง?",
  "ที่นี่มีเสียงอะไรบ้าง?","พื้นที่นี่เป็นยังไง?","คุณเคยมาที่นี่กี่ครั้งแล้ว?",
  "ที่นี่มีอาหารขายไหม?","คุณจะแนะนำที่นี่ให้เพื่อนไหม?","ที่นี่อยู่ในร่มหรือกลางแจ้ง?",
  "ปกติคุณใช้เวลาที่นี่นานแค่ไหน?","ที่นี่มีสัตว์อะไรไหม?","ต้องนัดหมายก่อนมาไหม?",
  "ที่นี่มีป้ายห้ามอะไรบ้าง?","ถ้าลืมของไว้ที่นี่จะได้คืนไหม?","ที่นี่มีจอหรือหน้าจอไหม?",
  "คุณรู้สึกปลอดภัยที่นี่ไหม?","ที่นี่มีที่นั่งไหม?","ต้องใช้อุปกรณ์อะไรเป็นพิเศษไหม?",
  "ถ้าฝนตกจะมีผลกับที่นี่ไหม?","ที่นี่มีเพลงเปิดอยู่ไหม?","ที่นี่เหมาะกับคนมีครอบครัวไหม?",
  "คุณยิ้มอยู่ที่นี่ไหม?","ที่นี่มีน้ำให้ดื่มไหม?","คุณเคยนอนหลับที่นี่ไหม?",
  "ที่นี่ต้องลงทะเบียนก่อนเข้าไหม?","ปกติที่นี่มีคิวยาวไหม?","คุณอยากกลับมาที่นี่อีกไหม?",
  "ที่นี่มีกล้องวงจรปิดไหม?","ถ้าต้องอธิบายที่นี่ใน 1 คำ คุณจะพูดว่าอะไร?",
  "ที่นี่มีห้องน้ำไหม?","คุณเคยทำอะไรผิดกฎที่นี่ไหม?"
];

function randomQuestion() {
  const q = questions[Math.floor(Math.random() * questions.length)];
  const el = document.getElementById("question-card");
  document.getElementById("question-text").textContent = "🎲 " + q;
  el.style.display = "block";
  playBeep(700, 0.1);
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// === HOST ACTIONS ===
function endRound() {
  if (confirm("จบรอบและเฉลยเลย?")) {
    socket.emit("end-round");
  }
}

function backToLobby() {
  if (confirm("กลับ Lobby? เกมรอบนี้จะยุติ")) {
    socket.emit("play-again");
  }
}

// === REVEAL ===
socket.on("round-reveal", ({ spy, location, players }) => {
  clearInterval(gameTimer);
  releaseWakeLock();
  showScreen("screen-reveal");

  const content = document.getElementById("reveal-content");
  content.innerHTML = `
    <div class="reveal-spy">🕵️ สายลับคือ: ${spy.name}</div>
    <div class="reveal-location">📍 สถานที่: ${location}</div>
    <div class="reveal-players">
      <h4 style="margin:12px 0 8px;color:#94a3b8;font-size:.85rem">บทบาททุกคน:</h4>
      ${players.map(p => `
        <div class="reveal-player ${p.isSpy ? 'is-spy' : ''}">
          <div class="rp-avatar" style="background:${p.color}">${p.avatar}</div>
          <span class="rp-name">${p.name}</span>
          <span class="rp-role">${p.role}</span>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById("reveal-actions").style.display = isHost ? "block" : "none";
  playBeep(500, 0.3);
  vibrate(300);
});

// === PLAY AGAIN ===
function playAgain() { socket.emit("play-again"); }

socket.on("back-to-lobby", ({ players, host }) => {
  clearInterval(gameTimer);
  releaseWakeLock();
  showScreen("screen-lobby");
  updatePlayerList(players, host);
  toast("🔄 พร้อมเล่นรอบใหม่!");
});

// === KICK ===
function kickPlayer(id) {
  if (confirm("เตะผู้เล่นนี้ออก?")) {
    socket.emit("kick-player", { targetId: id });
  }
}

socket.on("kicked", () => {
  toast("คุณถูกเตะออกจากห้อง", true);
  setTimeout(() => location.reload(), 2000);
});

// === LEAVE ===
function leaveRoom() { location.reload(); }

// === HOST CHANGED ===
socket.on("host-changed", ({ newHost, hostId }) => {
  isHost = (hostId === myId);
  toast("👑 " + newHost + " เป็น Host คนใหม่");
});

// === COPY ROOM CODE ===
function copyCode() {
  const code = document.getElementById("lobby-code").textContent;
  const url = window.location.origin + "?room=" + code;
  navigator.clipboard.writeText(url).then(() => toast("📋 คัดลอกลิงก์แล้ว!")).catch(() => {
    navigator.clipboard.writeText(code).then(() => toast("📋 คัดลอกรหัส: " + code));
  });
}

// === ERRORS ===
socket.on("error-msg", (msg) => toast(msg, true));
socket.on("toast-msg", (msg) => toast(msg));

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

// === AUTO RECONNECT ===
socket.on("disconnect", () => { toast("⚠️ หลุดการเชื่อมต่อ... กำลังเชื่อมใหม่", true); });
socket.on("reconnect", () => { toast("✅ เชื่อมต่อสำเร็จ!"); });
