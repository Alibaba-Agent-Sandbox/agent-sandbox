# OCI image to a usable template

The Alibaba adapter exposes `submit_template_build`, `get_template_build`, and `validate_template`. Confirm the selected provider first. AK/SK and explicit Team are required for the official template control plane; the runtime API key alone is insufficient. Another provider needs its own adapter, and these tools explicitly refuse to cross that boundary.

Inspect the supplied image, entrypoint, runtime dependencies, readiness command and image registry access using documented image tooling. Do not invent registry endpoints or claim inspection if it was not run. The adapter defaults to `generation: 2`; startup/readiness commands require generation 2 and are refused with generation 1 before submission. Submit under a unique version name; preserve old template IDs for rollback. The submit tool refuses a known existing name rather than updating it. Record the returned template/request IDs and `submitted` state.

Poll build state and inspect build errors through the documented CLI/API. `submitted` and `building` are not usable. After ready, run `validate_template`; only an executed command, binary round trip and verified temporary-sandbox cleanup establish that probe's acceptance. A business template needs its own business test as well. Keep template cleanup and sandbox cleanup distinct.

Do not update/delete a shared template during another task. New versions require explicit changes to consumers, template cache and warm pools where supported; creating a version does not establish those changes. Rollback means selecting the preserved old version and re-verifying it, not merely keeping an ID in prose.
