# Security policy

## Patched advisory

`bigint-buffer@1.1.5` has no patched upstream release for
`GHSA-3gc7-fjrx-p6mg`. Tissue applies
`patches/bigint-buffer@1.1.5.patch`, which disables the vulnerable native
converter and forces the memory-safe JavaScript implementation. The advisory is
ignored by `pnpm audit` only after that local mitigation is applied through the
lockfile's `patchedDependencies` entry.

Do not remove the patch while the audit exception exists. CI's frozen-lockfile
install fails if the patch and lockfile diverge.
