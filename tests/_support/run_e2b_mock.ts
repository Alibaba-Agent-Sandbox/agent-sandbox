import { startE2BMock } from "./e2b_mock.js";

/** Starts the E2B-shaped mock for tests in other languages; prints `{"port": N}` and runs until stdin closes. */
const mock = await startE2BMock();
if (process.env["E2B_MOCK_ENVD_SELF"] === "1") mock.flags.envdUrl = mock.origin;
if (process.env["E2B_MOCK_UNAUTHORIZED"] === "1") mock.flags.unauthorized = true;
const connectStatus = Number(process.env["E2B_MOCK_CONNECT_STATUS"] ?? "");
if (Number.isFinite(connectStatus) && connectStatus > 0) mock.flags.connectStatus = connectStatus;
process.stdout.write(`${JSON.stringify({ port: mock.port })}\n`);
process.stdin.resume();
process.stdin.on("end", () => {
  void mock.close().then(() => process.exit(0));
});
