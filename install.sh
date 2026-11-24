#!/usr/bin/env bash
# claude-setting 설치 — 이 레포의 파일을 ~/.claude 에 심링크로 잇고, settings.json 에 두 항목만 넣는다.
# 여러 번 실행해도 결과가 같다. 설정 파일은 통째로 덮지 않는다(기기마다 다른 설정이 있으므로).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$HOME/.claude"
SETTINGS="$DIR/settings.json"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILES=(statusline.py statusline-usage.py hooks/session-title.py)
MODS=(push-guard mem-band)                      # mods/ 아래, .claude-plugin/marketplace.json 에 적힌 것
MARKET=claude-setting

has() { command -v "$1" >/dev/null 2>&1; }

# settings.json 을 고치는 부분. check = 읽을 수 있는지만 본다 / apply = 두 항목을 넣는다.
merge_settings() {
  python3 - "$SETTINGS" "$STAMP" "$1" <<'PY'
import json, os, shutil, sys

path, stamp, mode = sys.argv[1:4]
STATUS = {"type": "command", "command": 'python3 "$HOME/.claude/statusline.py"', "padding": 0}
TITLE = {"type": "command", "command": 'python3 "$HOME/.claude/hooks/session-title.py" 2>/dev/null || true', "timeout": 5}

def stop_here(why):
    print(f"  ✗ {path} 을 읽을 수 없습니다 ({why}). 아무것도 바꾸지 않고 멈춥니다.")
    sys.exit(2)

raw = None
try:
    with open(path, encoding="utf-8") as f: raw = f.read()
    s = json.loads(raw) if raw.strip() else {}
except FileNotFoundError:
    s = {}
except ValueError as e:
    stop_here(e)
hooks = s.get("hooks", {}) if isinstance(s, dict) else None
if not isinstance(hooks, dict) or not isinstance(hooks.get("Stop", []), list):
    stop_here("예상과 다른 모양")
if mode == "check":
    sys.exit(0)

changed = False
if s.get("statusLine") == STATUS:
    print("  = statusLine: 이미 설정됨")
else:
    print("  ↺ statusLine: 기존 값을 교체" if s.get("statusLine") else "  + statusLine: 추가")
    s["statusLine"] = STATUS
    changed = True

stop = s.setdefault("hooks", {}).setdefault("Stop", [])
if any("session-title.py" in str(h.get("command") or "")
       for g in stop if isinstance(g, dict) for h in g.get("hooks") or [] if isinstance(h, dict)):
    print("  = Stop 훅: 세션 제목 훅이 이미 있음")
else:
    stop.append({"hooks": [TITLE]})
    print("  + Stop 훅: 세션 제목 훅 추가")
    changed = True

if changed:
    real = os.path.realpath(path)                        # settings.json 이 심링크여도 그 대상에 쓴다
    os.makedirs(os.path.dirname(real), exist_ok=True)
    if raw is not None:
        shutil.copy2(real, f"{real}.bak-{stamp}")
        print(f"    (백업: {os.path.basename(real)}.bak-{stamp})")
    with open(real + ".tmp", "w", encoding="utf-8") as f:
        f.write(json.dumps(s, indent=2, ensure_ascii=False) + "\n")
    os.replace(real + ".tmp", real)
PY
}

# 1. 설정 파일이 깨져 있으면 아무것도 건드리기 전에 멈춘다.
if has python3; then merge_settings check || exit 1; fi

# 2. 파일 연결
echo "파일 연결 ($DIR)"
mkdir -p "$DIR"
for rel in "${FILES[@]}"; do
  src="$REPO/claude/$rel"; dst="$DIR/$rel"
  mkdir -p "$(dirname "$dst")"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "  = $rel: 이미 연결됨"; continue
  fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "  ↺ $rel: 내용이 같은 파일을 링크로 바꿈"
  elif [ -e "$dst" ] || [ -L "$dst" ]; then
    mv "$dst" "$dst.bak-$STAMP"
    echo "  ↺ $rel: 기존 파일을 $rel.bak-$STAMP 로 백업"
  else
    echo "  + $rel"
  fi
  ln -s "$src" "$dst.link-$$" && mv -f "$dst.link-$$" "$dst"   # 교체 순간에도 상태표가 끊기지 않게 한 번에 바꾼다
done

# 3. settings.json
echo "설정 ($SETTINGS)"
if has python3; then
  merge_settings apply
else
  echo "  ! python3 가 없어 건너뜀 — 설치한 뒤 다시 실행하세요"
fi

# 4. mods — 이 폴더를 마켓플레이스로 등록하고 설치한다. 설치본은 이 폴더를 직접 읽으므로
#    이후엔 git pull 뒤 Claude Code 에서 /reload-plugins 만 하면 반영된다.
echo "mods"
if has claude; then
  if claude plugin marketplace list 2>/dev/null | grep -q "❯ $MARKET\$"; then
    echo "  = 마켓플레이스 $MARKET: 이미 등록됨"
  elif claude plugin marketplace add "$REPO" >/dev/null 2>&1; then
    echo "  + 마켓플레이스 $MARKET"
  else
    echo "  ! 마켓플레이스 등록 실패 — 직접: claude plugin marketplace add \"$REPO\""
  fi
  installed="$(claude plugin list 2>/dev/null || true)"
  for mod in "${MODS[@]}"; do
    if grep -q "❯ $mod@$MARKET\$" <<<"$installed"; then
      echo "  = $mod: 이미 설치됨"
    elif claude plugin install "$mod@$MARKET" >/dev/null 2>&1; then
      echo "  + $mod"
    else
      echo "  ! $mod 설치 실패 — 직접: claude plugin install $mod@$MARKET"
    fi
  done
else
  echo "  ! claude 명령이 없어 건너뜀"
fi

# 5. 없으면 일부 칸만 비는 것들
echo "확인"
missing=0
note() { echo "  ! $1"; missing=1; }
has python3 || note "python3 없음 — 상태표 전체가 동작하지 않습니다"
if ! has gh; then note "gh 없음 — PR 번호·링크만 뜨고 상태(✓ · merged)는 안 붙습니다"
elif ! gh auth status >/dev/null 2>&1; then note "gh 로그인 전 — 'gh auth login' 후 PR 상태가 붙습니다"; fi
has claude || note "claude 명령을 못 찾음 — 오른쪽 세션 제목이 안 뜹니다"
[ "$missing" = 0 ] && echo "  ✓ python3 · gh · claude 모두 있음"
echo "완료. 상태표는 다음 갱신부터, 세션 제목 훅과 mods 는 새로 여는 세션부터 확실히 적용됩니다."
