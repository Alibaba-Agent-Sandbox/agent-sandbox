/** Public parser-to-service integration. Cloud services are stubbed; this is not cloud acceptance. */
import "../_support/isolatedHome.js";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { Sandbox as NativeSandbox } from "../../src/standard_cli/runtime.mjs";
import { cli } from "../../src/cli/main.js";
import { managementSeams } from "../../src/cli/commands/deployment_management.js";
import { AuthenticationError, QuotaExceededError, SandboxNotFoundError, TemplateNotFoundError } from "../../src/models/errors.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { paths, _setPaths } from "../../src/transport/config_layers.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
useMockCloudConfiguration();
const tmp=useTmpPath(), originalPaths={...paths};
const id="sbx-cli-test-001";
const info=()=>SandboxInfo.modelValidate({sandboxID:id,templateID:"base",status:"running",region:"cn-hangzhou",envdAccessToken:"private-runtime-authorization"});
const invoke=(args:string[])=>new CliRunner().invoke(cli,args);
beforeEach(()=>_setPaths({abxDir:path.join(tmp(),"home")}));
afterEach(()=>{vi.restoreAllMocks();_setPaths(originalPaths);});
function create() { return vi.spyOn(Sandbox,"create").mockResolvedValue({id,info:info(),status:"running",provider:"alicloud-express",url:"https://example.test",close:async()=>{}} as unknown as Sandbox); }
function execution(exitCode=0) {
  vi.spyOn(process.stdin,Symbol.asyncIterator).mockImplementation(async function*(){});
  return vi.spyOn(NativeSandbox,"connect").mockResolvedValue({commands:{supportsStdinClose:true,
    closeStdin:async()=>{},run:async(_command:string,options:{onStdout(data:string):void})=>{
      options.onStdout("hello\n");return {pid:7,wait:async()=>({exitCode}),kill:async()=>{},disconnect:async()=>{}};
    }}} as unknown as NativeSandbox);
}
it("test_cli_create_exec_kill",async()=>{
  create();execution();let deleted=false;
  const kill=vi.spyOn(Sandbox,"killById").mockImplementation(async()=>{deleted=true;});
  vi.spyOn(Sandbox,"getInfoById").mockImplementation(async()=>{if(deleted)throw new SandboxNotFoundError(id);return info();});
  let r=await invoke(["sandbox","create","--template","base","--yes"]);expect(r.exit_code,r.output).toBe(0);
  r=await invoke(["sandbox","exec",id,"echo","hello"]);expect(r.exit_code,r.output).toBe(0);expect(r.stdout).toContain("hello");
  r=await invoke(["sandbox","delete",id,"--yes"]);expect(r.exit_code,r.output).toBe(0);expect(kill).toHaveBeenCalledWith(id);expect(deleted).toBe(true);
});
it("test_cli_json_output",async()=>{
  create();const r=await invoke(["--json","sandbox","create","--template","base","--yes"]);
  expect(r.exit_code,r.output).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({ID:id,Status:"running"});
});
it("test_cli_exec_json_output",async()=>{
  execution();const r=await invoke(["--json","sandbox","exec",id,"echo","hello"]);
  expect(r.exit_code,r.output).toBe(0);expect(JSON.parse(r.stdout)).toEqual({stdout:"hello\n",stderr:"",exit_code:0});
});
it("test_cli_exec_nonzero_exit",async()=>{
  execution(17);const r=await invoke(["--json","sandbox","exec",id,"false"]);
  expect(r.exit_code).toBe(17);expect(JSON.parse(r.stdout).exit_code).toBe(17);
});
for(const [title,error] of [
  ["test_cli_error_template_not_found",new TemplateNotFoundError("Template not found")],
  ["test_cli_error_quota_exceeded",new QuotaExceededError("Sandbox quota exceeded")],
  ["test_cli_error_auth",new AuthenticationError("Invalid API key")],
] as const) it(title,async()=>{
  const request=vi.spyOn(Sandbox,"create").mockRejectedValue(error);
  const r=await invoke(["sandbox","create","--template","base","--yes"]);
  expect(r.exit_code).not.toBe(0);expect(r.output+r.stderr).toContain(error.message);expect(request).toHaveBeenCalledTimes(1);
});
it("test_cli_list_sandboxes",async()=>{
  vi.spyOn(managementSeams,"list").mockResolvedValue([info()]);
  const r=await invoke(["--json","list"]);expect(r.exit_code,r.output).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({items:[{sandbox_id:id,observation:"remote"}],partial:false,errors:[]});
});
it("test_cli_info_command",async()=>{
  vi.spyOn(managementSeams,"info").mockResolvedValue(info());
  const connect=vi.spyOn(Sandbox,"connect");
  const r=await invoke(["status",id]);expect(r.exit_code,r.output).toBe(0);expect(r.output).toContain(id);expect(connect).not.toHaveBeenCalled();
  expect(r.output).toContain("running");expect(r.output).not.toContain("private-runtime-authorization");
  const json=await invoke(["--json","status",id]);expect(JSON.parse(json.stdout)).toMatchObject({sandbox_id:id,status:"running"});expect(json.output).not.toContain("envd_access_token");
});
it("test_cli_quiet_mode",async()=>{
  create();const r=await invoke(["--quiet","sandbox","create","--template","base","--yes"]);
  expect(r.exit_code,r.output).toBe(0);expect(r.output).toContain(id);expect(r.stderr).not.toContain("Deploy demo?");
});
