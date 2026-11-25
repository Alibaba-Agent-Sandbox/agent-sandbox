# Guided configuration and template preparation

The following English excerpts come from isolated terminal and Docker runs. Configuration used
placeholder credentials. The Docker run used a placeholder credential pair and stopped before
push or registration. Terminal rendering and working directories are shortened.

Input: `abx config init` with a different Sandbox key supplied by the project dotenv.

```text
Provider: alicloud-express · Region: cn-hangzhou
Saved sandbox_api_key locally. Still using ABX_SANDBOX_API_KEY in .env. Update or remove that override to use the saved value.
Configuration complete. Saved locally. Review with 'abx config list'.
```

Input: `abx --json deploy ./fixture --yes` with Docker available and ACR namespace missing.

```text
Missing configuration for Build and deploy template:
  - acr_namespace: abx config set providers.alicloud-express.acr_namespace
```

Input: same deployment after supplying the ACR namespace, with a Dockerfile instruction that exits 23.

```text
[E7020] Docker build failed (exit 23): a build instruction failed. Inspect recovery journal <JOURNAL_FILE> before retrying.
```
