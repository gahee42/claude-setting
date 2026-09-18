#!/usr/bin/env python3
"""Background helper for statusline.py — fetches subscription usage (5h / 7d / per-model weekly limits)
from the same endpoint Claude Code's /usage screen uses, and caches it.

Reads the OAuth token Claude Code stored (macOS Keychain "Claude Code-credentials", or ~/.claude/.credentials.json).
Output: ~/.claude/statusline.usage.json   Errors: ~/.claude/statusline.usage.err
"""
import json, os, subprocess, sys, time, urllib.request

OUT = os.path.expanduser("~/.claude/statusline.usage.json")
ERR = os.path.expanduser("~/.claude/statusline.usage.err")
URL = "https://api.anthropic.com/api/oauth/usage"

def token():
    try:
        raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                             capture_output=True, text=True, timeout=5).stdout
        t = (json.loads(raw).get("claudeAiOauth") or {}).get("accessToken")
        if t: return t
    except Exception: pass
    try:
        t = (json.load(open(os.path.expanduser("~/.claude/.credentials.json"))).get("claudeAiOauth") or {}).get("accessToken")
        if t: return t
    except Exception: pass
    return None

def pct(d):
    for k in ("utilization", "percent", "used_percentage"):
        v = d.get(k)
        if isinstance(v, (int, float)): return float(v)
    return None

def extract(body):
    """Collect every rate-limit window we can recognise, wherever it sits in the response."""
    windows = {}
    def walk(o):
        if isinstance(o, dict):
            if o.get("kind") == "weekly_scoped" and isinstance(o.get("scope"), dict) and pct(o) is not None:
                name = ((o["scope"].get("model") or {}).get("display_name")) or "model"
                windows[f"model:{name}"] = dict(label=name, used_percentage=pct(o), resets_at=o.get("resets_at"))
            for k, v in o.items():
                if isinstance(v, dict) and k in ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet") and pct(v) is not None:
                    windows[k] = dict(label=k, used_percentage=pct(v), resets_at=v.get("resets_at"))
                walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(body)
    return windows

def main():
    tok = token()
    if not tok: raise SystemExit("no OAuth token found (Keychain 'Claude Code-credentials')")
    req = urllib.request.Request(URL, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json",
                                               "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code-statusline"})
    with urllib.request.urlopen(req, timeout=8) as r:
        body = json.loads(r.read())
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"fetched_at": time.time(), "windows": extract(body), "raw": body}, f, indent=1)
    os.replace(tmp, OUT)
    if os.path.exists(ERR): os.remove(ERR)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--extract-test":   # offline self-test on a JSON file
        print(json.dumps(extract(json.load(open(sys.argv[2]))), indent=1)); sys.exit()
    try: main()
    except Exception as e:
        with open(ERR, "w") as f: f.write(f"{time.strftime('%F %T')} {type(e).__name__}: {e}\n")
        sys.exit(1)
