# -*- coding: utf-8 -*-
from __future__ import print_function
import json
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: patch_catalog.py catalog.json lesson-slug sd-key")

path, slug, sd = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

found = False
for mod in data.get("modules") or []:
    for ch in mod.get("chapters") or []:
        for les in ch.get("lessons") or []:
            if les.get("slug") == slug:
                les["videoPathSd"] = sd
                found = True

if not found:
    raise SystemExit("lesson not found: " + slug)

data["rev"] = int(data.get("rev") or 0) + 1
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("patched %s -> %s rev=%s" % (slug, sd, data["rev"]))
