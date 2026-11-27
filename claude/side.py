#!/usr/bin/env python3
"""Claude Code side panel — a tall column of this session's info, in a terminal split left of it.

The side-panel mod's /side opens it (Ghostty: a split to the left, sized to WIDTH columns):
    python3 ~/.claude/side.py <key>
<key> names the feed the mod keeps at ~/.claude/side/<key>.json: the session id, its transcript, the
Ghostty terminal id of this split, and the agents and background tasks the engine lists. The
title, artifacts and PRs come from statusline.py's own readers and caches, so the two agree.
The panel exits (and Ghostty closes the split) when the feed says the session ended or /side
closed it. Ctrl+C closes it too.
"""
import fcntl, importlib.util, json, os, re, signal, struct, subprocess, sys, termios, time

# ---------- user knobs ----------
WIDTH = 34                # columns the split is sized to when it opens
TICK = 1.0                # seconds between redraws
ART_MAX = 6               # artifacts listed, newest first
PR_MAX = 6                # PRs listed, newest first
STALE = 30                # seconds without a feed update before the panel says the session stopped answering

FEED_DIR = os.path.expanduser("~/.claude/side")
HERE = os.path.dirname(os.path.realpath(__file__))

spec = importlib.util.spec_from_file_location("statusline", os.path.join(HERE, "statusline.py"))
sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)
R, C, fg, vlen, render = sl.R, sl.C, sl.fg, sl.vlen, sl.render
ICON = dict(title=sl.I_TITLE, sid=sl.I_SID, art=sl.I_ART, pr=sl.I_PR, agent=sl.I_AGENT, shell="",
            running="", done="", failed="", idle="")


def read_feed(key):
    try:
        with open(os.path.join(FEED_DIR, f"{key}.json"), encoding="utf-8") as f: return json.load(f)
    except Exception: return None


def term_size():
    """(columns, rows, pixel width) of this terminal; pixels 0 where the terminal does not say."""
    try:
        rows, cols, xpix, _ = struct.unpack("HHHH", fcntl.ioctl(sys.stdout.fileno(), termios.TIOCGWINSZ, b"\0" * 8))
        return cols, rows, xpix
    except Exception:
        s = os.get_terminal_size(); return s.columns, s.lines, 0


def osa(script):
    try: return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5).returncode == 0
    except Exception: return False


def fit_width(term_id):
    """Move the divider on our right until this split is WIDTH columns. Ghostty resizes by pixels, so
    measure what one step did and correct; a few steps land within a column."""
    if not re.fullmatch(r"[\w-]+", term_id or ""): return
    per_col = None
    for _ in range(6):
        cols, _, xpix = term_size()
        diff = cols - WIDTH
        if abs(diff) <= 1: return
        if per_col is None: per_col = (xpix / cols / 2) if xpix and cols else 4.0   # pixels to points, first guess
        amount = max(1, min(4000, round(abs(diff) * per_col)))
        way = "left" if diff > 0 else "right"
        if not osa(f'tell application "Ghostty" to perform action "resize_split:{way},{amount}" on terminal id "{term_id}"'): return
        time.sleep(0.25)
        moved = abs(cols - term_size()[0])
        if moved == 0: return
        per_col = amount / moved


def close_split(term_id):
    """Ghostty keeps a split whose command ended, empty; close ours once this process is gone (so
    Ghostty has nothing running to ask about). Detached, so it outlives us."""
    if not re.fullmatch(r"[\w-]+", term_id or ""): return
    script = f'tell application "Ghostty" to if exists terminal id "{term_id}" then close terminal id "{term_id}"'
    try:
        subprocess.Popen(["/bin/sh", "-c", 'sleep 0.5; exec osascript -e "$0"', script],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except Exception: pass


def wrap(text, width, max_lines):
    """Lines of `text` no wider than `width` display columns, the last cut with "…"."""
    lines, cur = [], ""
    for ch in text:
        if vlen(cur + ch) > width:
            lines.append(cur); cur = ch
        else: cur += ch
    if cur: lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and vlen(last + "…") > width: last = last[:-1]
        lines[-1] = last + "…"
    return lines


def cut(text, width):
    if vlen(text) <= width: return text
    while text and vlen(text + "…") > width: text = text[:-1]
    return text + "…"


def header(icon, label, count, width):
    t = f"{icon} {label} {count}" if sl.RIGHT_ICONS else f"{label} {count}"
    return render([(C["stat_bg"], C["stat_fg"], cut(t, width - 2))])


def frame(feed, width, rows):
    sid = feed.get("sessionId") or ""
    out = []
    if not sid:
        return [f"{fg(C['dim'])}세션 정보를 기다리는 중…{R}"]
    title = sl.session_title(sid) or "(제목 아직 없음)"
    for line in wrap(f"{ICON['title']} {title}" if sl.RIGHT_ICONS else title, width, 3):
        out.append(f"{fg(C['title_fg'])}{line}{R}")
    out.append(render([(C["model_bg"], C["model_fg"], (f"{ICON['sid']} " if sl.RIGHT_ICONS else "sid ") + sid[:8])]))
    if feed.get("ended"):
        out += ["", f"{fg(C['dim'])}세션이 끝났어요.{R}"]
        return out
    if time.time() - (feed.get("at") or 0) / 1000 > STALE:
        out.append(f"{fg(C['warn'])}세션이 {STALE}초 넘게 응답이 없어요{R}")

    try: prs, arts = sl.session_outputs(sid, feed.get("transcript") or "")
    except Exception: prs, arts = [], []
    live = 2                                                   # one space and a mark before each row's text

    out += ["", header(ICON["art"], "아티팩트", len(arts), width)]
    if not arts: out.append(f" {fg(C['dim'])}없음{R}")
    for url, title in list(reversed(arts))[:ART_MAX]:
        out.append(f" {fg(C['stat_fg'])}{sl.art_link(url, title, width - live)}{R}")
    if len(arts) > ART_MAX: out.append(f" {fg(C['stat_label'])}+{len(arts) - ART_MAX}{R}")

    out += ["", header(ICON["pr"], "PR", len(prs), width)]
    if not prs: out.append(f" {fg(C['dim'])}없음{R}")
    for url, num in list(reversed(prs))[:PR_MAX]:
        out.append(f" {sl.pr_badge(url, num)}{R}")
    if len(prs) > PR_MAX: out.append(f" {fg(C['stat_label'])}+{len(prs) - PR_MAX}{R}")

    agents = feed.get("agents") or []
    active = [a for a in agents if a.get("status") in ("pending", "running", "waiting")]
    out += ["", header(ICON["agent"], "에이전트", len(active), width)]
    if not agents: out.append(f" {fg(C['dim'])}없음{R}")
    for a in agents:
        st = a.get("status")
        mark, color = ((ICON["running"], C["warn"]) if a in active else (ICON["done"], C["ok"]) if st == "completed"
                       else (ICON["failed"], C["bad"]) if st in ("failed", "killed") else (ICON["idle"], C["dim"]))
        text = cut(f"{a.get('type') or ''} {a.get('label') or ''}".strip(), width - 3)
        out.append(f" {fg(color)}{mark}{R} {fg(C['stat_fg'] if a in active else C['stat_label'])}{text}{R}")

    tasks = feed.get("tasks") or []
    running = [t for t in tasks if t.get("isRunning")]
    out += ["", header(ICON["shell"], "백그라운드", len(running), width)]
    if not tasks: out.append(f" {fg(C['dim'])}없음{R}")
    for t in tasks:
        on = t.get("isRunning")
        text = cut(t.get("label") or "", width - 3)
        out.append(f" {fg(C['warn'] if on else C['ok'])}{ICON['running'] if on else ICON['done']}{R} "
                   f"{fg(C['stat_fg'] if on else C['stat_label'])}{text}{R}")
    return out[:rows]


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"[\w-]+", sys.argv[1]):
        sys.stdout.write("usage: side.py <key>   (the side-panel mod's /side starts it)\n"); return 2
    key = sys.argv[1]
    sys.stdout.write("\033]2;side\007\033[?1049h\033[?25l")   # title, alternate screen, no cursor
    sys.stdout.flush()

    term = {"id": ""}

    def leave(*_):
        for ext in ("json", "alive"):                          # the feed is done with once the panel is
            try: os.unlink(os.path.join(FEED_DIR, f"{key}.{ext}"))
            except Exception: pass
        sys.stdout.write("\033[?25h\033[?1049l"); sys.stdout.flush()
        close_split(term["id"])
        sys.exit(0)
    signal.signal(signal.SIGINT, leave); signal.signal(signal.SIGTERM, leave); signal.signal(signal.SIGHUP, leave)
    redraw = {"force": True}
    signal.signal(signal.SIGWINCH, lambda *_: redraw.update(force=True))

    fitted, last, ended_at = False, None, None
    alive = os.path.join(FEED_DIR, f"{key}.alive")
    while True:
        try: open(alive, "a").close(); os.utime(alive)       # heartbeat: the mod stops feeding once this goes quiet
        except Exception: pass
        feed = read_feed(key) or {}
        term["id"] = feed.get("termId") or term["id"]
        if feed.get("closed"): leave()
        if not fitted and feed.get("termId"):
            fit_width(feed["termId"]); fitted = True
        cols, rows, _ = term_size()
        lines = frame(feed, max(10, cols), max(1, rows))
        text = "\033[H" + "\n".join(line + "\033[K" for line in lines) + "\033[J"
        if text != last or redraw["force"]:
            sys.stdout.write(text); sys.stdout.flush()
            last, redraw["force"] = text, False
        if feed.get("ended"):
            ended_at = ended_at or time.time()
            if time.time() - ended_at > 3: leave()
        time.sleep(TICK)


if __name__ == "__main__":
    sys.exit(main())
