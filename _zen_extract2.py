# -*- coding: utf-8 -*-
from pathlib import Path
import re, json

base = Path(r"D:\小程序\jianxing\_zen_analysis")
html = Path(r"D:\小程序\jianxing\zen-lesson.html").read_text(encoding="utf-8")

# Extract RSC payloads that mention tab/sidebar layout
keys = [
    "相关资料", "tab=audio", "tab=article", "wave_icon", "char_icon",
    "flexDirection", "lg\":80", "borderRadius", "PingFang", "lineHeight",
    "maxWidth", "article", "video", "Audio", "Video", "player",
]
out = []
for push in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', html):
    s = push.encode('utf-8').decode('unicode_escape') if '\\u' in push else push
    s = s.replace('\\"', '"').replace('\\n', '\n')
    if any(k in s for k in keys):
        out.append(s[:4000])
        out.append('\n' + '='*60 + '\n')
(base / 'rsc_payloads.txt').write_text('\n'.join(out), encoding='utf-8')

# Extract emotion CSS related to sidebar classes
classes = [
    '1fhjpi2','11ivq5v','t9jx03','jvty1w','1w4dqr4','4mgw0i','115l41f',
    '1c0355u','1xmd2pr','4wrfah','cd5vl3','1uawhqr','u0rq4q','zgespb',
    '1x0aqrs','722buq','1imrebr','18zb7o8','y9tvyc'
]
css_blocks = []
for cls in classes:
    for m in re.finditer(r'\.mui-' + cls + r'\{[^}]+\}', html):
        css_blocks.append(m.group(0))
    # also media queries
    for m in re.finditer(r'@media[^{]+\{[^}]*\.mui-' + cls + r'\{[^}]+\}[^}]*\}', html):
        css_blocks.append(m.group(0)[:500])
(base / 'sidebar_css.txt').write_text('\n'.join(dict.fromkeys(css_blocks)), encoding='utf-8')
print('rsc chunks', len(out)//2)
print('css rules', len(css_blocks))
