# claude-setting 작업 규칙

이 레포는 Claude Code 개인 설정(상태표 · 훅 · mods)이다. **공개 레포다.** 아래 규칙은 이 레포에만 적용한다.

## 시작할 때

- `git status` 와 `git branch --show-current` 를 먼저 본다. `main` 이면 새 브랜치를 판다.
- 새 브랜치는 최신 `origin/main` 에서 딴다.
  ```bash
  git fetch origin && git switch -c <브랜치> origin/main
  ```
- 내가 만들지 않은 미커밋 변경은 건드리지 않는다. graft 가 만드는 `.gitignore` 의 `/graft/` 줄과 `.ignore` 파일은 커밋하지 않는다.
- 이 노트북의 mods 는 레포 폴더를 직접 읽는다. 브랜치를 바꾸면 열린 세션의 mods 도 `/reload-plugins` 때 그 브랜치 코드가 된다.

## 브랜치

| 접두어 | 쓰는 때 |
|---|---|
| `feat/` | 새 기능, 새 mod |
| `fix/` | 고장 고침, 틀린 설명 고침 |
| `docs/` | 문서만 |
| `chore/` | 설치 · 이름 · 설정 정리 |

- `main` 에 직접 커밋 · push 하지 않는다. 반영은 PR merge 로만 한다.
- 한 PR 에는 한 가지만 담는다. 크면 나눈다.

## 커밋

- 파일 하나에 커밋 하나. 리뷰를 파일 단위로 보려고 한다.
- 메시지는 `<대상>: <무엇> — <왜>`. 대상은 파일 이름이나 `<mod>/<파일>`.
  - 예: `session-id/register.tsx: 카드가 UUID 대신 세션 이름을 보여 줌 — 이름이 실제 주소라서`
- 확인한 것이 있으면 본문에 한두 줄로 적는다.

## PR

- 제목은 `[종류] 무엇 — 왜`. 종류는 `Feat` · `Fix` · `Docs` · `Chore` · `Test` · `Refactor`.
  - 예: `[Fix] session-id 가 UUID 대신 세션 이름을 띄운다 — UUID 로는 메시지가 안 간다`
- 본문은 `.github/pull_request_template.md` 의 칸을 채운다. 해당 없는 칸은 "없음".
- push · PR · merge 는 Lucy 가 말한 뒤에 한다. "ㄱㄱ" 한 번이면 그 변경의 push → PR → merge → 이 노트북 설치까지 한다.
- merge 는 merge commit 으로 하고, 브랜치는 merge 뒤 지운다.
- merge 뒤 이 노트북에 반영이 필요하면 `./install.sh` 를 돌리고 결과를 보고한다.

## 검증

순서대로 돌린다.

1. `claude plugin validate mods/<mod>` (타입 검사 포함). 목록 파일을 바꿨으면 `claude plugin validate .` 도.
2. `claude plugin test mods/<mod>`
3. 슬래시 명령이 있는 mod 는 헤드리스로 한 번 돌린다: `claude -p --plugin-dir mods/<mod> "/<명령>"`
4. 화면에 그리는 mod 는 실제 터미널 화면을 보고 확인한다.

- 이번 변경이 만든 실패는 고친다. 원래 있던 실패는 근거를 PR 에 적고 진행한다.
- 실패한 것이나 보지 못한 것을 "통과"로 쓰지 않는다. 못 본 것은 PR 의 "확인 못 한 것"에 적는다.
- `install.sh` 를 바꾸면 격리한 `HOME` · `CLAUDE_CONFIG_DIR` 에서 두 번 돌려 두 번째에 바뀌는 게 없는지 본다.

## mod

- 한 mod 는 `mods/<이름>/` 에 둔다: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts(x)`, `tests/`. state 를 쓰면 `types/index.d.ts` 도.
- 새 mod 는 `.claude-plugin/marketplace.json`, `install.sh` 의 `MODS`, `README.md` 세 곳에 같이 넣는다.
- 동작이나 모양이 바뀌면 `plugin.json` 의 `version` 을 올린다.
- `$` 를 받는 함수는 파일 맨 위 수준에 선언한다. 안쪽 함수로 두면 validate 가 막는다.
- 사람 대신 세션 · 작업을 끄는 mod, merge · auto-merge 를 켜는 mod 는 만들지 않는다.

## 공개 레포

- 회사 · 서비스 · 고객 이름, 내부 URL, 채널 ID, 동료 이름, 비밀 값은 넣지 않는다. 필요하면 mod 설정(`userConfig`, 비밀이면 `sensitive: true`)으로 받는다.
- push-guard 의 `blockedWords` 값은 레포에 적지 않는다.
- 커밋 전에 바뀐 줄을 훑어 위 항목이 없는지 본다.

## 문서

- 한국어 짧은 문장. 은유 없이 있는 그대로 쓴다.
- 비교는 표, 명령은 코드 블록.
- mod 설명 순서: 하는 일 → 설정 → 끄기 → 알아 둘 것(한계 · 주의).
- 틀린 설명을 찾으면 그걸 찾은 PR 에서 같이 고친다.
