"""
Turn a recorded scene (variable-rate screencast frames) into a constant
30 fps H.264 clip, honouring each frame's real timestamp.

Usage: python3 video/clip.py s2 [s3 ...]  ->  video/out/clips/<scene>.mp4
Also writes <scene>.json with the clip's start time (epoch seconds) so cue
times can be mapped onto the clip.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = os.path.join(ROOT, 'video', 'frames')
CLIPS = os.path.join(ROOT, 'video', 'out', 'clips')


def make_clip(scene):
    d = os.path.join(FRAMES, scene)
    stamps = json.load(open(os.path.join(d, 'timestamps.json')))
    lst = os.path.join(d, 'concat.txt')
    with open(lst, 'w') as f:
        for i, s in enumerate(stamps):
            nxt = stamps[i + 1]['t'] if i + 1 < len(stamps) else s['t'] + 1 / 30
            f.write(f"file '{s['name']}'\nduration {max(nxt - s['t'], 0.001):.4f}\n")
        f.write(f"file '{stamps[-1]['name']}'\n")
    os.makedirs(CLIPS, exist_ok=True)
    out = os.path.join(CLIPS, f'{scene}.mp4')
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
        '-vf', 'fps=30,crop=1838:1034:41:46,scale=1920:1080:flags=lanczos,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out,
    ], check=True)
    meta = {'start': stamps[0]['t'], 'duration': stamps[-1]['t'] - stamps[0]['t']}
    json.dump(meta, open(os.path.join(CLIPS, f'{scene}.json'), 'w'))
    print(f'{scene}: {meta["duration"]:.1f}s -> {out}')


if __name__ == '__main__':
    for scene in sys.argv[1:]:
        make_clip(scene)
