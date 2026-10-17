#!/usr/bin/env bash
# PreToolUse hook: block git push while on main/master. Exit 0 = allow, 2 = block.
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).tool_input?.command||'')}catch{console.log('')}})")

# Only care about git push
case "$COMMAND" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

BRANCH=$(git branch --show-current 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] || [[ "$COMMAND" == *":main"* ]] || [[ "$COMMAND" == *" main"* ]]; then
  echo "Blocked: pushing to main is not allowed. Create a feature branch: git checkout -b feature/<JIRA-KEY>-desc" >&2
  exit 2
fi
exit 0