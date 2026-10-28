# CLI capture: Default saved configuration

Command: `ABX_CAPTURE_ONBOARDING=1 node e2e/onboarding.mjs`.

The built CLI runs in a real POSIX terminal with a fresh isolated home. This capture uses a hidden placeholder platform key and declines billable creation. ANSI/redraw frames are collapsed and the local journal UUID is masked. No cloud resource or actual credential is included.

```text
? Choose an authentication method
❯ sandbox_api_key
  access_key_id + access_key_secret
  Cancel

↑↓ navigate • ⏎ select✔ Choose an authentication method sandbox_api_key
Provider: alicloud-express · Region: cn-hangzhou · API host: api.cn-hangzhou.e2b.fc.aliyuncs.com
Get your Sandbox API key: Agent Sandbox console > Express > API Keys, in the selected region. https://help.aliyun.com/zh/agent-sandbox/getting-started/create-api-key
? sandbox_api_key (input hidden); Enter cancels
✔ sandbox_api_key (input hidden); Enter cancels ************************
Configuration saved.
? Create a billable sandbox from this template? (y/N)? Create a billable sandbox from this template? (y/N) n✔ Create a billable sandbox from this template? No
[E8002] Template preparation failed. Inspect recovery journal <JOURNAL_ID> before retrying any submitted operation.
```

The existing preparation diagnostic after declining the billing confirmation is retained above; this scenario verifies that cancellation submits no cloud work. Positive actual Express creation, business use, default-saved credential reuse and independent cleanup are recorded in [verification](../verify/2026-10-28-default-saved-guidance.md).
