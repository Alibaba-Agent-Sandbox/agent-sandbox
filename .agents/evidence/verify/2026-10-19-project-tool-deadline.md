# Verification: project tool deadline rounding

Result: PARTIAL

Before the fix, the actual built runTool helper raised RangeError for timeouts 1.001 and 1.003 seconds because execFile received noninteger milliseconds. A normal 179.999-second timeout passed, explaining why a successful native run alone did not catch this boundary.

The scoped fix rounds only the milliseconds conversion. Regression uses a real subprocess and 8.001 seconds. Required local/hosted checks and the provider native rerun are tracked in this follow-up PR. No cloud resources are created by the regression. Broader Express/native receipts remain preserved in the original launch evidence and PR71; the normal launch public contract and Beta limits do not change.
