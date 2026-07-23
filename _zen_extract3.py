# -*- coding: utf-8 -*-
from pathlib import Path
import re

base = Path(r"D:\小程序\jianxing\_zen_analysis")

def analyze(name):
    html = (base / name).read_text(encoding="utf-8")
    print("\n====", name, "====")
    # Title / mode
    for pat in [r'<title>([^<]+)</title>', r'tab=(audio|article|video)']:
        m = re.search(pat, html)
        if m:
            print("match", pat, "->", m.group(1) if m.lastindex else m.group(0)[:80])

    # Selected button contexts
    for m in re.finditer(r'Mui-selected[^<]{0,200}.{0,400}?(视频|音频|文字|问答)', html):
        print("SELECTED near", m.group(1))
    for m in re.finditer(r'(视频|音频|文字|问答).{0,80}?Mui-selected', html):
        print("label then selected", m.group(1))

    # RSC selected:true
    for m in re.finditer(r'"selected":(true|false).{0,200}?"children":"(视频|音频|文字|问答)"', html):
        print("RSC selected", m.group(2), m.group(1))
    for m in re.finditer(r'"children":"(视频|音频|文字|问答)".{0,300}?"selected":(true|false)', html):
        print("RSC children-sel", m.group(1), m.group(2))

    # Media elements
    for tag in ["audio", "video", "iframe", "source"]:
        print(tag, "count", len(re.findall(r"<" + tag + r"[\s>]", html, re.I)))
    for k in ["xgplayer", "Artplayer", "plyr", "hls", "m3u8", "mp4", "mp3", "cloudfront", "aliyuncs", "player"]:
        c = html.lower().count(k.lower())
        if c:
            print("kw", k, c)

    # Article prose styles in emotion CSS
    interesting = []
    for cls in re.findall(r"\.mui-([a-z0-9]+)\{[^}]{0,300}\}", html):
        pass
    # Find font-size / line-height near article content
    for m in re.finditer(r"\.mui-[a-z0-9]+\{[^}]*(?:line-height|font-size|max-width|letter-spacing)[^}]*\}", html):
        rule = m.group(0)
        if any(x in rule for x in ["1.8", "1.75", "28px", "18px", "20px", "22px", "700", "PingFang", "Noto"]):
            interesting.append(rule[:300])
    print("interesting typography rules", len(interesting))
    for r in interesting[:25]:
        print(r)
        print("---")

    # Extract main visible structure snippets around 三个差别 heading
    idx = html.find("三个差别")
    if idx > 0:
        print("around title snippet:")
        print(html[idx-200:idx+500][:700])

for n in ["lesson-video.html", "lesson-audio.html", "lesson-article.html"]:
    analyze(n)

# Read sidebar css file
print("\n==== sidebar_css ====")
print((base/"sidebar_css.txt").read_text(encoding="utf-8")[:8000])
print("\n==== rsc sample ====")
print((base/"rsc_payloads.txt").read_text(encoding="utf-8")[:12000])
