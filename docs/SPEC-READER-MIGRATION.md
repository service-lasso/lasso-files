# Files reader migration

Active documentation scope: Files #22, Core #1419 / #1265, SPEC-002 AC-4AJ.3.

Exactly README.md and docs/migration.md gain the canonical Core app-service reader entry point. Preserve all existing source-owned URL/API/migration content at develop 24daa58f3420d3803b07db336200c789d147cc4a, including source-aware workspaces, authorization, runtime configuration limits and app-owned file behavior.

Acceptance: both destinations exist and are merged; component text is unchanged; diff and exact-head hosted gates pass. Develop-only issue branch and PR; no product implementation, publication or new runtime/platform acceptance. Core #1425 must deliver the destination before closure.
Development validation: the existing release workflow must validate pull requests targeting `develop`. Correct its stale PR branch filter so this documentation candidate receives the existing platform checks; do not change publication conditions or dispatch a release.
