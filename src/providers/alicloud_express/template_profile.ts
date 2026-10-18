/** Image/runtime defaults owned by Express. */
export const TEMPLATE_PROFILE: import("../template_profile.js").ProfileFields = {
  base_image: "fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>",
  entrypoint_replaceable: false,
  server_start: "platform_start_cmd",
  cmd: null,
  start_cmd: "agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py",
  ready_cmd: "agent-sandbox-server healthcheck --port 9000",
  arch: "linux/amd64",
  user: "user",
  workdir: "/home/user/app",
  reserved_ports: [49983, 5000, 49999],
  registry:
    "public pull; image region must equal the sandbox region; a non-matching FROM takes platform copy + envdInject; no ACR image acceleration",
};
