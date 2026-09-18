# claude-setting

Claude Code 상태표(status line) 개인 설정. 기기마다 같은 상태표를 쓰려고 모아 둔다.

```
Opus 5  my-app  feature/login-page !2                     로그인 화면 정리
ctx 31%  cost $14.89  time 35m28s                    PR #128 ✓ #125 merged
5h 9% ↻19:00  7d 65% ↻2d13h  Fable 70% ↻2d13h
```

- **1줄**: 모델 · 레포 · 브랜치(변경 수), 오른쪽에 **세션 제목**(첫 대화를 작은 모델이 요약)
- **2줄**: 컨텍스트 · 비용 · 경과 시간, 오른쪽에 **이 세션이 올린 PR**
  - 번호를 **Cmd+클릭**하면 PR이 열린다
  - `✓` CI 통과 · `✗` 실패 · `⋯` 도는 중 · `draft` · `merged` · `closed`, 3개를 넘으면 `+N`
- **3줄**: 5시간 · 7일 · 모델별 주간 사용량과 초기화 시각

## 설치

```bash
git clone https://github.com/gahee42/claude-setting.git ~/lucy/claude-setting
~/lucy/claude-setting/install.sh
```

`install.sh` 가 하는 일 — 여러 번 실행해도 결과가 같다.

| 상황 | 처리 |
|---|---|
| `~/.claude` 에 같은 파일이 없다 | 이 레포 파일로 심링크를 건다 |
| 이미 이 레포로 연결돼 있다 | 건너뛴다 |
| 내용이 같은 파일이 있다 | 백업 없이 링크로 바꾼다 |
| 내용이 다른 파일이 있다 | `파일.bak-날짜시각` 으로 백업한 뒤 링크로 바꾼다 |
| `settings.json` 에 다른 상태표가 있다 | 백업한 뒤 `statusLine` 만 교체 |
| 세션 제목 훅이 이미 있다 | 중복으로 넣지 않는다. 다른 훅·설정은 건드리지 않는다 |
| `settings.json` 이 깨져 있다 | 아무것도 바꾸지 않고 멈춘다 |
| `python3` · `gh` · `claude` 가 없다 | 설치는 진행하고 무엇이 빠졌는지 알려 준다 |

심링크라서 이후엔 `git pull` 만 하면 바로 반영된다. 반대로 이 폴더를 지우거나 옮기면 상태표가 사라지니, 옮긴 뒤엔 `install.sh` 를 다시 실행한다.

## 필요한 것

| 없으면 | 결과 |
|---|---|
| `python3` | 상태표 전체가 안 뜬다 |
| `gh` + `gh auth login` | PR 번호·링크만 뜨고 상태(`✓` · `merged`)는 안 붙는다 |
| `claude` 로그인 | 세션 제목, 모델별 주간 사용량이 안 뜬다 (토큰은 macOS 키체인에서 읽는다) |
| Nerd Font (예: MesloLGS NF) | 칩 양 끝의 둥근 모양이 네모로 깨진다 |
| OSC 8 링크를 지원하는 터미널 (Ghostty · iTerm2 · Kitty · WezTerm) | PR 번호를 눌러도 안 열린다 |

## 끄기 · 고치기

`claude/statusline.py` 맨 위 `user knobs` 에서 바꾼다.

- `TITLE_LINE = -1` — 세션 제목 끄기
- `PR_LINE = -1` — PR 칸 끄기
- `LINES` — 줄 구성과 순서

## 어떻게 동작하나

- **세션 제목**: 첫 답변이 끝날 때(`Stop` 훅) `hooks/session-title.py` 가 `claude -p --model haiku` 로 한 번 요약해 `~/.claude/session-titles/` 에 둔다.
- **PR**: Claude Code 가 세션 기록(transcript)에 `gh pr create` · `gh pr edit` 결과를 `gitOperation.pr` 로 남긴다. 새로 붙은 부분만 읽는다. 명령에 `gh pr create` 라는 글자만 들어가도 기록이 찍히는 오탐이 있어서, 출력에 PR 주소가 한 줄로 단독 찍힌 것만 믿는다. 상태·CI 는 백그라운드에서 `gh pr view` 로 받아 캐시한다(열린 PR 60초, 머지·종료 1시간).
- **사용량**: 5h·7d 는 Claude Code 가 넘겨주는 값, 모델별 주간 한도는 `statusline-usage.py` 가 5분마다 백그라운드로 받는다.

## 레포에 없는 것

`~/.claude/settings.json` 은 통째로 올리지 않는다 — 기기·회사마다 다른 설정(권한, auto mode 환경 설명, 다른 훅)이 섞여 있다. `install.sh` 가 필요한 두 항목(`statusLine`, 세션 제목 `Stop` 훅)만 넣는다. 대화 기록(`projects/`, `history.jsonl`)과 캐시도 올리지 않는다.
