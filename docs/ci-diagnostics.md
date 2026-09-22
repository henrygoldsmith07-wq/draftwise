# CI diagnostics

The latest `main` CI run at the time of this change was successful ([run 35691381021](https://github.com/henrygoldsmith07-wq/draftwise/actions/runs/35691381021)). The three visible failures in the public run history were Dependabot pull requests, not `main`:

- [lucide-react update, PR #7](https://github.com/henrygoldsmith07-wq/draftwise/pull/7), run [35440372514](https://github.com/henrygoldsmith07-wq/draftwise/actions/runs/35440372514)
- [vinext update, PR #6](https://github.com/henrygoldsmith07-wq/draftwise/pull/6), run [35440371189](https://github.com/henrygoldsmith07-wq/draftwise/actions/runs/35440371189)
- [workers-types update, PR #4](https://github.com/henrygoldsmith07-wq/draftwise/pull/4), run [35440366432](https://github.com/henrygoldsmith07-wq/draftwise/actions/runs/35440366432)

All three failed at `npm ci --ignore-scripts`; type-check, tests, evaluation, lint, extension build, and application build were skipped. The public log endpoint did not expose the individual npm error without authentication, so the exact package-manager message cannot be claimed. The later `main` run completed successfully. The failure pattern is therefore dependency-update branch specific, with installation as the first common failing stage; it is not evidence of a failing test or build on current `main`. PR #6 also updates `vinext` to a release whose peer requirement for `@vitejs/plugin-rsc` is newer than the version pinned by that branch, making peer-resolution failure a concrete hypothesis to verify in an authenticated rerun.

The repository now has a manual release-validation workflow that runs the offline rule/triage gates, the triage A/B benchmark, performance benchmark, lint, extension bundle diff, application build diff, and an optional full live classifier evaluation. It uploads the machine-readable reports so a future dependency failure can be distinguished from a product regression.
