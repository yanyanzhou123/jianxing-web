# -*- coding: utf-8 -*-
"""见行视频助手：本地检查并按需处理，再上传到运营后台。"""
from __future__ import print_function

import json
import os
import queue
import shutil
import subprocess
import sys
import threading

from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_NAME = "见行视频助手"
CREATE_NO_WINDOW = 0x08000000

H264 = set(["h264", "avc1", "avc"])
H265 = set(["hevc", "h265", "hev1", "hvc1"])
AAC = set(["aac", "mp4a"])


def app_base():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_tool(name):
    here = app_base()
    meipass = Path(getattr(sys, "_MEIPASS", here))
    candidates = [
        here / (name + ".exe"),
        here / "ffmpeg" / (name + ".exe"),
        meipass / (name + ".exe"),
        meipass / "ffmpeg" / (name + ".exe"),
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return shutil.which(name)


def run_json(cmd):
    flags = CREATE_NO_WINDOW if os.name == "nt" else 0
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, creationflags=flags)
    return json.loads(out.decode("utf-8", errors="replace"))


def has_faststart(path):
    try:
        with path.open("rb") as f:
            head = f.read(65536)
        if b"moov" in head:
            moov = head.find(b"moov")
            mdat = head.find(b"mdat")
            return mdat < 0 or moov < mdat
        return False
    except OSError:
        return None


def probe(path):
    ffprobe = find_tool("ffprobe")
    if not ffprobe:
        raise RuntimeError("未找到 ffprobe，请先完成组件下载。")
    data = run_json(
        [
            ffprobe,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    streams = data.get("streams") or []
    v = {}
    a = {}
    for s in streams:
        if s.get("codec_type") == "video" and not v:
            v = s
        if s.get("codec_type") == "audio" and not a:
            a = s
    fmt = data.get("format") or {}
    size = int(fmt.get("size") or path.stat().st_size)
    width = int(v.get("width") or 0)
    height = int(v.get("height") or 0)
    vcodec = str(v.get("codec_name") or "").lower()
    acodec = str(a.get("codec_name") or "").lower()
    duration = float(fmt.get("duration") or 0)
    bitrate = int(fmt.get("bit_rate") or 0)
    return {
        "path": path,
        "size": size,
        "width": width,
        "height": height,
        "vcodec": vcodec,
        "acodec": acodec,
        "duration": duration,
        "bitrate": bitrate,
        "faststart": has_faststart(path),
        "container": str(fmt.get("format_name") or ""),
    }


def decide(info):
    v = info["vcodec"]
    a = info["acodec"]
    h = info["height"]
    size_mb = info["size"] / (1024.0 * 1024.0)
    fast = info["faststart"]
    v_ok = v in H264
    a_ok = a in AAC
    hevc = v in H265
    huge = h >= 2160 or size_mb >= 900

    if v_ok and a_ok and fast:
        action = "ready"
        title = "已适合上传"
        why = "已是 H.264 + AAC，并且带 faststart，一般不用再处理。"
    elif v_ok and a_ok and not fast:
        action = "faststart"
        title = "只需 faststart"
        why = "编码已经合适，但索引在文件尾，开播会慢。只改封装，不转码、不压缩。"
    elif v_ok and not a_ok:
        action = "audio"
        title = "只转音轨"
        why = "画面已是 H.264，音轨不是 AAC。苹果/微信里容易没声音。画面原样拷贝，只转音频并加上 faststart。"
    else:
        action = "transcode"
        title = "需要转码"
        if hevc:
            why = "画面是 H.265，苹果和微信网页里经常播不了。转到 H.264 + AAC + faststart，分辨率尽量保持。"
        elif not v_ok:
            why = "画面编码是 %s，学员设备不一定能播。转到 H.264 + AAC + faststart。" % (v or "未知")
        else:
            why = "当前格式不适合直接上传，转到 H.264 + AAC + faststart。"

    compress_hint = ""
    if huge and action != "ready":
        compress_hint = "文件很大或达到 4K，如需再缩小体积，可勾选「同时压到 720p」（非必须）。"

    return {
        "action": action,
        "title": title,
        "why": why,
        "compress_hint": compress_hint,
    }


def out_path(src):
    return src.with_name(src.stem + "-见行上传.mp4")


def ffmpeg_cmd(info, action, compress):
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，请先完成组件下载。")
    src = str(info["path"])
    dest = str(out_path(info["path"]))
    common_end = ["-movflags", "+faststart", "-y", dest]
    if action == "faststart" and not compress:
        return [ffmpeg, "-i", src, "-c", "copy", ] + common_end
    if action == "audio" and not compress:
        return [
            ffmpeg, "-i", src,
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        ] + common_end
    args = [ffmpeg, "-i", src]
    if compress:
        args += ["-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "medium", "-crf", "26"]
    elif action == "transcode":
        args += ["-c:v", "libx264", "-preset", "medium", "-crf", "23"]
    else:
        args += ["-c:v", "copy"]
    args += ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"] + common_end
    return args


def ensure_ffmpeg(log):
    if find_tool("ffmpeg") and find_tool("ffprobe"):
        return
    raise RuntimeError("未找到已打包的 ffmpeg。请使用完整压缩包（内含 ffmpeg.exe、ffprobe.exe）解压后再打开。")


class App(tk.Tk):
    def __init__(self):
        tk.Tk.__init__(self)
        self.title(APP_NAME)
        self.geometry("720x560")
        self.minsize(640, 500)
        self.info = None
        self.plan = None
        self.q = queue.Queue()
        self._build()
        self.after(200, self._poll)

    def _build(self):
        ttk.Label(self, text="见行视频助手", font=("Microsoft YaHei UI", 16, "bold")).pack(anchor="w", padx=14, pady=6)
        ttk.Label(
            self,
            text="先在电脑上检查并处理好，再上传到运营后台。能不转码就不转码，能不压缩就不压缩。目标：开播快，苹果/微信能看有声。",
            wraplength=680,
        ).pack(anchor="w", padx=14)

        row = ttk.Frame(self)
        row.pack(fill="x", padx=14, pady=8)
        ttk.Button(row, text="选择视频…", command=self.pick).pack(side="left")
        self.file_var = tk.StringVar(value="尚未选择文件")
        ttk.Label(row, textvariable=self.file_var).pack(side="left", padx=10)

        self.report = tk.Text(self, height=12, wrap="word", font=("Microsoft YaHei UI", 10))
        self.report.pack(fill="both", expand=True, padx=14, pady=6)
        self.report.configure(state="disabled")

        self.compress_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(self, text="同时压到 720p（非必须，文件很大时再勾）", variable=self.compress_var).pack(anchor="w", padx=14)

        act = ttk.Frame(self)
        act.pack(fill="x", padx=14, pady=8)
        self.go_btn = ttk.Button(act, text="按建议处理", command=self.process, state="disabled")
        self.go_btn.pack(side="left")
        ttk.Button(act, text="打开输出文件夹", command=self.open_out).pack(side="left", padx=8)

        self.progress = ttk.Progressbar(self, mode="indeterminate")
        self.progress.pack(fill="x", padx=14, pady=(0, 6))
        self.status = tk.StringVar(value="请选择视频。")
        ttk.Label(self, textvariable=self.status).pack(anchor="w", padx=14, pady=(0, 12))

    def set_report(self, text):
        self.report.configure(state="normal")
        self.report.delete("1.0", "end")
        self.report.insert("1.0", text)
        self.report.configure(state="disabled")

    def pick(self):
        path = filedialog.askopenfilename(
            title="选择视频",
            filetypes=[("视频", "*.mp4 *.mov *.m4v *.mkv *.avi *.wmv *.ts"), ("全部", "*.*")],
        )
        if not path:
            return
        self.file_var.set(path)
        self.go_btn.configure(state="disabled")
        self.status.set("正在检查…")
        threading.Thread(target=self._analyze, args=(Path(path),), daemon=True).start()

    def _analyze(self, path):
        try:
            def log(m):
                self.q.put(("status", m))
            ensure_ffmpeg(log)
            info = probe(path)
            plan = decide(info)
            self.q.put(("result", info, plan))
        except Exception as e:
            self.q.put(("error", str(e)))

    def _fmt_info(self, info, plan):
        mb = info["size"] / (1024.0 * 1024.0)
        if info["width"]:
            res = "%s×%s" % (info["width"], info["height"])
        else:
            res = "未知"
        fs_map = {True: "已有（开播较快）", False: "没有（开播会慢）", None: "未知"}
        fs = fs_map.get(info["faststart"], "未知")
        lines = [
            "文件：%s" % info["path"].name,
            "体积：%.1f MB" % mb,
            "画面：%s　%s" % (info["vcodec"] or "未知", res),
            "音轨：%s" % (info["acodec"] or "未知"),
            "faststart：%s" % fs,
            "",
            "建议：%s" % plan["title"],
            plan["why"],
        ]
        if plan["compress_hint"]:
            lines += ["", plan["compress_hint"]]
        if plan["action"] == "ready":
            lines += ["", "可直接上传这个文件。"]
        else:
            lines += ["", "处理后将生成：%s（不覆盖原片）" % out_path(info["path"]).name]
        return "\n".join(lines)

    def process(self):
        if not self.info or not self.plan:
            return
        if self.plan["action"] == "ready" and not self.compress_var.get():
            messagebox.showinfo(APP_NAME, "这个文件已经适合上传，不必再处理。")
            return
        dest = out_path(self.info["path"])
        if dest.exists() and not messagebox.askyesno(APP_NAME, "已存在 %s，要覆盖吗？" % dest.name):
            return
        self.go_btn.configure(state="disabled")
        self.progress.start(12)
        compress = bool(self.compress_var.get())
        threading.Thread(target=self._run, args=(compress,), daemon=True).start()

    def _run(self, compress):
        try:
            action = self.plan["action"]
            if action == "ready":
                action = "transcode" if compress else "faststart"
            cmd = ffmpeg_cmd(self.info, action, compress)
            self.q.put(("status", "正在处理，请稍候（只改封装会很快，转码会久一些）…"))
            flags = CREATE_NO_WINDOW if os.name == "nt" else 0
            subprocess.check_call(cmd, creationflags=flags)
            self.q.put(("done", str(out_path(self.info["path"]))))
        except Exception as e:
            self.q.put(("error", str(e)))

    def open_out(self):
        if self.info:
            os.startfile(str(self.info["path"].parent))

    def _poll(self):
        try:
            while True:
                item = self.q.get_nowait()
                kind = item[0]
                if kind == "status":
                    self.status.set(item[1])
                elif kind == "result":
                    self.info, self.plan = item[1], item[2]
                    self.set_report(self._fmt_info(self.info, self.plan))
                    self.compress_var.set(False)
                    if self.plan["action"] == "ready":
                        self.go_btn.configure(state="disabled")
                        self.status.set("已适合上传。")
                    else:
                        self.go_btn.configure(state="normal")
                        self.status.set("建议：%s。确认后点「按建议处理」。" % self.plan["title"])
                elif kind == "done":
                    self.progress.stop()
                    self.go_btn.configure(state="normal")
                    self.status.set("完成：%s" % item[1])
                    messagebox.showinfo(APP_NAME, "已生成：\n%s\n\n请把这个新文件上传到运营后台。" % item[1])
                elif kind == "error":
                    self.progress.stop()
                    self.go_btn.configure(state="normal")
                    self.status.set("出错了")
                    messagebox.showerror(APP_NAME, item[1])
        except queue.Empty:
            pass
        self.after(200, self._poll)


def main():
    App().mainloop()


if __name__ == "__main__":
    main()
