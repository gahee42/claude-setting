# claude-setting

Claude Code 상태표(status line)와 mods 개인 설정. 기기마다 같은 환경을 쓰려고 모아 둔다.

```
Opus 5  my-app  feature/login-page !2                     로그인 화면 정리
ctx 31%  cost $14.89  time 35m28s                    PR #128 ✓ #125 merged
5h 9% ↻19:00  7d 65% ↻2d13h  Fable 70% ↻2d13h
```

- **1줄**: 모델 · 레포 · 브랜치(변경 수), 오른쪽에 **세션 제목**(첫 대화를 작은 모델이 요약)
- **2줄**: 컨텍스트 · 비용 · 경과 시간, 오른쪽에 **이 세션이 만든 아티팩트**와 **올린 PR**
  - 아티팩트 제목이나 PR 번호를 **Cmd+클릭**하면 열린다
  - 아티팩트는 최근 2개(넘으면 `+N`)다. 제목은 발행한 페이지의 `<title>`, 없으면 파일 이름이다. 지운 아티팩트는 빠진다. 폭이 모자라면 PR 을 남기고 아티팩트가 먼저 빠진다
  - `✓` CI 통과 · `✗` 실패 · `⋯` 도는 중 · `draft` · `merged` · `closed`, 3개를 넘으면 `+N`
- **3줄**: 5시간 · 7일 · 모델별 주간 사용량과 초기화 시각, 오른쪽에 **세션 ID 앞 8자리**(다른 세션에 일을 보낼 때. 전체는 `/sid`)
- 오른쪽 칸(제목 · 아티팩트 · PR · 세션 ID)은 끝을 맞춘 알약이고, 앞에 Nerd Font 아이콘이 붙는다

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
| mods 가 등록·설치돼 있지 않다 | 이 폴더를 mod 목록 `my-mods` 로 등록하고 `push-guard` · `mem-band` · `session-id` 를 설치한다. 이미 있으면 건너뛴다 |
| 예전 이름 `claude-setting` 으로 등록돼 있다 | 예전 등록을 지우고 `my-mods` 로 다시 단다 |
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
- `SID_LINE = -1` — 세션 ID 칸 끄기
- `ART_LINE = -1` — 아티팩트 칸 끄기 (`ART_MAX` 개수, `ART_TITLE_MAX` 제목 폭)
- `RIGHT_ICONS = False` — 오른쪽 칸의 아이콘 끄기(`PR` · `sid` 글자로 돌아간다)
- `LINES` — 줄 구성과 순서

## mods

Claude Code 안에서 도는 작은 플러그인. `install.sh` 가 이 폴더를 mod 목록 `my-mods` 로 등록하고 설치한다. 설치본이 이 폴더를 직접 읽으므로 이후엔 `git pull` 뒤 Claude Code 에서 `/reload-plugins` 만 하면 반영된다.

mod 목록은 Claude Code 용어로 마켓플레이스다. 외부 장터가 아니라 "어떤 mod 가 어느 폴더에 있는지" 적은 파일(`.claude-plugin/marketplace.json`) 하나다. Claude Code 는 계속 켜 둘 플러그인을 이런 목록을 거쳐서만 설치하므로 필요하다. 그래서 mod 이름이 `push-guard@my-mods` 처럼 `mod@목록` 꼴이 된다.

| mod | 하는 일 |
|---|---|
| `push-guard` | `git push` · `gh repo create --push` 전에 확인을 받는다. 방금 직접 보낸 메시지에 push · 푸시 · 올려 같은 말이 있으면 묻지 않는다. 공개 레포로 가는 push 는 올라갈 커밋(추가된 줄과 커밋 메시지)에서 막아 둔 말을 찾아, 있으면 파일 이름과 함께 막는다 |
| `mem-band` | 15초마다 macOS 메모리 여유를 읽는다. 25% 밑이면 입력창 위에 한 줄, 12% 밑이면 토스트를 한 번 띄우고 무거운 명령(브라우저 테스트 · docker build 등)은 실행 전에 묻는다 |
| `session-id` | `sid 앞8자리` 를 보여 주고(터미널은 상태표 셋째 줄 오른쪽, 데스크톱 앱은 입력창 오른쪽), `/sid` 로 전체 세션 ID 를 복사한다. 다른 세션에 "세션 `<ID>` 에 …라고 전해 줘" 처럼 붙여 넣으면 그 세션으로 메시지가 간다 |

설정은 Claude Code 의 `/plugin` 메뉴에서 바꾸고, 터미널에서는 `claude plugin configure push-guard@my-mods` 로 현재 값을 본다. 값은 기기마다 따로 저장된다.

- `blockedWords` — 공개 레포에 올리면 안 되는 말(쉼표 구분). **레포에는 적지 않는다.** 이 기기의 보안 저장소에만 들어가고, 비어 있으면 검사하지 않는다.
- `publicRepos` — `gh` 로 공개 여부를 못 볼 때도 공개로 볼 레포(`owner/repo`, 쉼표 구분).
- `askOnPush` · `trustPrompt` — push 전 확인, 요청 직후에는 묻지 않기.
- mem-band 는 `warnAt` · `askBelow` · `heavyCommands`(정규식).

끄기: `claude plugin disable push-guard@my-mods`

알아 둘 것

- push-guard 는 사람이 직접 보낸 메시지(터미널 입력, 폰의 Remote Control)만 요청으로 본다. `claude -p`, 예약 작업, 다른 세션이 시작한 턴에서는 요청 없는 push 를 막는다.
- 공개 여부는 `gh repo view` 로 본다. `gh` 가 없거나 볼 수 없는 레포(회사 org 등)는 공개로 보지 않는다. 필요하면 `publicRepos` 에 적는다.
- 금지어 검사는 현재 브랜치(HEAD)가 upstream 보다 앞선 커밋만 읽는다. 다른 브랜치를 이름으로 push 하면 그 브랜치는 읽지 않는다.
- session-id 의 입력창 오른쪽 칸은 데스크톱 앱 Code 탭에서만 쓴다. 터미널에서 그 칸을 쓰면 입력창과 상태표가 그만큼 화면 높이 내내 좁아져 빈 칸이 남고 상태표 오른쪽 알약이 `…` 로 잘려서, 터미널에서는 상태표(`statusline.py` 의 `SID_LINE`)가 대신 보여 준다. `/sid` 는 어디서나 된다. 받는 세션이 권한 모드가 다르면 메시지를 바로 읽지 않고 그쪽 사람의 승인을 기다린다.
- mod API 는 아직 early access 라 Claude Code 버전마다 바뀔 수 있다. 기기끼리 버전을 맞춘다. 테스트는 `claude plugin test mods/push-guard`.

## 어떻게 동작하나

- **세션 제목**: 첫 답변이 끝날 때(`Stop` 훅) `hooks/session-title.py` 가 `claude -p --model haiku` 로 한 번 요약해 `~/.claude/session-titles/` 에 둔다.
- **PR**: Claude Code 가 세션 기록(transcript)에 `gh pr create` · `gh pr edit` 결과를 `gitOperation.pr` 로 남긴다. 새로 붙은 부분만 읽는다. 명령에 `gh pr create` 라는 글자만 들어가도 기록이 찍히는 오탐이 있어서, 출력에 PR 주소가 한 줄로 단독 찍힌 것만 믿는다. 상태·CI 는 백그라운드에서 `gh pr view` 로 받아 캐시한다(열린 PR 60초, 머지·종료 1시간).
- **사용량**: 5h·7d 는 Claude Code 가 넘겨주는 값, 모델별 주간 한도는 `statusline-usage.py` 가 5분마다 백그라운드로 받는다.

## 레포에 없는 것

`~/.claude/settings.json` 은 통째로 올리지 않는다 — 기기·회사마다 다른 설정(권한, auto mode 환경 설명, 다른 훅)이 섞여 있다. `install.sh` 가 필요한 두 항목(`statusLine`, 세션 제목 `Stop` 훅)만 넣는다. 대화 기록(`projects/`, `history.jsonl`)과 캐시도 올리지 않는다.
