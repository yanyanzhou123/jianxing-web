# -*- coding: utf-8 -*-
from pathlib import Path
import re

base = Path(r"D:\小程序\jianxing\_zen_analysis")
out = []

def extract_pushes(html):
    pushes = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)', html):
        s = m.group(1)
        try:
            s2 = bytes(s, 'utf-8').decode('unicode_escape')
        except Exception:
            s2 = s.encode('utf-8').decode('unicode_escape')
        s2 = s2.replace('\\"', '"')
        pushes.append(s2)
    return pushes

for name in ["lesson-video.html", "lesson-audio.html", "lesson-article.html"]:
    html = (base / name).read_text(encoding="utf-8")
    pushes = extract_pushes(html)
    out.append("\n######## %s pushes=%d ########\n" % (name, len(pushes)))
    # find main content panel sx
    keys = [
        "videoList", "audioList", "article", "tab=audio", "tab=article",
        "lineHeight", "whiteSpace", "pre-wrap", "markdown", "htmlContent",
        "backgroundColor\":\"white", "pl\":{\"lg\":14", "fixedIndex",
        "showTitle", "AudioPlayer", "Article", "textContent", "contentHtml",
        "fontSize\":{\"lg\":18", "fontSize\":{\"lg\":16", "aspect-ratio",
        "相关资料", "selected\":true", "mp3", "poster"
    ]
    for i, p in enumerate(pushes):
        hit = [k for k in keys if k in p]
        if hit:
            out.append("--- push %d hits=%s ---\n" % (i, ",".join(hit[:8])))
            # write truncated but prefer content around hits
            if len(p) < 6000:
                out.append(p)
            else:
                for k in hit[:3]:
                    idx = p.find(k)
                    out.append(p[max(0, idx-400):idx+1200])
                    out.append("\n...\n")
            out.append("\n\n")

# Also dump emotion CSS for article-specific classes from article html
html = (base / "lesson-article.html").read_text(encoding="utf-8")
# Find styles mentioning line-height >= 1.8 or 32px etc in article page
for m in re.finditer(r"\.mui-[a-z0-9]+\{[^}]+\}", html):
    r = m.group(0)
    if any(x in r for x in ["line-height:1.8", "line-height:2", "line-height:1.75", "white-space:pre", "text-indent", "max-width:720", "max-width:800", "max-width:680"]):
        out.append(r + "\n")

# Search for article body text sample
for needle in ["外教和佛教", "学佛三个目标", "出离心", "概述", "标签"]:
    idx = html.find(needle)
    if idx >= 0:
        out.append("\nNEEDLE %s:\n%s\n" % (needle, html[max(0,idx-300):idx+500]))

(base / "content_panels.txt").write_text("".join(out), encoding="utf-8")
print("wrote", len(out), "chunks")
