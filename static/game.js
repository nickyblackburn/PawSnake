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

  const confettiCanvas = document.getElementById('confetti');
  const confettiCannon = window.confetti.create(confettiCanvas, { resize:true, useWorker:true, alpha:true });

  const modal = document.getElementById('resultModal');
  const resultTitle = document.getElementById('resultTitle');
  const resultText = document.getElementById('resultText');
  const restartBtn = document.getElementById('restartBtn');
  const closeBtn = document.getElementById('closeBtn');

  const socket = io();
  let room=null, tag=null, gridW=30, gridH=20, ended=false;

  function setStatus(msg){status.textContent=msg;}
  function cellSize(){return Math.min(canvas.width/gridW, canvas.height/gridH);}
  function showModal(title, text){resultTitle.textContent=title; resultText.textContent=text; modal.classList.remove('hidden');}
  function hideModal(){modal.classList.add('hidden');}

  function confettiWin(){
    const end=Date.now()+2500;
    (function frame(){
      confettiCannon({particleCount:100,angle:60,spread:55,startVelocity:45,origin:{x:0,y:0.6}});
      confettiCannon({particleCount:100,angle:120,spread:55,startVelocity:45,origin:{x:1,y:0.6}});
      if(Date.now()<end)requestAnimationFrame(frame);
    })();
  }
  function confettiLose(){
    confettiCannon({particleCount:60,spread:50,startVelocity:20,scalar:0.8,colors:['#999','#bbb','#666'],origin:{x:0.5,y:0.3}});
  }

  function draw(state){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const [W,H]=state.grid; gridW=W; gridH=H; const s=cellSize();
    ctx.globalAlpha=0.07; ctx.strokeStyle='#8be9fd';
    for(let x=0;x<=W;x++){ctx.beginPath();ctx.moveTo(x*s,0);ctx.lineTo(x*s,H*s);ctx.stroke();}
    for(let y=0;y<=H;y++){ctx.beginPath();ctx.moveTo(0,y*s);ctx.lineTo(W*s,y*s);ctx.stroke();}
    ctx.globalAlpha=1.0;
    const [fx,fy]=state.food; ctx.fillStyle='#50fa7b'; ctx.fillRect(fx*s,fy*s,s,s);
    const colors={p1:'#8be9fd',p2:'#ff79c6'};
    for(const t of ['p1','p2']){const sn=state.snakes[t]; if(!sn)continue;
      ctx.fillStyle=colors[t]; for(const [x,y] of sn.body)ctx.fillRect(x*s,y*s,s,s);
      if(sn.body.length){ctx.fillStyle='#fff';ctx.globalAlpha=0.6;const[hx,hy]=sn.body[0];ctx.fillRect(hx*s,hy*s,s,s);ctx.globalAlpha=1.0;}
    }
    if(state.winner){const youWon=tag&&state.winner!=='draw'&&state.winner.toLowerCase()===tag.toLowerCase();
      over.textContent=state.winner==='draw'?'Draw! No survivors 💥':youWon?'YOU WIN! 🎉':'You lose… try again 🥺';
    } else over.textContent='';
  }

  const keyDir={'ArrowUp':[0,-1],'KeyW':[0,-1],'ArrowDown':[0,1],'KeyS':[0,1],'ArrowLeft':[-1,0],'KeyA':[-1,0],'ArrowRight':[1,0],'KeyD':[1,0]};
  document.addEventListener('keydown',(e)=>{
    if(!modal.classList.contains('hidden')){
      if(e.key==='Enter'){restartBtn.click();}
      if(e.key==='Escape'){hideModal();}
      return;
    }
    if(ended)return;
    const d=keyDir[e.code]; if(!d||!room)return;
    socket.emit('set_dir',{room,dir:d});
  });

  createBtn.onclick=()=>{const mode=modeEl.value;room=roomEl.value.trim();socket.emit('create_room',{mode,room});};
  joinBtn.onclick=()=>{room=roomEl.value.trim();if(!room){setStatus('Enter a room code.');return;}socket.emit('join_room',{room});};
  copyBtn.onclick=async()=>{if(!room){setStatus('No room yet.');return;}const url=`${location.origin}/?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(modeEl.value)}`;await navigator.clipboard.writeText(url);setStatus('Room link copied!');};
  restartBtn.onclick=()=>{if(room)socket.emit('restart',{room});hideModal();};
  closeBtn.onclick=()=>hideModal();

  socket.on('room_joined',(data)=>{room=data.room;tag=data.as;ended=false;hideModal();setStatus(`Joined ${room} as ${tag.toUpperCase()}`);});
  socket.on('state',(st)=>draw(st));
  socket.on('game_over',(d)=>{
    ended=true;
    if(d.winner==='draw'){showModal('Draw','No survivors 💥');}
    else if(tag&&d.winner.toLowerCase()===tag.toLowerCase()){showModal('YOU WIN! 🎉','Play again?');confettiWin();}
    else {showModal('You lose…','Try another round?');confettiLose();}
  });
  socket.on('restarted',()=>{ended=false;hideModal();setStatus('New round!');});
})();
