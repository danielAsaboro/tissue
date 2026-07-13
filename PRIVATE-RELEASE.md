# Private release procedure

This project must remain private throughout the competition and until the user explicitly
authorizes publication after it has ended. The workflow
`.github/workflows/private-release.yml` is deliberately manual and has only `contents: read`; it
cannot push packages, deploy services, change repository visibility, or publish a release.

## Produce reviewable artifacts

1. Run the normal CI workflow and require it to pass.
2. Build the images locally and require `pnpm verify:containers` to pass.
3. Manually dispatch **Private release artifacts** from the private repository.
4. Retain the three private Actions artifacts. Each contains an OCI image, BuildKit provenance,
   an SBOM attestation, and a SHA-256 checksum named for the exact Git commit.
5. Verify every downloaded artifact before loading it:

   ```bash
   sha256sum --check tissue-daemon.sha256
   sha256sum --check tissue-analyst.sha256
   sha256sum --check tissue-dashboard.sha256
   ```

6. Load or inspect only the verified OCI artifacts in the chosen private staging environment.
7. Record the workflow run, commit SHA, artifact SHA-256 values, staging health checks, and the
   previous known-good digests in the private evidence log.

## Promotion gate

Do not add registry credentials, `packages: write`, OIDC signing, a deploy job, a public hostname,
or a repository-visibility change during the competition. A private staging target still requires
the user to name it and explicitly approve that external action. After the competition has ended,
publication remains separately gated on explicit owner approval. When a target is selected, add:

- a protected GitHub environment with required approval;
- a private registry and keyless provenance/signature policy;
- deployment by immutable digest, never a mutable tag;
- post-deploy `/health`, `/ready`, `/verify`, dashboard, SSE, and failure-recovery checks;
- durable collection and alerts for both `/metrics` endpoints and structured container logs;
- one-command rollback to the recorded previous digest.
