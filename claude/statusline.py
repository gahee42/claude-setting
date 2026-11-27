#!/usr/bin/env python3
"""Claude Code status line — rounded pill segments (Nerd Font required, e.g. MesloLGS NF).

Default layout (see LINES):
  1. session settings : (model) (effort) (agent) (git) (dir)
  2. session numbers  : (ctx %) (diff) (time) (cost)
  3. account usage    : (usage) (5h) (7d) (per-model weekly, e.g. Fable) (ver)

Per-model weekly limits are not in the status-line JSON; statusline-usage.py fetches them in the
background every USAGE_TTL seconds (set FETCH_USAGE = False to disable).
Width override: CLAUDE_STATUSLINE_WIDTH=<n>.  Detected width → ~/.claude/statusline.width
"""
import glob, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, unicodedata
from datetime import datetime, timezone

# ---------- user knobs ----------
SEG_STYLE   = "pill"      # "pill" (rounded) | "arrow" (powerline) | "lean" (no background)
BOLD        = False       # bold values (model name, percentages, cost)
# Each inner list is one status line. Available keys:
#   session : model effort agent git dir ctx diff time cost vim
#   account : header 5h 7d scoped ver      ("scoped" = per-model weekly limits, e.g. Fable)
LINES = [
    ["model", "effort", "agent", "dir", "git", "vim"],   # session settings  (repo → branch)
    ["ctx", "cost", "time"],                      # session numbers
    ["5h", "7d", "scoped"],                       # account-wide usage
]
# fuller variant:  [["model","agent","git","dir","vim"], ["ctx","diff","time","cost"], ["header","5h","7d","scoped","ver"]]
ICONS       = False       # Nerd Font icon in front of each pill
SHOW_EFFORT = True        # effort level ("xhigh" …) as its own pill next to the model
LINE2_HEADER = ""         # label pill for the account-usage group ("" to hide)
FETCH_USAGE = True
USAGE_TTL   = 300         # seconds between background usage fetches
GIT_TTL     = 3           # seconds a `git status` result is reused (statusline 은 매 틱 새 프로세스라 파일 캐시다)
GIT_IDENT_TTL = 600       # seconds the repo identity (toplevel/origin) is reused — cwd 당 사실상 고정이다
BRANCH_MAX  = 28
CTX_TOKENS  = False       # show "136k/1.0M" after ctx % on wide terminals
SHOW_1M     = False       # show "[1m]" tag after the model name
LINE_SPACING = 0          # blank spacer lines between status lines (0 = none)
TITLE_LINE  = 0           # line index that shows the AI session title right-aligned (-1 = off)
PR_LINE     = 1           # line index that shows this session's PRs right-aligned, Cmd+click opens (-1 = off)
PR_TTL_OPEN = 60          # seconds between background `gh pr view` refreshes of an open PR (state · CI)
PR_TTL_DONE = 3600        # merged / closed PRs rarely change
PR_MAX      = 3           # newest PRs shown; older ones collapse into "+N"
SID_LINE    = 2           # line index that shows "sid <first 8 of the session id>" right-aligned, dim (-1 = off)
WIDTH_MARGIN = 4          # columns kept free at the right edge (Claude Code indents the status line and
                          # ellipsizes anything that overflows, so leave it room)
DIR_MODE    = "repo"      # "repo" = repository name (from origin; worktree-safe) | "path" = working directory
EFFORT_ABBR = {"low": "lo", "medium": "med", "high": "hi", "xhigh": "xhi", "max": "max"}
GAP = " "                 # space between pills
PAD = ""                  # space inside a pill between the round cap and the text ("" = tight, " " = roomy)
SMALL_CAPS  = False       # render labels (ctx, diff, time, cost, usage, 5h, 7d, Fable …) in small caps to look smaller

_SC = str.maketrans("abcdefghijklmnopqrstuvwxyz", "\u1d00\u0299\u1d04\u1d05\u1d07\ua730\u0262\u029c\u026a\u1d0a\u1d0b\u029f\u1d0d\u0274\u1d0f\u1d18\u01eb\u0280s\u1d1b\u1d1c\u1d20\u1d21x\u028f\u1d22")
def sc(t): return t.lower().translate(_SC) if SMALL_CAPS else t
def ic(i): return f"{i} " if ICONS else ""

# ---------- Nerd Font glyphs (escaped so they survive copy/paste) ----------
I_MODEL, I_BRANCH, I_DIR, I_CTX = "\uf0e7", "\ue0a0", "\uf07b", "\uf2db"        # bolt, branch, folder, chip
I_5H, I_7D, I_SCOPED, I_COST   = "\uf252", "\uf073", "\uf005", "\uf155"         # hourglass, calendar, star, $
I_TIME, I_DIFF, I_VER, I_RESET  = "\uf017", "\uf044", "\uf02b", "\uf021"         # clock, pencil, tag, refresh
I_AGENT, I_USAGE = "\uf17b", "\uf0e4"   # android, gauge
L_CAP, R_CAP, ARROW, THIN = "\ue0b6", "\ue0b4", "\ue0b0", "\ue0b1"               # ( ) ▶ ›
I_STAGED, I_MOD, I_UNTR, I_CONF, I_AHEAD, I_BEHIND = "+", "!", "?", "~", "⇡", "⇣"

# ---------- colors (xterm-256) ----------
R, B = "\033[0m", ("\033[1m" if BOLD else "")
def fg(n): return f"\033[38;5;{n}m"
def bg(n): return f"\033[48;5;{n}m"
C = dict(model_bg=60, model_fg=253, git_clean_bg=71, git_dirty_bg=172, git_fg=16, dir_bg=24, dir_fg=252,
         agent_bg=96, agent_fg=253, ctx_fg=252, ctx_label=248,
         l2_bg=235, l2_fg=250, l2_label=244, l2_dim=242, scoped_label=176,
         stat_bg=236, stat_fg=250, stat_label=244, title_bg=235, title_fg=182,
         ok=71, warn=172, bad=167, dim=240,
         effort_fg=16,
         lean_model=141, lean_git_clean=76, lean_git_dirty=178, lean_dir=31, lean_muted=245)
# effort pill background per level — brighter/warmer as effort rises, dark text on top
EFFORT_BG = {"low": 246, "medium": 109, "high": 110, "xhigh": 140, "max": 168}

ANSI = re.compile(r"\033\[[0-9;]*m|\033\]8;[^\033\007]*(?:\007|\033\\)")   # SGR colors + OSC 8 links
def vlen(s): return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in ANSI.sub("", s))
def level_color(p): return C["ok"] if p < 50 else (C["warn"] if p < 80 else C["bad"])
def level_bg(p):    return 237 if p < 50 else (94 if p < 80 else 88)

def bar(pct, width, on_fg=None, off_fg=None):
    if width <= 0: return ""
    pct = max(0, min(100, pct)); n = round(pct / 100 * width)
    return f"{fg(on_fg if on_fg is not None else level_color(pct))}{BAR_ON * n}{fg(off_fg if off_fg is not None else C['dim'])}{BAR_OFF * (width - n)}"

def fmt_tokens(n): return f"{n/1e6:.1f}M" if n >= 1e6 else (f"{n/1e3:.0f}k" if n >= 1e3 else str(n))
def fmt_duration(ms):
    s = int(ms // 1000); h, s = divmod(s, 3600); m, s = divmod(s, 60)
    return f"{h}h{m:02d}m" if h else (f"{m}m{s:02d}s" if m else f"{s}s")
def fmt_reset(ts):
    """epoch seconds / ms, or ISO-8601 string → 'HH:MM' (today) or 'NdMh'."""
    try:
        if isinstance(ts, str):
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
            ts = dt.timestamp()
        ts = float(ts); ts = ts / 1000 if ts > 1e12 else ts
        delta = ts - time.time()
        if delta < 0: return "now"
        if delta < 86400: return datetime.fromtimestamp(ts).strftime("%H:%M")
        return f"{int(delta // 86400)}d{int(delta % 86400 // 3600)}h"
    except Exception: return ""

def term_width():
    src, w = "fallback", 120
    if os.environ.get("CLAUDE_STATUSLINE_WIDTH", "").isdigit():
        src, w = "env", int(os.environ["CLAUDE_STATUSLINE_WIDTH"])
    else:
        for name, f in (("stderr", sys.stderr), ("stdout", sys.stdout), ("stdin", sys.stdin)):
            try: src, w = name, os.get_terminal_size(f.fileno()).columns; break
            except Exception: pass
        else:
            try:
                fd = os.open("/dev/tty", os.O_RDONLY); src, w = "/dev/tty", os.get_terminal_size(fd).columns; os.close(fd)
            except Exception:
                if os.environ.get("COLUMNS", "").isdigit(): src, w = "COLUMNS", int(os.environ["COLUMNS"])
    try:
        cache = os.path.expanduser("~/.claude/statusline.width"); line = f"{w} {src}"
        if not os.path.exists(cache) or open(cache).read().strip() != line: open(cache, "w").write(line + "\n")
    except Exception: pass
    return w

# ---------- per-model usage (background fetch + cache) ----------
def usage_windows():
    path = os.environ.get("CLAUDE_STATUSLINE_USAGE_FILE") or os.path.expanduser("~/.claude/statusline.usage.json")
    data, age = {}, None
    try:
        data = json.load(open(path)); age = time.time() - float(data.get("fetched_at") or 0)
    except Exception: pass
    if FETCH_USAGE and not os.environ.get("CLAUDE_STATUSLINE_USAGE_FILE") and (age is None or age > USAGE_TTL):
        lock = path + ".lock"
        try:
            if not os.path.exists(lock) or time.time() - os.path.getmtime(lock) > 60:
                open(lock, "w").close()
                subprocess.Popen([sys.executable, os.path.expanduser("~/.claude/statusline-usage.py")],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception: pass
    return data.get("windows") or {}

# ---------- AI session title (written by ~/.claude/hooks/session-title.py) ----------
def session_title(session_id):
    if not session_id: return ""
    try:
        st = json.load(open(os.path.expanduser(f"~/.claude/session-titles/{session_id}.json")))
        return (st.get("title") or "").strip()
    except Exception: return ""

# ---------- git ----------
# statusline 은 매 틱마다 새 프로세스로 뜬다 — 프로세스 안 메모이제이션은 아무 소용이 없어
# 캐시는 파일에 둔다. cwd 별로 파일을 나눠 여러 세션이 동시에 써도 서로를 덮지 않고,
# 쓰기는 tempfile+os.replace 로 원자적이라 읽는 쪽이 반쪽짜리 JSON 을 보는 일이 없다.
# 캐시가 깨지거나 비어도 그냥 git 을 다시 부르면 그만이라 모든 실패는 조용히 미스로 떨어뜨린다.
_CACHE_DIR = os.path.expanduser("~/.claude/statusline-git")
_MISS = object()

def _cache_path(kind, cwd):
    return os.path.join(_CACHE_DIR, f"{kind}-{hashlib.md5(cwd.encode()).hexdigest()}.json")

def _cache_read(kind, key):
    """(written_at, value) regardless of age, or None."""
    try:
        with open(_cache_path(kind, key)) as f: d = json.load(f)
        return float(d["at"]), d["v"]
    except Exception: return None

def _cache_get(kind, cwd, ttl):
    c = _cache_read(kind, cwd)
    if c and time.time() - c[0] <= ttl: return c[1]
    return _MISS

def _cache_put(kind, cwd, value):
    tmp = None
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=_CACHE_DIR, suffix=".tmp")
        with os.fdopen(fd, "w") as f: json.dump({"at": time.time(), "v": value}, f)
        os.replace(tmp, _cache_path(kind, cwd))
    except Exception:
        if tmp:
            try: os.unlink(tmp)
            except Exception: pass
    return value

def _git_ident(cwd):
    """(repo, top) — 레포 정체성. toplevel 과 origin URL 은 cwd 당 바뀌지 않으므로 길게 캐시한다.
    매 틱 git 을 3번 더 부르던 자리다."""
    c = _cache_get("ident", cwd, GIT_IDENT_TTL)
    if c is not _MISS: return c[0], c[1]
    repo = top = None
    try:
        top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=1.0).stdout.strip()
        url = subprocess.run(["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True, timeout=1.0).stdout.strip()
        if url:
            repo = url.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
            if repo.endswith(".git"): repo = repo[:-4]
        if not repo and top:
            common = subprocess.run(["git", "-C", cwd, "rev-parse", "--git-common-dir"], capture_output=True, text=True, timeout=1.0).stdout.strip()
            common = os.path.abspath(os.path.join(cwd, common))
            repo = os.path.basename(os.path.dirname(common))
    except Exception: pass
    _cache_put("ident", cwd, [repo, top])
    return repo, top

def git_info(cwd):
    """`git status` 는 레포 전체 파일을 stat 한다 — 제일 비싼 호출이다. 짧게 캐시해
    같은 cwd 를 보는 세션들이 결과를 나눠 쓴다. 최대 GIT_TTL 초 늦게 갱신된다."""
    c = _cache_get("info", cwd, GIT_TTL)
    if c is not _MISS: return c
    return _cache_put("info", cwd, _git_info_raw(cwd))

def _git_info_raw(cwd):
    try:
        out = subprocess.run(["git", "-C", cwd, "status", "--porcelain=v1", "-b"], capture_output=True, text=True, timeout=1.0)
        if out.returncode != 0: return None
    except Exception: return None
    lines = out.stdout.splitlines()
    if not lines: return None
    head = lines[0]; branch = head[3:].split("...")[0].strip()
    if branch.startswith("No commits yet on "): branch = branch[18:]
    if "HEAD (no branch)" in head:
        try: branch = subprocess.run(["git", "-C", cwd, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=1.0).stdout.strip() or "HEAD"
        except Exception: branch = "HEAD"
    ahead = behind = 0
    if "[" in head and head.endswith("]"):
        for part in head[head.index("[") + 1:-1].split(","):
            p = part.strip().split()
            if len(p) == 2 and p[1].isdigit():
                if p[0] == "ahead": ahead = int(p[1])
                elif p[0] == "behind": behind = int(p[1])
    st = dict(staged=0, mod=0, untr=0, conf=0)
    for l in lines[1:]:
        x, y = l[0], l[1]
        if x == "?": st["untr"] += 1
        elif x == "U" or y == "U" or (x == y and x in "AD"): st["conf"] += 1
        else:
            if x != " ": st["staged"] += 1
            if y != " ": st["mod"] += 1
    repo, top = _git_ident(cwd)
    rel = None
    if top:
        try: rel = os.path.relpath(cwd, top)
        except Exception: pass
    return dict(branch=branch, ahead=ahead, behind=behind, repo=repo, top=top, rel=rel, **st)

def git_flags(g, ok, warn, bad, muted):
    f = []
    if g["staged"]: f.append(f"{ok}{I_STAGED}{g['staged']}")
    if g["mod"]:    f.append(f"{warn}{I_MOD}{g['mod']}")
    if g["untr"]:   f.append(f"{muted}{I_UNTR}{g['untr']}")
    if g["conf"]:   f.append(f"{bad}{I_CONF}{g['conf']}")
    if g["ahead"]:  f.append(f"{ok}{I_AHEAD}{g['ahead']}")
    if g["behind"]: f.append(f"{warn}{I_BEHIND}{g['behind']}")
    return " ".join(f)

# ---------- PRs this session opened or edited ----------
# Claude Code stamps every `gh pr create` / `gh pr edit` result in the transcript as
# toolUseResult.gitOperation.pr = {number, url, action}; subagents write their own transcripts under
# <session>/subagents/. Only bytes appended since the last tick are read. The payload's `pr` (the
# current branch's PR) is added too, but it disappears once that PR merges — the transcript keeps it.
# State and CI come from `gh pr view`, which takes ~3s, so it runs detached and is cached per URL.
def session_prs(session_id, transcript):
    """[[url, number]] this session touched, most recent last."""
    if not session_id or not transcript: return []
    c = _cache_read("prscan", session_id)
    st = c[1] if c else {}
    offs, prs = dict(st.get("offsets") or {}), [list(p) for p in st.get("prs") or []]
    files = [transcript] + sorted(glob.glob(os.path.join(os.path.dirname(transcript), session_id, "subagents", "agent-*.jsonl")))
    changed = False
    for path in files:
        try:
            size, off = os.path.getsize(path), offs.get(path, 0)
            if size < off: off = 0                              # rewritten: scan again
            if size == off: continue
            with open(path, "rb") as f:
                f.seek(off); chunk = f.read(size - off)
        except Exception: continue
        end = chunk.rfind(b"\n") + 1                            # leave a half-written last line for the next tick
        for line in chunk[:end].split(b"\n"):
            if b'"gitOperation"' not in line: continue
            try:
                res = json.loads(line)["toolUseResult"]
                pr = res["gitOperation"]["pr"]
                url, num = pr["url"], pr["number"]
            except Exception: continue
            # Claude Code tags any command that merely mentions `gh pr create` and prints a PR URL.
            # gh itself prints the URL alone on a line, so require that.
            if not re.search(r"(?m)^\s*" + re.escape(url) + r"\s*$", res.get("stdout") or ""): continue
            prs = [p for p in prs if p[0] != url] + [[url, num]]
        if end:
            offs[path] = off + end; changed = True
    if changed: _cache_put("prscan", session_id, {"offsets": offs, "prs": prs})
    return prs

def pr_status(url):
    """{state, draft, ci} from the last background fetch ({} until the first one lands)."""
    c = _cache_read("pr", url)
    v = (c[1] if c else None) or {}
    ttl = PR_TTL_DONE if v.get("state") in ("MERGED", "CLOSED") else PR_TTL_OPEN
    if not c or time.time() - c[0] > ttl:
        lock = _cache_path("pr", url) + ".lock"
        try:
            if not os.path.exists(lock) or time.time() - os.path.getmtime(lock) > 60:
                os.makedirs(_CACHE_DIR, exist_ok=True); open(lock, "w").close()
                subprocess.Popen([sys.executable, os.path.abspath(__file__), "--pr-fetch", url],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception: pass
    return v

def _ci(rollup):
    # CheckRun carries status/conclusion, StatusContext carries state; an unfinished CheckRun has an empty conclusion.
    runs = {(r.get("conclusion") or r.get("state") or r.get("status") or "").upper() for r in rollup if isinstance(r, dict)}
    if runs & {"FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}: return "fail"
    if runs & {"IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}: return "pending"
    return "pass" if runs else ""

def pr_fetch(url):
    """Background worker (`--pr-fetch <url>`)."""
    try:
        gh = shutil.which("gh") or next((p for p in ("/opt/homebrew/bin/gh", "/usr/local/bin/gh") if os.access(p, os.X_OK)), None)
        v = None
        if gh:
            out = subprocess.run([gh, "pr", "view", url, "--json", "state,isDraft,statusCheckRollup"], capture_output=True, text=True, timeout=30)
            if out.returncode == 0:
                d = json.loads(out.stdout)
                v = {"state": d.get("state"), "draft": bool(d.get("isDraft")), "ci": _ci(d.get("statusCheckRollup") or [])}
        if v is None:                                           # gh failed: keep the last answer, retry after the TTL
            c = _cache_read("pr", url); v = (c[1] if c else None) or {}
        _cache_put("pr", url, v)
    finally:
        try: os.unlink(_cache_path("pr", url) + ".lock")
        except Exception: pass

def panel(session_id, transcript):
    """`--panel <session_id> [transcript]`: what the side-panel mod shows, read through the same caches."""
    try: prs = session_prs(session_id, transcript) if transcript else []
    except Exception: prs = []
    out = []
    for url, num in reversed(prs[-PR_MAX * 2:]):                 # newest first
        v = pr_status(url)
        out.append({"url": url, "num": num, "state": v.get("state") or "", "draft": bool(v.get("draft")), "ci": v.get("ci") or ""})
    sys.stdout.write(json.dumps({"title": session_title(session_id), "prs": out}, ensure_ascii=False))

def pr_badge(url, num):
    v = pr_status(url); state = v.get("state")
    s = f"{fg(C['stat_fg'])}\033[4m#{num}\033[24m"
    if state == "MERGED": s += f" {fg(141)}merged"
    elif state == "CLOSED": s += f" {fg(C['dim'])}closed"
    else:
        if v.get("draft"): s += f" {fg(C['stat_label'])}draft"
        s += {"pass": f" {fg(C['ok'])}✓", "fail": f" {fg(C['bad'])}✗", "pending": f" {fg(C['warn'])}⋯"}.get(v.get("ci"), "")
    return f"\033]8;;{url}\007{s}\033]8;;\007"                  # OSC 8: Cmd+click opens the PR

# ---------- renderers: segs = [(bg, fg, text)] ----------
def render(segs, style=None):
    style = style or SEG_STYLE
    segs = [s for s in segs if s and s[2]]
    if not segs: return ""
    if style == "pill":
        return GAP.join(f"{fg(b)}{L_CAP}{bg(b)}{fg(f)}{PAD}{t.replace(R, R + bg(b) + fg(f))}{PAD}{R}{fg(b)}{R_CAP}{R}" for b, f, t in segs) + R
    if style == "arrow":
        out = ""
        for i, (b, f, t) in enumerate(segs):
            out += f"{bg(b)}{fg(f)} {t.replace(R, R + bg(b) + fg(f))}{R}{bg(b)} "
            nb = segs[i + 1][0] if i + 1 < len(segs) else None
            out += f"{R}{bg(nb)}{fg(b)}{ARROW}" if nb is not None else f"{R}{fg(b)}{ARROW}{R}"
        return out + R
    return f" {fg(C['dim'])}{THIN}{R} ".join(f"{fg(f)}{t}{R}" for _, f, t in segs) + R

# ---------- main ----------
def main():
    raw = sys.stdin.read()
    try: d = json.loads(raw) if raw.strip() else {}
    except Exception: d = {}

    # Keep Orca terminal integration alive (forward payload in background).
    orca = os.path.expanduser("~/.orca/agent-hooks/claude-statusline.sh")
    if os.access(orca, os.X_OK) and os.environ.get("ORCA_PANE_KEY"):
        try:
            p = subprocess.Popen(["/bin/sh", orca], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            p.stdin.write(raw.encode()); p.stdin.close()
        except Exception: pass

    m = d.get("model") or {}
    model = m.get("display_name") or m.get("id") or "Claude"
    model_tag = "1m" if "[1m]" in m.get("id", "") or "1m context" in model.lower() else ""
    model = re.sub(r"\s*\(1M context\)", "", model, flags=re.I).strip()
    effort = (d.get("effort") or {}).get("level") or d.get("effort_level") or ""
    ws = d.get("workspace") or {}
    cwd = ws.get("current_dir") or d.get("cwd") or os.getcwd()
    home = os.path.expanduser("~")
    path_full = "~" + cwd[len(home):] if cwd.startswith(home) else cwd
    ctx, cost, rl = d.get("context_window") or {}, d.get("cost") or {}, dict(d.get("rate_limits") or {})
    agent = (d.get("agent") or {}).get("name")
    vim = (d.get("vim") or {}).get("mode")
    g = git_info(cwd)
    lean = SEG_STYLE == "lean"

    # merge cached usage: live 5h/7d from Claude Code win; per-model windows come from the cache
    cached = usage_windows()
    for k, v in cached.items():
        if k not in ("five_hour", "seven_day") or k not in rl: rl[k] = v

    used, size = ctx.get("used_percentage"), ctx.get("context_window_size")
    cu = ctx.get("current_usage") or {}
    cur_tok = sum(cu.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    if used is None and size and cur_tok: used = cur_tok * 100 / size
    used = float(used) if used is not None else None
    width = term_width() - WIDTH_MARGIN

    # ----- session items (shrink level 0..8) -----
    def session_items(lv):
        P = C["stat_bg"]; L = fg(C["stat_label"]); V = fg(C["stat_fg"])
        items = {}
        model_txt = f"{B}{ic(I_MODEL)}{model}"
        if SHOW_1M and lv < 1 and model_tag: model_txt += f" {fg(C['ctx_label'])}[{model_tag}]"
        items["model"] = (C["model_bg"], C["lean_model"] if lean else C["model_fg"], model_txt)
        if SHOW_EFFORT and effort:
            eb = EFFORT_BG.get(effort, 246)
            items["effort"] = (eb, eb if lean else C["effort_fg"], f"{B}{effort if lv < 3 else EFFORT_ABBR.get(effort, effort)}")
        if agent: items["agent"] = (C["agent_bg"], C["agent_bg"] if lean else C["agent_fg"], f"{ic(I_AGENT)}{agent}")
        if g:
            dirty = bool(g["mod"] or g["staged"] or g["conf"])
            br = g["branch"]; cap = BRANCH_MAX if lv < 2 else (18 if lv < 7 else 12)
            if len(br) > cap: br = br[:cap - 1] + "…"
            git_txt = f"{ic(I_BRANCH)}{br}"
            fl = git_flags(g, fg(C["ok"]), fg(C["warn"]), fg(C["bad"]), fg(C["lean_muted"])) if lean \
                 else git_flags(g, fg(C["git_fg"]), fg(C["git_fg"]), fg(C["bad"]), fg(C["git_fg"]))
            if fl and lv < 8: git_txt += f" {fl}"
            gb = C["git_dirty_bg"] if dirty else C["git_clean_bg"]
            items["git"] = (gb, gb if lean else C["git_fg"], git_txt)
        if lv < 8:
            if DIR_MODE == "repo" and g and g.get("repo"):
                path = g["repo"]
                if g.get("rel") and g["rel"] != "." and lv < 2:
                    path += "/" + (g["rel"] if len(g["rel"]) <= 20 else "…/" + os.path.basename(g["rel"]))
            else:
                parts = path_full.split("/"); keep = 2 if lv < 2 else 1
                path = path_full if len(parts) <= keep + 1 else "…/" + "/".join(parts[-keep:])
            items["dir"] = (C["dir_bg"], C["lean_dir"] if lean else C["dir_fg"], f"{ic(I_DIR)}{path}")
        if used is not None:
            pc = fg(level_color(used)) if lean else fg(C["ctx_fg"])
            ctx_txt = f"{fg(C['lean_muted'] if lean else C['ctx_label'])}{ic(I_CTX)}{sc('ctx')} {B}{pc}{used:.0f}%{R}"
            if lv < 1 and size and CTX_TOKENS: ctx_txt += f" {fg(C['lean_muted'] if lean else C['ctx_label'])}{fmt_tokens(cur_tok)}/{fmt_tokens(size)}"
            items["ctx"] = (level_bg(used), C["ctx_fg"], ctx_txt)
        la, lr = cost.get("total_lines_added"), cost.get("total_lines_removed")
        if (la is not None or lr is not None) and lv < 5:
            items["diff"] = (P, C["stat_fg"], f"{L}{ic(I_DIFF)}{sc('diff') + ' ' if lv < 4 else ''}{fg(C['ok'])}+{la or 0} {fg(C['bad'])}−{lr or 0}")
        dur = cost.get("total_duration_ms")
        if dur and lv < 6: items["time"] = (P, C["stat_fg"], f"{L}{ic(I_TIME)}{sc('time') + ' ' if lv < 4 else ''}{V}{fmt_duration(dur)}")
        usd = cost.get("total_cost_usd")
        if usd is not None and lv < 7: items["cost"] = (P, C["stat_fg"], f"{L}{ic(I_COST)}{sc('cost') + ' ' if lv < 4 else ''}{V}{B}${usd:.2f}")
        if vim: items["vim"] = (240, 255, vim)
        return items

    # ----- account items (shrink level 0..3) -----
    def limit_pill(icon, label, w, lv, label_color):
        pct = float(w["used_percentage"])
        s = f"{fg(label_color)}{ic(icon)}{sc(label)} {B}{fg(level_color(pct))}{pct:.0f}%{R}"
        reset = fmt_reset(w.get("resets_at"))
        if reset and lv < 3: s += f" {fg(C['l2_dim'])}{I_RESET}{reset}"
        return s

    def account_items(lv):
        P, D = C["l2_bg"], fg(C["l2_dim"])
        items = {}
        if rl.get("five_hour", {}).get("used_percentage") is not None: items["5h"] = (P, C["l2_fg"], limit_pill(I_5H, "5h", rl["five_hour"], lv, C["l2_label"]))
        if rl.get("seven_day", {}).get("used_percentage") is not None: items["7d"] = (P, C["l2_fg"], limit_pill(I_7D, "7d", rl["seven_day"], lv, C["l2_label"]))
        scoped = []
        for k, w in rl.items():
            if not isinstance(w, dict) or w.get("used_percentage") is None: continue
            if k.startswith("model:"): name = (w.get("label") or k[6:]).split()[0]
            elif k in ("seven_day_opus", "seven_day_sonnet"): name = k.split("_")[-1].capitalize()
            else: continue
            if k in ("seven_day_opus", "seven_day_sonnet") and float(w["used_percentage"]) == 0: continue
            scoped.append((P, C["l2_fg"], limit_pill(I_SCOPED, name, w, lv, C["scoped_label"])))
        if scoped: items["scoped"] = scoped
        if LINE2_HEADER and lv < 2 and (scoped or "5h" in items or "7d" in items): items["header"] = (P, C["l2_fg"], f"{D}{ic(I_USAGE)}{sc(LINE2_HEADER)}")
        ver = d.get("version")
        if ver and lv < 1: items["ver"] = (P, C["l2_fg"], f"{D}{ic(I_VER)}{ver}")
        return items

    def build_line(order, lv):
        items = {**session_items(min(lv, 8)), **account_items(min(lv, 3))}
        segs = []
        for k in order:
            v = items.get(k)
            if isinstance(v, list): segs += v
            elif v: segs.append(v)
        return render(segs)

    title = session_title(d.get("session_id")) if TITLE_LINE >= 0 else ""
    sid = f"sid {d['session_id'][:8]}" if SID_LINE >= 0 and d.get("session_id") else ""
    prs = []
    if PR_LINE >= 0:
        try:
            prs = session_prs(d.get("session_id"), d.get("transcript_path"))
            live = d.get("pr") or {}
            if live.get("url") and all(p[0] != live["url"] for p in prs): prs.append([live["url"], live.get("number")])
        except Exception: prs = []
    lines = []
    for i, order in enumerate(LINES):
        best = next((s for s in (build_line(order, lv) for lv in range(9)) if vlen(s) <= width), build_line(order, 8))
        if i == TITLE_LINE and title:
            avail = width - vlen(best) - 2                      # room left of the right edge, incl. one gap
            t = title
            while t and vlen(t) + 2 + 2 * len(PAD) > avail: t = t[:-1]   # 2 = round caps
            if t != title and vlen(t) >= 6: t = t[:-1] + "…"
            if vlen(t) >= 6:
                pill = render([(C["title_bg"], C["title_fg"], t)])
                best = best + " " * (width - vlen(best) - vlen(pill)) + pill
        if i == PR_LINE and prs:
            badges = [pr_badge(u, n) for u, n in reversed(prs[-PR_MAX:])]   # newest first
            for k in range(len(badges), 0, -1):                              # drop the oldest until it fits
                hidden = len(prs) - k
                pill = render([(C["stat_bg"], C["stat_fg"], f"{fg(C['stat_label'])}PR " + " ".join(badges[:k])
                                + (f" {fg(C['stat_label'])}+{hidden}" if hidden else ""))])
                if vlen(best) + 1 + vlen(pill) <= width:
                    best = best + " " * (width - vlen(best) - vlen(pill)) + pill
                    break
        if i == SID_LINE and sid and vlen(best) + 1 + len(sid) <= width:
            best = best + " " * (width - vlen(best) - len(sid)) + f"{fg(C['dim'])}{sid}{R}"
        if best: lines.append(best)
    sys.stdout.write(("\n" + "\u2800\n" * LINE_SPACING).join(lines))   # U+2800: blank but not whitespace, so the line is not trimmed away

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--pr-fetch":
        pr_fetch(sys.argv[2]); sys.exit(0)
    if len(sys.argv) >= 3 and sys.argv[1] == "--panel":           # side-panel mod: title and PRs as JSON
        panel(sys.argv[2], sys.argv[3] if len(sys.argv) >= 4 else ""); sys.exit(0)
    try: main()
    except Exception as e: sys.stdout.write(f"{fg(160)}statusline error: {e}{R}")
