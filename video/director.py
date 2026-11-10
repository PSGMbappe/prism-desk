"""
Scene director for the Prism Desk demo video.

Drives the IWSDK emulator (seated player, hand tracking) through each scene
while video/record.mjs captures frames. Logs sound-effect cues to
video/frames/<scene>/cues.json so the editor can add the game's sounds.

Usage: python3 video/director.py s1 s2 ...   (needs `iwsdk dev up` running)
"""
import json
import math
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = os.path.join(ROOT, 'video', 'frames')
S = 0.065  # grid cell size, matches src/game.ts

# Seated at the office desk, looking down at the desktop.
SEAT = {'x': 0.0, 'y': 1.13, 'z': -1.6}
LOOK = {'x': -0.4226, 'y': 0.0, 'z': 0.0, 'w': 0.9063}  # ~50 degrees down
REST = {'right': {'x': 0.3, 'y': 0.82, 'z': -1.78}, 'left': {'x': -0.3, 'y': 0.82, 'z': -1.78}}


def iw(*args, payload=None, timeout=90):
    cmd = ['npx', 'iwsdk', *args]
    if payload is not None:
        cmd += ['--input-json', json.dumps(payload)]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout).stdout
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {'ok': False, 'raw': out[-500:]}


def write_cfg(**cfg):
    with open(os.path.join(ROOT, 'video', 'rec.json'), 'w') as f:
        json.dump(cfg, f)


# ------------------------------------------------------------------ session

def fresh_session(level, seat=True):
    """Reload at a saved level and enter XR seated at the desk."""
    write_cfg(scene='_', seconds=1, level=level)
    iw('browser', 'run', 'video/storage.mjs')
    iw('browser', 'reload')
    time.sleep(5)
    enter_xr(seat)


def enter_xr(seat=True):
    iw('xr', 'enter')
    if seat:
        iw('xr', 'set-transform', payload={'device': 'headset', 'position': SEAT, 'orientation': LOOK})
    iw('xr', 'set-input-mode', payload={'mode': 'hand'})
    time.sleep(5.5)  # board places itself, then snaps onto the desk
    for hand in ('left', 'right'):
        iw('xr', 'set-transform', payload={'device': f'hand-{hand}', 'position': REST[hand], 'anchor': 'wrist',
                                           'orientation': {'fingers': 'forward', 'palm': 'down'}})


def board_pose():
    found = iw('ecs', 'find', payload={'namePattern': 'Prism Board'})
    idx = found['data']['result']['entities'][0]['entityIndex']
    q = iw('ecs', 'query', payload={'entityIndex': idx})['data']['result']
    t = next(c for c in q['components'] if c['componentId'] == 'Transform')['values']
    x, y, z = t['position']
    qx, qy, qz, qw = t['orientation']
    yaw = math.atan2(2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qx * qx))
    return x, y, z, yaw


def cell_world(pose, level, c, r, lift=0.02):
    x0, y0, z0, yaw = pose
    lx = (c - (level['cols'] - 1) / 2) * S
    lz = (r - (level['rows'] - 1) / 2) * S
    wx = x0 + lx * math.cos(yaw) + lz * math.sin(yaw)
    wz = z0 - lx * math.sin(yaw) + lz * math.cos(yaw)
    return {'x': round(wx, 4), 'y': round(y0 + lift, 4), 'z': round(wz, 4)}


# --------------------------------------------------------------- recording

class Take:
    """Record one scene; collect sound cues in wall-clock time."""

    def __init__(self, scene):
        self.scene = scene
        self.cues = []

    def __enter__(self):
        write_cfg(scene=self.scene, seconds=100)
        self.proc = subprocess.Popen(
            ['npx', 'iwsdk', 'browser', 'run', 'video/record.mjs', '--timeout', '108000'],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        started = os.path.join(FRAMES, self.scene, 'started')
        deadline = time.time() + 40
        while not os.path.exists(started):
            if self.proc.poll() is not None or time.time() > deadline:
                out = self.proc.stdout.read() if self.proc.poll() is not None else '(still starting)'
                raise RuntimeError(f'recorder did not start for {self.scene}: {out[-800:]}')
            time.sleep(0.05)
        time.sleep(0.4)
        return self

    def cue(self, name, at=None):
        self.cues.append({'name': name, 't': at if at is not None else time.time()})

    def hold(self, seconds):
        time.sleep(seconds)

    def __exit__(self, *exc):
        open(os.path.join(FRAMES, self.scene, 'stop'), 'w').close()
        self.proc.wait(timeout=60)
        with open(os.path.join(FRAMES, self.scene, 'cues.json'), 'w') as f:
            json.dump(self.cues, f)
        n = len(os.listdir(os.path.join(FRAMES, self.scene)))
        print(f'  recorded {self.scene}: {n} files, {len(self.cues)} cues')


IW = os.path.join(ROOT, 'node_modules', '.bin', 'iwsdk')
HOVER = 0.075   # height above the board when carrying
GRASP_Y = 0.035  # pinch height over a tile's base


def fire(*args, payload=None):
    """Start an emulator command without waiting (keeps motion continuous)."""
    cmd = [IW, *args]
    if payload is not None:
        cmd += ['--input-json', json.dumps(payload)]
    return subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


LAG = 0.17  # command start-up time


def glide(hand, pos, dur, anchor='grasp', orientation='auto'):
    fire('xr', 'animate-to', payload={
        'device': f'hand-{hand}', 'position': pos, 'anchor': anchor,
        'orientation': orientation, 'duration': dur, 'easing': 'minimum-jerk'})
    time.sleep(dur + LAG)


def pinch(hand, value, dur=0.14):
    fire('xr', 'set-select-value', payload={'device': f'hand-{hand}', 'value': value, 'duration': dur})
    time.sleep(dur + LAG)


def world(pose, local):
    x0, y0, z0, yaw = pose
    lx, ly, lz = local
    return {'x': round(x0 + lx * math.cos(yaw) + lz * math.sin(yaw), 4),
            'y': round(y0 + ly, 4),
            'z': round(z0 - lx * math.sin(yaw) + lz * math.cos(yaw), 4)}


def reach_time(a, b):
    d = math.dist((a['x'], a['y'], a['z']), (b['x'], b['y'], b['z']))
    return max(0.35, min(1.1, d / 0.32))


def cell_local(level, c, r):
    return ((c - (level['cols'] - 1) / 2) * S, 0, (r - (level['rows'] - 1) / 2) * S)


def tray_local(level, slot):
    n = len(level['tray'])
    return ((slot - (n - 1) / 2) * 0.095, 0, (level['rows'] / 2 + 1) * S + 0.055)


def button_local(level, which):
    slab_w = max((level['cols'] + 2) * S, len(level['tray']) * 0.095) + 0.02
    bx = slab_w / 2 + 0.04
    tz = (level['rows'] / 2 + 1) * S + 0.055
    return {'start': (0, 0, tz), 'reset': (bx, 0, tz), 'next': (-bx, 0, tz)}[which]


class Hands:
    """Tracks where each emulated hand is so reach times can be computed."""

    def __init__(self):
        self.at = {h: dict(REST[h]) for h in ('left', 'right')}

    def go(self, hand, pos, anchor='grasp', dur=None, orientation='auto'):
        d = dur if dur is not None else reach_time(self.at[hand], pos)
        glide(hand, pos, d, anchor, orientation)
        self.at[hand] = dict(pos)

    def rest(self, hand):
        self.go(hand, REST[hand], anchor='wrist', dur=0.8,
                orientation={'fingers': 'forward', 'palm': 'down'})


HANDS = Hands()


def pick_hand(pose, local):
    return 'right' if local[0] >= -0.03 else 'left'


def carry(take, pose, src, dst, hand=None, sound='place', valid=True):
    """Pinch the tile sitting at board-local `src`, drop it at `dst`."""
    hand = hand or pick_hand(pose, dst if valid else src)
    above = lambda loc: world(pose, (loc[0], HOVER, loc[2]))
    at = lambda loc: world(pose, (loc[0], GRASP_Y, loc[2]))
    HANDS.go(hand, above(src))
    HANDS.go(hand, at(src), dur=0.32)
    pinch(hand, 1)
    take.cue('pick')
    HANDS.go(hand, above(src), dur=0.3)
    HANDS.go(hand, above(dst))
    HANDS.go(hand, at(dst), dur=0.32)
    pinch(hand, 0)
    take.cue(sound)
    HANDS.go(hand, above(dst), dur=0.28)
    HANDS.rest(hand)


def move_tile(take, pose, level_idx, slot, c, r, sound='place'):
    lvl = LEVELS[level_idx]
    carry(take, pose, tray_local(lvl, slot), cell_local(lvl, c, r), sound=sound)


def press(take, pose, level_idx, which, hand=None, sound='button'):
    lvl = LEVELS[level_idx]
    loc = button_local(lvl, which)
    hand = hand or ('left' if loc[0] < -0.03 else 'right')
    top = 0.022 if which == 'start' else 0.014
    fire('xr', 'set-hand-pose', payload={'device': f'hand-{hand}', 'poseId': 'point', 'duration': 0.3})
    HANDS.go(hand, world(pose, (loc[0], top + 0.05, loc[2])), anchor='index-tip')
    HANDS.go(hand, world(pose, (loc[0], top - 0.008, loc[2])), anchor='index-tip', dur=0.25)
    take.cue(sound)
    time.sleep(0.12)
    HANDS.go(hand, world(pose, (loc[0], top + 0.05, loc[2])), anchor='index-tip', dur=0.25)
    fire('xr', 'set-hand-pose', payload={'device': f'hand-{hand}', 'poseId': 'default', 'duration': 0.3})
    HANDS.rest(hand)


# ------------------------------------------------------------------- levels

def load_levels():
    """Pull grid sizes from src/puzzle.ts via the level checker's import."""
    code = (
        "import { LEVELS } from './src/puzzle.ts';"
        "console.log(JSON.stringify(LEVELS.map(l => ({cols: l.cols, rows: l.rows, tray: l.tray}))));"
    )
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                         capture_output=True, text=True).stdout
    return json.loads(out.strip().splitlines()[-1])


LEVELS = load_levels()


def tile_name(level_idx, slot):
    kind = LEVELS[level_idx]['tray'][slot]
    return f"Mirror {'Slash' if kind == '/' else 'Backslash'} {slot + 1}"


# Solver-proven solutions: (tray slot, c, r)
SOLUTIONS = {
    0: [(0, 1, 1)],
    1: [(1, 2, 0)],
    2: [(0, 2, 0), (1, 2, 3)],
    3: [(0, 3, 0), (1, 3, 3)],
    4: [(1, 2, 0), (3, 2, 2), (0, 4, 2)],
    5: [(0, 0, 0), (2, 0, 4), (1, 3, 0), (3, 3, 4)],
    6: [(0, 2, 1), (1, 2, 4), (2, 4, 3), (4, 4, 4)],
    7: [(0, 0, 2), (1, 0, 4), (2, 1, 0), (4, 1, 2), (3, 3, 0), (5, 3, 2)],
}


def solve(take, level_idx, pose, final_cue=True):
    sol = SOLUTIONS[level_idx]
    for i, (slot, c, r) in enumerate(sol):
        last = final_cue and i == len(sol) - 1
        move_tile(take, pose, level_idx, slot, c, r)
        if last:
            take.cues[-1]['name'] = 'place+solved'


# ------------------------------------------------------------------- scenes

def start_level(level_idx):
    """Fresh session at a level, Start poked off-camera."""
    fresh_session(level_idx)
    pose = board_pose()
    press(_NullTake(), pose, level_idx, 'start')
    time.sleep(1.0)
    return board_pose()


def s1():
    """Hook: enter XR seated at the desk; the board lands on the real desk."""
    write_cfg(scene='_', seconds=1, level=3)
    iw('browser', 'run', 'video/storage.mjs')
    iw('browser', 'reload')
    time.sleep(5)
    with Take('s1') as take:
        take.hold(0.6)
        enter_xr(seat=True)
        take.hold(2.5)


def s2():
    """Onboarding: poke Start, then solve level 1 with one pinch."""
    fresh_session(0)
    pose = board_pose()
    with Take('s2') as take:
        take.hold(1.2)
        press(take, pose, 0, 'start')
        take.hold(1.2)
        pose = board_pose()
        solve(take, 0, pose)
        take.hold(2.8)


def s3():
    """Choices: wrong mirror first, take it back, then the right one."""
    pose = start_level(1)
    lvl = LEVELS[1]
    with Take('s3') as take:
        take.hold(0.8)
        move_tile(take, pose, 1, 0, 2, 0)          # '/' sends the light away
        take.hold(1.2)
        away = (0.36, 0, lvl['rows'] / 2 * S + 0.02)
        carry(take, pose, cell_local(lvl, 2, 0), away, hand='right', sound='reject', valid=False)
        take.hold(0.8)
        move_tile(take, pose, 1, 1, 2, 0)          # '\' bends it home
        take.cues[-1]['name'] = 'place+solved'
        take.hold(2.8)


def s4():
    """Gems and a Perfect rating with the spark burst."""
    pose = start_level(3)
    with Take('s4') as take:
        take.hold(0.8)
        slot, c, r = SOLUTIONS[3][0]
        move_tile(take, pose, 3, slot, c, r)
        take.hold(0.4)
        slot, c, r = SOLUTIONS[3][1]
        move_tile(take, pose, 3, slot, c, r)
        take.cues[-1]['name'] = 'place+gem+solved'
        take.hold(3.2)


def s5():
    """Real room: slide the board along the desk by its handle."""
    pose = start_level(4)
    lvl = LEVELS[4]
    d = (lvl['rows'] + 2) * S
    h = (0, 0.012, -d / 2 - 0.045)
    with Take('s5') as take:
        take.hold(0.8)
        HANDS.go('right', world(pose, (h[0], h[1] + 0.06, h[2])))
        HANDS.go('right', world(pose, (h[0], h[1] + 0.004, h[2])), dur=0.3)
        pinch('right', 1)
        take.cue('pick')
        for dx, dur in ((0.16, 1.3), (-0.12, 1.6), (0.0, 1.0)):
            HANDS.go('right', world(pose, (h[0] + dx, h[1] + 0.004, h[2])), dur=dur)
        pinch('right', 0)
        take.cue('place')
        HANDS.rest('right')
        take.hold(1.0)


def montage(level_idx, scene):
    pose = start_level(level_idx)
    with Take(scene) as take:
        take.hold(0.5)
        solve(take, level_idx, pose)
        take.hold(2.4)


def s6():
    montage(4, 's6a')
    montage(5, 's6b')
    montage(6, 's6c')


def s7():
    """Finale: the six-mirror level and the 'mastered' message."""
    montage(7, 's7')


class _NullTake:
    cues = []

    def cue(self, *a, **k):
        pass


SCENES = {'s1': s1, 's2': s2, 's3': s3, 's4': s4, 's5': s5, 's6': s6, 's7': s7}

if __name__ == '__main__':
    for name in sys.argv[1:] or list(SCENES):
        print('scene', name)
        SCENES[name]()
