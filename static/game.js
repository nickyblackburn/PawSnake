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
  let tag = null; // 'p1' or 'p2'
  let gridW=30, gridH=20;

  function setStatus(msg) { status.textContent = msg; }
  function cellSize() { return Math.min(canvas.width/gridW, canvas.height/gridH); }

  function draw(state) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const [W, H] = state.grid;
    gridW=W; gridH=H;
    const s = cellSize();
    // grid (subtle)
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#8be9fd';
    for (let x=0; x<=W; x++) { ctx.beginPath(); ctx.moveTo(x*s, 0); ctx.lineTo(x*s, H*s); ctx.stroke(); }
    for (let y=0; y<=H; y++) { ctx.beginPath(); ctx.moveTo(0, y*s); ctx.lineTo(W*s, y*s); ctx.stroke(); }
    ctx.globalAlpha = 1.0;

    // food
    const [fx, fy] = state.food;
    ctx.fillStyle = '#50fa7b';
    ctx.fillRect(fx*s, fy*s, s, s);

    // snakes
    const colors = { p1:'#8be9fd', p2:'#ff79c6' };
    for (const t of ['p1','p2']) {
      const sn = state.snakes[t];
      if (!sn) continue;
      ctx.fillStyle = colors[t];
      for (const [x,y] of sn.body) {
        ctx.fillRect(x*s, y*s, s, s);
      }
      // head highlight
      if (sn.body.length) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.6;
        const [hx,hy] = sn.body[0];
        ctx.fillRect(hx*s, hy*s, s, s);
        ctx.globalAlpha = 1.0;
      }
    }

    if (state.winner) {
      over.textContent = state.winner === 'draw' ? 'Draw! No survivors 💥' : `${state.winner.toUpperCase()} wins! 🎉`;
    } else {
      over.textContent = '';
    }
  }

  // inputs
  const keyDir = {
    'ArrowUp':[0,-1], 'KeyW':[0,-1],
    'ArrowDown':[0,1], 'KeyS':[0,1],
    'ArrowLeft':[-1,0], 'KeyA':[-1,0],
    'ArrowRight':[1,0], 'KeyD':[1,0],
  };
  document.addEventListener('keydown', (e) => {
    const d = keyDir[e.code];
    if (!d || !room) return;
    socket.emit('set_dir', { room, dir: d });
  });

  // buttons
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
    } catch (e) {
      setStatus('Copy failed — you can share the code manually.');
    }
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

  // socket events
  socket.on('room_joined', (data) => {
    room = data.room;
    tag = data['as'];
    setStatus(`Joined room ${room} as ${tag.toUpperCase()} in ${data.mode.toUpperCase()} mode.`);
  });
  socket.on('state', (state) => draw(state));
  socket.on('game_over', (data) => {
    setStatus(`Game over — ${data.winner === 'draw' ? 'Draw' : data.winner.toUpperCase() + ' wins'}. Create or join a new room!`);
  });
  socket.on('room_closed', () => {
    setStatus('Room closed.');
  });
  socket.on('error', (e) => setStatus(e.message || 'Error'));
})();
