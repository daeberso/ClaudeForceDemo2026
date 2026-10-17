# My Sandbox Project

Salesforce DX project for learning Claude Code. Target org alias: `ClaudeForceDemo2026`.

## Rules
- API version must match `sourceApiVersion` in `sfdx-project.json`.
- Apex classes use `with sharing` unless a comment justifies otherwise.
- Use `WITH USER_MODE` on SOQL for CRUD/FLS enforcement.
- One trigger per object; logic lives in a `<Object>TriggerHandler` class.
- Every Apex class gets a test class: positive, negative, and bulk (200 records).
- Never deploy without asking me first.

## Workflow
- Before writing code, explain the plan in Salesforce terms and wait for my OK.
- Update `manifest/package.xml` with explicit members when adding components.


## Git / GitHub
- Repo: github.com/daeberso/ClaudeForceDemo2026
- Never commit or push to `main`. Create a feature branch named `feature/<JIRA-KEY>-short-desc`.
- Commit messages start with the Jira key, e.g. `CFD-1: Add AccountService`.
- Open PRs with `gh pr create`; include the Jira link and a test summary in the body.
- Ask before pushing.