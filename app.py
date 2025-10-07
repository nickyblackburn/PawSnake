import random
import time
from threading import Lock
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room

# --- Server setup ---
app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret'
socketio = SocketIO(app, cors_allowed_origins="*")
tick_hz = 5 # game ticks per second
state_lock = Lock()

# --- Game model ---
GRID_W, GRID_H = 30, 20
INIT_LEN = 4

def new_food(occupied):
    while True:
        fx, fy = random.randrange(GRID_W), random.randrange(GRID_H)
        if (fx, fy) not in occupied:
            return (fx, fy)

def spawn_snake(side='left'):
    if side == 'left':
        x = GRID_W // 4
        dir = (1, 0)
    else:
        x = GRID_W - GRID_W // 4
        dir = (-1, 0)
    y = GRID_H // 2
    body = [(x - i*dir[0], y - i*dir[1]) for i in range(INIT_LEN)]
    return {'body': body, 'dir': dir, 'alive': True, 'pending_growth': 0}

def step_snake(snake):
    if not snake['alive']:
        return
    dx, dy = snake['dir']
    hx, hy = snake['body'][0]
    nx, ny = hx + dx, hy + dy
    snake['body'].insert(0, (nx, ny))
    if snake['pending_growth'] > 0:
        snake['pending_growth'] -= 1
    else:
        snake['body'].pop()

def collide(sn, occupied_except=None):
    if not sn['alive']:
        return True
    hx, hy = sn['body'][0]
    # walls
    if not (0 <= hx < GRID_W and 0 <= hy < GRID_H):
        return True
    # self
    if (hx, hy) in sn['body'][1:]:
        return True
    # others
    if occupied_except and (hx, hy) in occupied_except:
        return True
    return False

def ai_choose_dir(ai_snake, food, occupied):
    # Simple greedy AI with basic wall/obstacle avoidance
    dirs = [(1,0),(-1,0),(0,1),(0,-1)]
    hx, hy = ai_snake['body'][0]
    best = None
    best_score = 1e9
    fx, fy = food
    for (dx,dy) in dirs:
        nx, ny = hx + dx, hy + dy
        # discourage reversing
        if len(ai_snake['body']) >= 2 and (nx, ny) == ai_snake['body'][1]:
            continue
        # collision heuristic
        bad = 0
        if not (0 <= nx < GRID_W and 0 <= ny < GRID_H):
            bad += 1000
        if (nx, ny) in occupied:
            bad += 800
        # distance to food
        d = abs(fx-nx) + abs(fy-ny)
        score = bad + d
        if score < best_score:
            best_score = score
            best = (dx,dy)
    # fallback keep direction if none better
    return best if best else ai_snake['dir']

class Room:
    def __init__(self, room_id, mode):
        self.id = room_id
        self.mode = mode  # 'ai' or 'pvp'
        self.snakes = {}  # sid -> snake
        self.tags = {}    # 'p1','p2' mapping to sid
        self.food = (GRID_W//2, GRID_H//2)
        self.running = False
        self.winner = None
        self.last_tick = 0

    def occupied_cells(self, except_sid=None):
        cells = set()
        for sid, sn in self.snakes.items():
            for c in sn['body']:
                cells.add(c)
        if except_sid is not None and except_sid in self.snakes:
            for c in self.snakes[except_sid]['body']:
                cells.discard(c)
        return cells

    
    def reset(self):
        self.snakes.clear()
        self.tags.clear()
        self.food = (GRID_W//2, GRID_H//2)
        self.winner = None
        self.pending_dirs.clear()
        self.running = False

rooms = {}  # room_id -> Room

# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

# --- Socket handlers ---
@socketio.on('create_room')
def on_create(data):
    mode = data.get('mode','ai')
    room_id = data.get('room') or str(random.randint(1000,9999))
    with state_lock:
        if room_id in rooms:
            emit('error', {'message':'Room already exists'})
            return
        r = Room(room_id, mode)
        rooms[room_id] = r
    join_room(room_id)
    with state_lock:
        # Assign creator as P1
        r.tags['p1'] = request.sid
        r.snakes[request.sid] = spawn_snake('left')
        if mode == 'ai':
            # create AI snake under tag 'p2' with pseudo sid '_ai'
            r.tags['p2'] = '_ai'
            r.snakes['_ai'] = spawn_snake('right')
        r.food = new_food(r.occupied_cells())
    emit('room_joined', {'room': room_id, 'as': 'p1', 'mode': mode})
    socketio.start_background_task(game_loop, room_id)


@socketio.on('set_dir')
def on_dir(data):
    room_id = data.get('room')
    vx, vy = data.get('dir',[0,0])
    with state_lock:
        r = rooms.get(room_id)
        if not r or request.sid not in r.snakes:
            return
        sn = r.snakes[request.sid]
        # prevent 180s
        cx, cy = sn['dir']
        if (vx,vy) == (-cx,-cy):
            return
        sn['dir'] = (vx,vy)

def game_loop(room_id):
    # run until room ends (no players left)
    while True:
        with state_lock:
            r = rooms.get(room_id)
            if not r:
                return
            # stop if no human players remain
            human_sids = [sid for sid in r.snakes.keys() if sid != '_ai']
            if len(human_sids) == 0:
                # cleanup
                rooms.pop(room_id, None)
                socketio.emit('room_closed', {'room': room_id}, to=room_id)
                return

            # AI decide
            if r.mode == 'ai' and r.snakes.get('_ai', {}).get('alive'):
                oc = r.occupied_cells(except_sid='_ai')
                new_dir = ai_choose_dir(r.snakes['_ai'], r.food, oc)
                r.snakes['_ai']['dir'] = new_dir

            # step all snakes
            for sid, sn in r.snakes.items():
                if sn['alive']:
                    step_snake(sn)

            # resolve collisions & food
            occupied_all = {}
            for sid, sn in r.snakes.items():
                for c in sn['body']:
                    occupied_all.setdefault(c, 0)
                    occupied_all[c] += 1

            # check collisions
            for sid, sn in r.snakes.items():
                if not sn['alive']:
                    continue
                if collide(sn, occupied_except=None):
                    sn['alive'] = False
                    continue
                # head-on collision or running into other's body managed by overlap count >1 at head
                hx, hy = sn['body'][0]
                if occupied_all.get((hx,hy), 0) > 1:
                    sn['alive'] = False

            # food eat and respawn
            for sid, sn in r.snakes.items():
                if not sn['alive']:
                    continue
                if sn['body'][0] == r.food:
                    sn['pending_growth'] += 2
                    r.food = new_food(set(occupied_all.keys()))

            # determine winner
            alive = [sid for sid, sn in r.snakes.items() if sn['alive']]
            if len(alive) == 0:
                r.winner = 'draw'
            elif len(alive) == 1 and len(r.snakes) >= 2:
                # map back to tag if possible
                sid = alive[0]
                tag = next((t for t,s in r.tags.items() if s == sid), sid)
                r.winner = tag

            # broadcast state
            payload = {
                'grid': [GRID_W, GRID_H],
                'snakes': {t: r.snakes[sid] for t, sid in r.tags.items() if sid in r.snakes},
                'food': r.food,
                'winner': r.winner
            }
            socketio.emit('state', payload, to=room_id)

            # if game ended, stop after a couple seconds
            if r.winner:
                # let clients see end state, then close
                socketio.emit('game_over', {'winner': r.winner}, to=room_id)
                time.sleep(2)
                rooms.pop(room_id, None)
                socketio.emit('room_closed', {'room': room_id}, to=room_id)
                return
        socketio.sleep(1.0/tick_hz)

@socketio.on('restart')
def on_restart(data):
    room_id = data.get('room')
    with state_lock:
        r = rooms.get(room_id)
        if not r:
            emit('error', {'message':'Room not found'})
            return
        # preserve mode and whoever is still connected
        mode = r.mode
        tags = dict(r.tags)
        r.reset()
        r.mode = mode
        r.tags = tags
        # respawn present players/AI
        if 'p1' in r.tags:
            r.snakes[r.tags['p1']] = spawn_snake('left')
        if mode == 'ai':
            r.tags['p2'] = '_ai'
            r.snakes['_ai'] = spawn_snake('right')
        elif 'p2' in r.tags:
            r.snakes[r.tags['p2']] = spawn_snake('right')
        r.food = new_food(r.occupied_cells())
        if not r.running:
            r.running = True
            socketio.start_background_task(game_loop, room_id)
    emit('restarted', {'room': room_id}, room=room_id)


@socketio.on('disconnect')
def on_disconnect():
    # remove player from any rooms
    with state_lock:
        for r in list(rooms.values()):
            if request.sid in r.snakes:
                del r.snakes[request.sid]
                # free tag
                for k,v in list(r.tags.items()):
                    if v == request.sid:
                        del r.tags[k]
                # if empty, let loop clean up next tick
                break

if __name__ == '__main__':
    print("Starting Flask-SocketIO Snake on http://127.0.0.1:5000")
    socketio.run(app, host='0.0.0.0', port=1234, debug=True)
