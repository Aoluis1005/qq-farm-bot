#!/usr/bin/env python3
# 从游戏 CDN 切出新种子图标：manifest.json -> .astc -> 解码 -> 按 rect 切图 -> PNG
import json, re, os, subprocess, sys
from urllib.parse import quote
import urllib.request
from PIL import Image

MANIFEST = '/root/uploads/1785466427702561811-manifest.json'
OUT = '/root/.codebuddy/artifact/qq-farm-bot/core/src/gameConfig/seed_images_named'
CDN = 'https://cdn-resource.nqf.qq.com/'
TMP = '/tmp/astc_atlases'

os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

m = json.load(open(MANIFEST))
imgs = m['images']

# 1. 收集要切的 Crop_X_Seed 精灵（不在 Plant.json 且无本地 PNG）
plants = json.load(open('/root/.codebuddy/artifact/qq-farm-bot/core/src/gameConfig/Plant.json'))
plant_ids = set(p.get('seed_id') for p in plants)
have = set()
for f in os.listdir(OUT):
    mm = re.match(r'^(\d+)_', f)
    if mm: have.add(int(mm.group(1)))

targets = []
for it in imgs:
    s = it.get('sprite_name', '')
    mm = re.match(r'^Crop_(\d+)_Seed$', s)
    if not mm: continue
    crop = int(mm.group(1))
    sid = 20000 + crop
    if sid in plant_ids or sid in have: continue
    targets.append((crop, sid, it))

print(f'需切图的新种子: {len(targets)} 个')

# 2. 按 source 分组，避免重复下载图集
by_src = {}
for crop, sid, it in targets:
    by_src.setdefault(it['source'], []).append((crop, sid, it))

def fetch_decode(src):
    url = CDN + quote(src)
    path = os.path.join(TMP, src.replace('/', '_'))
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
    png = path + '.png'
    if not os.path.exists(png):
        subprocess.run(['astcenc', '-dl', path, png], check=True,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return png

ok = 0
for src, items in by_src.items():
    atlas = fetch_decode(src)
    base = Image.open(atlas).convert('RGBA')
    for crop, sid, it in items:
        rect = it['rect']
        x, y, w, h = rect['x'], rect['y'], rect['width'], rect['height']
        sprite = base.crop((x, y, x + w, y + h))
        out_name = f'{sid}_Crop_{crop}_Seed.png'
        sprite.save(os.path.join(OUT, out_name))
        ok += 1
        print(f'  ✓ {out_name}  ({w}x{h})')

print(f'完成，共切出 {ok} 个新种子图标')
