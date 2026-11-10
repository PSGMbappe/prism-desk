"""
Edit the Prism Desk demo video.

Inputs: video/out/clips/<scene>.mp4 (+ .json start time) from clip.py and
video/frames/<scene>/cues.json from director.py.
Output: video/out/prism-desk-demo.mp4 (1080p30, H.264 + AAC).

Everything here is generated: title cards and captions (Pillow), an original
ambient score and the game's sound effects (numpy). No third-party media.
"""
import json
import math
import os
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'video', 'out')
CLIPS = os.path.join(OUT, 'clips')
WORK = os.path.join(OUT, 'work')
FRAMES = os.path.join(ROOT, 'video', 'frames')
W, H, FPS, SR = 1920, 1080, 30, 48000
FONT = '/System/Library/Fonts/Avenir Next.ttc'
BOLD, DEMI, MEDIUM, REGULAR = 0, 2, 5, 7
CYAN, GOLD, MINT, INK = (127, 232, 255), (255, 200, 87), (61, 220, 151), (232, 238, 248)
URL = 'psgmbappe.github.io/prism-desk'

# ------------------------------------------------------------------ timeline
# Each segment: a recorded scene (or a card), trimmed and optionally sped up.
# Caption times are seconds in the segment's *output* time.
TIMELINE = [
    {'card': 'intro', 'dur': 3.6},
    {'scene': 's1', 'trim': (1.4, 8.0), 'speed': 1.0, 'captions': [
        ('Your desk is now a light lab.', 'Prism Desk finds your real table and sets up on it.', 0.6, 99)]},
    {'scene': 's2', 'trim': (0.6, 0.0), 'speed': 1.0, 'captions': [
        ('Poke Start. Pinch a mirror.', 'Hands only. No controllers, no standing up.', 0.3, 7.0),
        ('Drop it on the grid. Bend the light.', 'A ring shows exactly where it will land.', 7.4, 99)]},
    {'scene': 's3', 'trim': (0.4, 0.0), 'speed': 1.25, 'captions': [
        ('Mirrors lean two ways.', 'Wrong one? Pinch it off the board and try again.', 0.3, 99)]},
    {'scene': 's4', 'trim': (0.4, 0.0), 'speed': 1.15, 'captions': [
        ('Light every gem on the way.', 'Use the fewest mirrors possible for a Perfect ★', 0.3, 99)]},
    {'scene': 's5', 'trim': (0.4, 0.0), 'speed': 1.2, 'captions': [
        ('Fits any desk.', 'Uses the Quest room scan, and slides wherever you like.', 0.3, 99)]},
    {'scene': 's6a', 'trim': (0.3, 0.6), 'speed': 2.2, 'captions': [
        ('8 hand-made puzzles.', 'Each one proven solvable by a brute-force solver.', 0.2, 99)]},
    {'scene': 's6b', 'trim': (0.3, 0.6), 'speed': 2.2, 'captions': [
        ('Seated. A puzzle per bus stop.', 'Every level fits in a minute or two, within arm’s reach.', 0.2, 99)]},
    {'scene': 's6c', 'trim': (0.3, 0.6), 'speed': 2.2, 'captions': [
        ('Built for hands.', 'Grabs from your true pinch point, read from WebXR hand joints.', 0.2, 99)]},
    {'scene': 's7', 'trim': (0.3, 0.0), 'speed': 1.9, 'captions': [
        ('WebXR + Meta Immersive Web SDK.', 'No install: just open a link in the Quest browser.', 0.2, 99)]},
    {'card': 'outro', 'dur': 6.0},
]

FADE = 0.3  # dip-to-black at every cut


# ------------------------------------------------------------------ graphics

def font(size, idx):
    return ImageFont.truetype(FONT, size, index=idx)


def rounded_panel(draw, box, radius, fill, outline=None, width=3):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def caption_png(title, sub, path):
    """Lower-third caption on a transparent 1920x1080 canvas."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ft, fs = font(54, DEMI), font(32, MEDIUM)
    tw = d.textlength(title, font=ft)
    sw = d.textlength(sub, font=fs) if sub else 0
    pw = int(max(tw, sw) + 100)
    ph = 150 if sub else 96
    x0, y0 = (W - pw) // 2, H - ph - 70
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0 + 4, y0 + 8, x0 + pw + 4, y0 + ph + 8), 28, fill=(0, 0, 0, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    rounded_panel(d, (x0, y0, x0 + pw, y0 + ph), 28, (10, 14, 24, 215), (*CYAN, 120), 3)
    d.text((W / 2, y0 + (46 if sub else ph / 2)), title, font=ft, fill=CYAN, anchor='mm')
    if sub:
        d.text((W / 2, y0 + 110), sub, font=fs, fill=INK, anchor='mm')
    img.save(path)


def beam_backdrop():
    """Dark backdrop: a beam enters low, bends off a mirror up the right edge."""
    img = Image.new('RGB', (W, H), (11, 15, 26))
    d = ImageDraw.Draw(img)
    # faint grid around the bend
    for cx in range(4):
        for cy in range(6):
            x, y = 1500 + cx * 100, 330 + cy * 100
            d.rounded_rectangle((x, y, x + 86, y + 86), 10, outline=(30, 40, 64), width=3)
    pts = [(-40, 935), (1700, 935), (1700, 150)]
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    for width, col in ((70, (90, 60, 10)), (28, (255, 170, 60)), (9, (255, 236, 170))):
        g.line(pts, fill=col, width=width, joint='curve')
    glow = glow.filter(ImageFilter.GaussianBlur(20))
    img = Image.fromarray(np.clip(np.asarray(img, dtype=np.int16) + np.asarray(glow, dtype=np.int16), 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    d.line(pts, fill=(255, 240, 200), width=6, joint='curve')
    d.line((1665, 970, 1735, 900), fill=(190, 240, 255), width=12)   # mirror
    d.ellipse((1672, 112, 1728, 168), outline=MINT, width=9)          # receiver
    d.rounded_rectangle((40, 905, 110, 965), 10, fill=(255, 200, 87))  # emitter
    return img


def card_png(kind, path):
    img = beam_backdrop()
    shade = Image.new('RGBA', (W, H), (8, 10, 18, 120))
    img = Image.alpha_composite(img.convert('RGBA'), shade)
    d = ImageDraw.Draw(img)
    if kind == 'intro':
        d.text((W / 2, 430), 'PRISM DESK', font=font(150, BOLD), fill=GOLD, anchor='mm')
        d.text((W / 2, 560), 'A hands-only light puzzle for your real desk', font=font(52, MEDIUM), fill=INK, anchor='mm')
        d.text((W / 2, 650), 'Mixed reality · Meta Quest · WebXR', font=font(36, REGULAR), fill=CYAN, anchor='mm')
    else:
        d.text((W / 2, 330), 'PRISM DESK', font=font(120, BOLD), fill=GOLD, anchor='mm')
        d.text((W / 2, 455), 'Play it now in the Meta Quest browser', font=font(48, MEDIUM), fill=INK, anchor='mm')
        rounded_panel(d, (W / 2 - 560, 515, W / 2 + 560, 615), 30, (10, 14, 24, 230), (*CYAN, 200), 4)
        d.text((W / 2, 565), URL, font=font(56, DEMI), fill=CYAN, anchor='mm')
        d.text((W / 2, 700), 'Coming next: a daily puzzle, a level editor, and shared desks for two',
               font=font(36, REGULAR), fill=INK, anchor='mm')
        d.text((W / 2, 760), 'Built with Meta’s Immersive Web SDK', font=font(32, REGULAR), fill=(160, 170, 190), anchor='mm')
    img.convert('RGB').save(path)


# --------------------------------------------------------------------- video

def run(cmd):
    subprocess.run(cmd, check=True)


def render_card(seg, i):
    png = os.path.join(WORK, f'card_{seg["card"]}.png')
    card_png(seg['card'], png)
    out = os.path.join(WORK, f'seg{i:02d}.mp4')
    d = seg['dur']
    run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-t', f'{d}', '-i', png,
         '-vf', f'fps={FPS},format=yuv420p,zoompan=z=\'min(1.0+on*0.0006,1.04)\':d=1:s={W}x{H}:fps={FPS},'
                f'fade=t=in:st=0:d={FADE},fade=t=out:st={d - FADE}:d={FADE}',
         '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-r', str(FPS), out])
    return out, d


def render_scene(seg, i):
    scene = seg['scene']
    src = os.path.join(CLIPS, f'{scene}.mp4')
    meta = json.load(open(os.path.join(CLIPS, f'{scene}.json')))
    t_in, t_out = seg['trim']
    raw = meta['duration'] - t_in - t_out
    dur = raw / seg['speed']
    inputs = ['-ss', f'{t_in}', '-t', f'{raw}', '-i', src]
    filt = [f'[0:v]setpts=(PTS-STARTPTS)/{seg["speed"]},fps={FPS}[v0]']
    last = 'v0'
    for k, (title, sub, a, b) in enumerate(seg.get('captions', [])):
        b = min(b, dur - 0.2)
        png = os.path.join(WORK, f'cap{i:02d}_{k}.png')
        caption_png(title, sub, png)
        inputs += ['-loop', '1', '-t', f'{dur}', '-i', png]
        filt.append(f'[{k + 1}:v]format=rgba,fade=t=in:st={a}:d=0.35:alpha=1,'
                    f'fade=t=out:st={b - 0.35}:d=0.35:alpha=1[c{k}]')
        filt.append(f'[{last}][c{k}]overlay=0:0[v{k + 1}]')
        last = f'v{k + 1}'
    filt.append(f'[{last}]fade=t=in:st=0:d={FADE},fade=t=out:st={dur - FADE}:d={FADE},format=yuv420p[out]')
    out = os.path.join(WORK, f'seg{i:02d}.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filt),
         '-map', '[out]', '-t', f'{dur}', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
         '-r', str(FPS), out])
    # Map recorded cues into segment time.
    cues = []
    cue_file = os.path.join(FRAMES, scene, 'cues.json')
    if os.path.exists(cue_file):
        for c in json.load(open(cue_file)):
            t = (c['t'] - meta['start'] - t_in) / seg['speed']
            if 0 <= t < dur:
                cues.append((c['name'], t))
    return out, dur, cues


# --------------------------------------------------------------------- audio

def env(n, attack, release):
    e = np.ones(n)
    a = min(n, max(1, int(attack * SR)))
    r = min(n - a if n > a else n, max(1, int(release * SR)))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def osc(kind, freq, dur):
    t = np.arange(int(dur * SR)) / SR
    ph = 2 * np.pi * freq * t
    if kind == 'sine':
        return np.sin(ph)
    if kind == 'triangle':
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == 'square':
        return np.sign(np.sin(ph)) * 0.6
    return 2 * (t * freq - np.floor(0.5 + t * freq)) * 0.6  # saw


def tone(buf, at, freq, dur, kind='sine', gain=0.12):
    s = osc(kind, freq, dur) * gain
    s *= np.exp(-np.linspace(0, 5, len(s))) * env(len(s), 0.008, 0.02)
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(s))
    buf[i:j, 0] += s[: j - i]
    buf[i:j, 1] += s[: j - i]


def sfx(buf, name, at):
    """Same palette as src/sfx.ts."""
    for part in name.split('+'):
        if part == 'pick':
            tone(buf, at, 660, 0.12, 'triangle', 0.16)
        elif part == 'place':
            tone(buf, at, 520, 0.09, 'square', 0.06)
            tone(buf, at + 0.03, 880, 0.16, 'triangle', 0.14)
        elif part == 'reject':
            tone(buf, at, 180, 0.25, 'saw', 0.08)
        elif part == 'gem':
            tone(buf, at + 0.05, 1320, 0.4, 'sine', 0.12)
        elif part == 'button':
            tone(buf, at, 440, 0.1, 'triangle', 0.14)
        elif part == 'solved':
            for k, f in enumerate((523.25, 659.25, 783.99, 1046.5)):
                tone(buf, at + 0.12 + k * 0.09, f, 0.6, 'sine', 0.15)


def score(total):
    """Original ambient score: soft pads plus a gentle plucked arpeggio."""
    n = int(total * SR)
    buf = np.zeros((n, 2))
    bpm = 84
    beat = 60 / bpm
    # A minor -> F -> C -> G, two bars each
    chords = [(57, 60, 64, 69), (53, 57, 60, 65), (48, 55, 60, 64), (55, 59, 62, 67)]
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    bar = 4 * beat
    t = 0.0
    k = 0
    rng = np.random.default_rng(7)
    while t < total:
        ch = chords[(k // 2) % 4]
        dur = bar
        m = int(min(dur + 1.5, total - t) * SR)
        if m <= 0:
            break
        tt = np.arange(m) / SR
        pad = np.zeros(m)
        for note in ch:
            for det in (-0.12, 0.12):
                pad += np.sin(2 * np.pi * hz(note) * (1 + det / 100) * tt)
        pad *= 0.012 * env(m, 0.8, 1.4)
        i = int(t * SR)
        j = min(n, i + m)
        buf[i:j, 0] += pad[: j - i]
        buf[i:j, 1] += pad[: j - i] * 0.95
        # plucked arpeggio, eighth notes, an octave up
        for s in range(8):
            note = ch[[0, 1, 2, 3, 2, 1, 3, 2][s]] + 12
            at = t + s * beat / 2
            if at >= total:
                break
            pl = osc('triangle', hz(note), 0.5) * np.exp(-np.linspace(0, 7, int(0.5 * SR))) * 0.018
            a = int(at * SR)
            b = min(n, a + len(pl))
            pan = 0.5 + 0.3 * math.sin(s)
            buf[a:b, 0] += pl[: b - a] * (1 - pan) * 2 * (0.8 + 0.4 * rng.random())
            buf[a:b, 1] += pl[: b - a] * pan * 2 * (0.8 + 0.4 * rng.random())
        # soft low pulse on each beat
        for s in range(4):
            at = t + s * beat
            if at < total:
                tone(buf, at, hz(ch[0] - 12), 0.4, 'sine', 0.035)
        t += dur
        k += 1
    fade = int(2.5 * SR)
    buf[:int(1.2 * SR)] *= np.linspace(0, 1, int(1.2 * SR))[:, None]
    buf[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return buf


def write_wav(path, buf):
    peak = np.max(np.abs(buf)) or 1
    data = (np.clip(buf / max(peak, 1.0) * 0.89, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ---------------------------------------------------------------------- main

def main():
    os.makedirs(WORK, exist_ok=True)
    segs, cues, t = [], [], 0.0
    audio_only = '--audio-only' in os.sys.argv
    for i, seg in enumerate(TIMELINE):
        if audio_only:
            path = os.path.join(WORK, f'seg{i:02d}.mp4')
            dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                        '-of', 'csv=p=0', path], capture_output=True, text=True).stdout)
            seg_cues = []
            if 'scene' in seg:
                meta = json.load(open(os.path.join(CLIPS, f'{seg["scene"]}.json')))
                for c in json.load(open(os.path.join(FRAMES, seg['scene'], 'cues.json'))):
                    at = (c['t'] - meta['start'] - seg['trim'][0]) / seg['speed']
                    if 0 <= at < dur:
                        seg_cues.append((c['name'], at))
        elif 'card' in seg:
            path, dur = render_card(seg, i)
            seg_cues = []
        else:
            path, dur, seg_cues = render_scene(seg, i)
        segs.append(path)
        cues += [(name, t + at) for name, at in seg_cues]
        print(f'{i:02d} {seg.get("scene", seg.get("card")):6s} {t:6.1f}s +{dur:5.1f}s  cues={len(seg_cues)}')
        t += dur
    total = t

    lst = os.path.join(WORK, 'segments.txt')
    with open(lst, 'w') as f:
        for p in segs:
            f.write(f"file '{p}'\n")
    silent = os.path.join(WORK, 'video.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent])

    buf = score(total)
    for name, at in cues:
        sfx(buf, name, at)
    wav = os.path.join(WORK, 'audio.wav')
    write_wav(wav, buf)

    final = os.path.join(OUT, 'prism-desk-demo.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a',
         '-c:v', 'copy', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', str(SR),
         '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final])
    print(f'total {total:.1f}s -> {final}')


if __name__ == '__main__':
    main()
