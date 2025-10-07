(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const over = document.getElementById('over');
  const modeEl = document.getElementById('mode');
  const roomEl = document.getElementById('room');
  const createBtn = document.getElementById('create');
  const joinBtn = document.getElementById('join');
  const copyBtn = document.getElementById('copy');

  const socket = io();
  let room = null;
  let tag = null;        // 'p1' | 'p2'
  let gridW = 30, gridH = 20;
  let ended = false;

  // ——— UI helpers ———
  function setStatus(msg) { status.textContent = msg; }
  function cellSize() { return Math.min(canvas.width / gridW, canvas.height / gridH); }

  // Create a Play Again button once and reuse it
  const playAgainBtn = document.createElement('button');
  playAgainBtn.textContent = 'Play again';
  playAgainBtn.style.display = 'none';
  playAgainBtn.onclick = () => { if (room) socket.emit('restart', { room }); };
  document.getElementById('game').appendChild(playAgainBtn);

  // ——— Confetti helpers ———
  function tinyConfettiFallback(durationMs = 1500, count = 100) {
    for (let i = 0; i < count; i++) {
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.left = Math.random() * 100 + 'vw';
      div.style.top = '-5vh';
      div.style.width = div.style.height = '8px';
      div.style.background = `hsl(${Math.random() * 360}, 100%, 60%)`;
      div.style.borderRadius = '2px';
      div.style.opacity = '0.9';
      div.style.pointerEvents = 'none';
      document.body.appendChild(div);
      const fall = div.animate(
        [{ transform: `translateY(${window.innerHeight + 100}px) rotate(${Math.random() * 360}deg)` }],
        { duration: durationMs + Math.random() * 800, easing: 'ease-in' }
      );
      fall.onfinish = () => div.remove();
    }
  }

  function celebrate(duration = 2000) {
    if (window.confetti) {
      const end = Date.now() + duration;
      (function frame() {
        window.confetti({
          particleCount: 6,
          spread: 60,
          origin: { y: 0.7 }
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    } else {
      tinyConfettiFallback(1500, 120);
    }
  }

  // ——— Rendering ———
  function draw(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [W, H] = state.grid;
    gridW = W; gridH = H;
    const s = cellSize();

    // subtle grid
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#8be9fd';
    for (let x = 0; x <= W; x++) { ctx.beginPath(); ctx.moveTo(x * s, 0); ctx.lineTo(x * s, H * s); ctx.stroke(); }
    for (let y = 0; y <= H; y++) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(W * s, y * s); ctx.stroke(); }
    ctx.globalAlpha = 1.0;

    // food
    const [fx, fy] = state.food;
    ctx.fillStyle = '#50fa7b';
    ctx.fillRect(fx * s, fy * s, s, s);

    // snakes
    const colors = { p1: '#8be9fd', p2: '#ff79c6' };
    for (const t of ['p1', 'p2']) {
      const sn = state.snakes[t];
      if (!sn) continue;
      ctx.fillStyle = colors[t];
      for (const [x, y] of sn.body) {
        ctx.fillRect(x * s, y * s, s, s);
      }
      // head highlight
      if (sn.body.length) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6;
        const [hx, hy] = sn.body[0];
        ctx.fillRect(hx * s, hy * s, s, s);
        ctx.globalAlpha = 1.0;
      }
    }

    // show winner overlay text if any
    if (state.winner) {
      const youWon = tag && state.winner !== 'draw' && state.winner.toLowerCase() === tag.toLowerCase();
      over.textContent =
        state.winner === 'draw' ? 'Draw! No survivors 💥' :
        youWon ? 'YOU WIN! 🎉' : 'You lose… try again 🥺';
    } else {
      over.textContent = '';
    }
  }

  // ——— Inputs ———
  const keyDir = {
    'ArrowUp': [0, -1], 'KeyW': [0, -1],
    'ArrowDown': [0, 1], 'KeyS': [0, 1],
    'ArrowLeft': [-1, 0], 'KeyA': [-1, 0],
    'ArrowRight': [1, 0], 'KeyD': [1, 0],
  };
  document.addEventListener('keydown', (e) => {
    if (ended) return; // ignore after game over
    const d = keyDir[e.code];
    if (!d || !room) return;
    socket.emit('set_dir', { room, dir: d });
  });

  // ——— Buttons ———
  createBtn.onclick = () => {
    const mode = modeEl.value;
    room = roomEl.value.trim();
    socket.emit('create_room', { mode, room });
  };

  joinBtn.onclick = () => {
    room = roomEl.value.trim();
    if (!room) { setStatus('Enter a room code to join.'); return; }
    socket.emit('join_room', { room });
  };

  copyBtn.onclick = async () => {
    if (!room) { setStatus('No room yet. Create or join first.'); return; }
    const url = `${location.origin}/?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(modeEl.value)}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Room link copied to clipboard!');
    } catch { setStatus('Copy failed — share the code manually.'); }
  };

  // auto-join from URL params
  window.addEventListener('load', () => {
    const p = new URLSearchParams(location.search);
    const urlRoom = p.get('room');
    const urlMode = p.get('mode');
    if (urlMode) modeEl.value = urlMode;
    if (urlRoom) {
      roomEl.value = urlRoom;
      room = urlRoom;
      socket.emit('join_room', { room });
    }
  });

  // ——— Socket events ———
  socket.on('room_joined', (data) => {
    room = data.room;
    tag = data['as'];
    ended = false;
    playAgainBtn.style.display = 'none';
    over.textContent = '';
    setStatus(`Joined room ${room} as ${tag.toUpperCase()} in ${data.mode.toUpperCase()} mode.`);
  });

  socket.on('state', (state) => draw(state));

  socket.on('game_over', (data) => {
    ended = true;
    const w = data.winner; // 'p1' | 'p2' | 'draw'
    let msg = '';
    if (w === 'draw') msg = 'Draw! No survivors 💥';
    else if (tag && w.toLowerCase() === tag.toLowerCase()) {
      msg = 'YOU WIN! 🎉';
      celebrate(2000);
    } else msg = 'You lose… try again 🥺';
    over.textContent = msg;
    celebrate(2000);
    setStatus(`Game over — ${msg}`);
    playAgainBtn.style.display = 'inline-block';
  });

  socket.on('restarted', () => {
    ended = false;
    playAgainBtn.style.display = 'none';
    over.textContent = '';
    setStatus('New round — good luck!');
  });

  socket.on('room_closed', () => {
    ended = true;
    playAgainBtn.style.display = 'none';
    setStatus('Room closed.');
  });

  socket.on('error', (e) => setStatus(e.message || 'Error'));
})();

