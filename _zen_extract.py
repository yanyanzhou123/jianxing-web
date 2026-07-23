# -*- coding: utf-8 -*-
from pathlib import Path
import re

html = Path(r"D:\小程序\jianxing\zen-lesson.html").read_text(encoding="utf-8")
out = Path(r"D:\小程序\jianxing\_zen_analysis")
out.mkdir(exist_ok=True)

# scripts/css
scripts = sorted(set(re.findall(r'src="(/_next/static/chunks/[^"]+)"', html)))
css = sorted(set(re.findall(r'href="(/_next/static/css/[^"]+)"', html)))
(out / "assets.txt").write_text("\n".join(["CSS:"] + css + ["", "SCRIPTS:"] + scripts), encoding="utf-8")

patterns = ["音频", "文字", "问答", "视频", "相关资料", "上一课", "下一课", "视频下载", "Mui-selected", "tab=", "writing-mode", "vertical"]
chunks = []
for p in patterns:
    chunks.append(f"\n===== {p} =====\n")
    for i, m in enumerate(re.finditer(re.escape(p), html)):
        if i >= 6:
            break
        start = max(0, m.start() - 220)
        end = min(len(html), m.end() + 220)
        chunks.append(html[start:end])
        chunks.append("\n---\n")
(out / "snippets.txt").write_text("".join(chunks), encoding="utf-8")

# Extract sidebar / tab related HTML blocks by class names of interest
for cls in [
    "mui-1fhjpi2",
    "mui-jvty1w",
    "mui-11ivq5v",
    "mui-t9jx03",
    "mui-1w4dqr4",
    "mui-722buq",
    "mui-1x0aqrs",
    "mui-1eowid2",
]:
    idx = html.find(cls)
    if idx >= 0:
        start = max(0, idx - 100)
        end = min(len(html), idx + 800)
        (out / f"class_{cls}.txt").write_text(html[start:end], encoding="utf-8")

# Pull the S:4 hidden stream which seemed to have sidebar
m = re.search(r'<div hidden id="S:4">(.*?)</div><script>\$RC\("B:4"', html, re.S)
if m:
    (out / "sidebar_stream.html").write_text(m.group(1)[:20000], encoding="utf-8")

# Also find main content areas with 三个差别
idx = html.find("三个差别")
if idx >= 0:
    (out / "around_title.html").write_text(html[max(0, idx - 1500) : idx + 3000], encoding="utf-8")

print("scripts", len(scripts))
print("css", css)
print("wrote", out)
