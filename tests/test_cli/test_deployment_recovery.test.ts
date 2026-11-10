import "../_support/isolatedHome.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { digest } from "../../src/application/config.js";
import { withApplicationLock, releaseStoppedApplicationLock } from "../../src/application/lock.js";
import { paths, _setPaths } from "../../src/transport/config_layers.js";
import { cli } from "../../src/cli/main.js";
import { readDeployment } from "../../src/cli/deployment_store.js";
import { deploymentSeams } from "../../src/cli/commands/deploy.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
const tmp=useTmpPath(), saved={...paths};
beforeEach(()=>_setPaths({abxDir:path.join(tmp(),"home")}));
afterEach(()=>{vi.restoreAllMocks();_setPaths(saved);});
const lock=(directory:string,identity:string)=>path.join(directory,`${digest(identity).slice(0,32)}.lock`);
describe("local deployment recovery",()=>{
  it("does not unlock a live owner or an owner it cannot inspect",async()=>{
    const directory=path.join(tmp(),"locks");
    await withApplicationLock(directory,"live",async()=>{
      expect(()=>releaseStoppedApplicationLock(directory,"live")).toThrow(/still running/);
      vi.spyOn(process,"kill").mockImplementation(()=>{throw Object.assign(new Error("denied"),{code:"EPERM"});});
      expect(()=>releaseStoppedApplicationLock(directory,"live")).toThrow(/Cannot prove/);expect(fs.existsSync(lock(directory,"live"))).toBe(true);
    });
  });
  it("rejects unknown hosts and concurrent recovery instead of deleting another owner's lock",()=>{
    const directory=path.join(tmp(),"locks");fs.mkdirSync(directory);
    const file=lock(directory,"demo");fs.writeFileSync(file,JSON.stringify({hostname:"other-host",pid:42}));
    expect(()=>releaseStoppedApplicationLock(directory,"demo")).toThrow(/cannot be verified/);
    fs.writeFileSync(`${file}.recovery`,"owned-by-another-reaper");
    expect(()=>releaseStoppedApplicationLock(directory,"demo")).toThrow(/already in progress/);expect(fs.readFileSync(`${file}.recovery`,"utf8")).toBe("owned-by-another-reaper");
    expect(fs.existsSync(file)).toBe(true);
  });
  it("observes a real SIGINT interruption without replaying its saved creation intent",async()=>{
    const root=fileURLToPath(new URL("../../",import.meta.url)), home=paths.abxDir, script=path.join(tmp(),"interrupted.mts");
    fs.writeFileSync(script,`
import {withApplicationLock} from ${JSON.stringify(path.join(root,"src/application/lock.ts"))};
import {paths} from ${JSON.stringify(path.join(root,"src/transport/config_layers.ts"))};
import {saveDeployment} from ${JSON.stringify(path.join(root,"src/cli/deployment_store.ts"))};
import {ResourceJournal} from ${JSON.stringify(path.join(root,"src/template/resource_journal.ts"))};
paths.abxDir=${JSON.stringify(home)};
process.on('SIGINT',()=>process.exit(130));
await withApplicationLock(${JSON.stringify(path.join(home,"deployment-locks"))},'interrupted',async()=>{
 const journal=new ResourceJournal('alicloud-express','test');
 await journal.intent({kind:'sandbox',correlation_key:'interrupted-create',cleanup:'sandbox.delete'});
 saveDeployment({version:1,name:'interrupted',kind:'sandbox',provider:'alicloud-express',status:'preparing',journal:journal.file,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 console.log('locked');setInterval(()=>{},1000);await new Promise(()=>{});
});`);
    const child=spawn(process.execPath,["--import","tsx",script],{cwd:root,stdio:["ignore","pipe","pipe"]});
    try {
      await new Promise<void>((resolve,reject)=>{let output="";child.stdout.on("data",data=>{output+=data;if(output.includes("locked"))resolve();});child.once("error",reject);child.once("exit",code=>reject(new Error(`Child exited before lock: ${code}`)));});
      const exited=once(child,"exit");child.kill("SIGINT");await exited;
      const directory=path.join(home,"deployment-locks");expect(fs.existsSync(lock(directory,"interrupted"))).toBe(true);
      const launch=vi.spyOn(deploymentSeams,"launch");const result=await new CliRunner().invoke(cli,["--json","recover","interrupted"]);
      expect(result.exit_code,result.output).toBe(0);expect(JSON.parse(result.stdout).resources).toEqual([expect.objectContaining({state:"intent",correlation_key:"interrupted-create"})]);
      expect(launch).not.toHaveBeenCalled();expect(fs.existsSync(lock(directory,"interrupted"))).toBe(false);
      const value=readDeployment("interrupted")!;expect(JSON.parse(fs.readFileSync(value.journal!,"utf8")).entries[0].state).toBe("intent");
    } finally {if(child.exitCode===null)child.kill("SIGKILL");}
  },15000);
  it("keeps a lock left by another hostname even when the PID is absent locally",()=>{
    const directory=path.join(tmp(),"locks");fs.mkdirSync(directory);const file=lock(directory,"remote");
    fs.writeFileSync(file,JSON.stringify({hostname:os.hostname()+"-elsewhere",pid:2147483647}));
    expect(()=>releaseStoppedApplicationLock(directory,"remote")).toThrow(/cannot be verified/);expect(fs.existsSync(file)).toBe(true);
  });
});
