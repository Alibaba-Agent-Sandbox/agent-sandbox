import '../_support/isolatedHome.js';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context, command } from '../../src/cli/kit.js';
import * as guidance from '../../src/cli/config_guidance.js';
import { executeTemplateLaunch, launchSeams } from '../../src/cli/template_launch.js';
import { withTemplateEnvironment, applicationToken } from '../../src/cli/template_environment.js';
import type { CreateOptions } from '../../src/api/sandbox.js';
import { RegistryClient } from '../../src/utils/registry.js';
import { CLI_EXTENSION } from '../../src/providers/alicloud_express/cli/extension.js';
import { configSeams } from '../../src/cli/commands/config_cmd.js';
import * as configCommands from '../../src/cli/commands/config_cmd.js';
import { useIso } from '../_support/iso.js';
import { storagePatch } from '../helpers/configSupport.js';
import { dotenvValues } from '../../src/utils/_dotenv.js';
import { useCapsys } from './conftest.js';

const iso = useIso();
const cap = useCapsys();
let restore: () => void;
beforeEach(() => {
  const old = { ...configSeams };
  Object.assign(configSeams, storagePatch(iso.home, {env:true}));
  restore = () => Object.assign(configSeams, old);
});
afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const ctx = () => new Context(command('launch'));
function answers(...values: string[]) {
  vi.spyOn(guidance, 'canGuideConfiguration').mockReturnValue(true);
  vi.spyOn(guidance.guidanceSeams, 'interactive').mockReturnValue(true);
  return vi.spyOn(guidance.guidanceSeams, 'ask').mockImplementation(async (label) => {
    if (label === 'Choose an authentication method') return '1';
    if (!values.length) throw new Error('Unexpected configuration question');
    return values.shift()!;
  });
}
function source() {
  const dir = path.join(iso.root, 'app'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'template.yaml'), JSON.stringify({name:'audit-app',spec_version:5,
    provides:{app:{protocol:'agent-sandbox-server',version:2,port:9000,operations:['commands.list','commands.run']}}, env:{ABX_SERVER_TOKEN:''}}));
  vi.spyOn(CLI_EXTENSION, 'stageProject').mockResolvedValue({directory:dir,digest:'fixture',verify:async()=>{},close:async()=>{}} as never);
  const prepare = vi.spyOn(CLI_EXTENSION, 'prepareProject').mockResolvedValue({reference:'prepared-app',status:'ready',identity:{native_version:'prepared-app'},owned_resources:[]});
  const list = vi.fn(async () => []);
  const sandbox = {id:'owned-test',status:'running',url:'https://example.invalid',info:{template:'prepared-app'},
    network:{resolveEndpoint:vi.fn(async()=>({url:'https://app.example.invalid'}))},
    verifyApplicationOperation:vi.fn(async()=>{}),listCommands:list,close:vi.fn(async()=>{}),kill:vi.fn(async()=>{})};
  const create=vi.spyOn(launchSeams,'create').mockResolvedValue(sandbox as never);
  return {dir,prepare,create,list};
}

describe('template application setup', () => {
  it.each(['local','remote'])('fills missing platform and application inputs, then creates once: %s', async kind => {
    const f=source();
    const ask=answers('1','placeholder-platform');
    vi.spyOn(RegistryClient.prototype,'fetch').mockResolvedValue(f.dir);
    const before={...process.env};
    await executeTemplateLaunch(ctx(),{template_ref:kind==='local'?f.dir:'owner/repo//app'});
    const token=dotenvValues(iso.env).get('ABX_SERVER_TOKEN');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(ask).toHaveBeenCalledTimes(3);
    expect(f.prepare).toHaveBeenCalledOnce();expect(f.create).toHaveBeenCalledOnce();
    expect((f.create.mock.calls[0]![0] as CreateOptions).envs).toEqual({ABX_SERVER_TOKEN:token});
    expect(f.list).toHaveBeenCalledWith(expect.objectContaining({application_token:token}));
    expect(applicationToken()).toBe(token);
    expect(process.env).toEqual(before);
    const output=Object.values(cap.readouterr()).join('');
    expect(output).toContain('Application authentication configured automatically');
    expect([...dotenvValues(iso.env).keys()]).toEqual(['ABX_SERVER_TOKEN']);
    expect(fs.statSync(iso.env).mode & 0o777).toBe(0o600);
    expect(output).not.toContain(token);expect(output).not.toContain('placeholder-platform');
  });
  it('carries command-only platform and application credentials through launch without saving them', async () => {
    const f=source();
    const ask=answers('1','placeholder-platform');
    await executeTemplateLaunch(ctx(),{template_ref:f.dir}, {envs:{ABX_SERVER_TOKEN:'placeholder-application'}});
    expect(ask).toHaveBeenCalledTimes(3);
    expect(f.prepare).toHaveBeenCalledOnce();expect(f.create).toHaveBeenCalledOnce();
    expect((f.create.mock.calls[0]![0] as CreateOptions).envs).toEqual({ABX_SERVER_TOKEN:'placeholder-application'});
    expect(f.list).toHaveBeenCalledWith(expect.objectContaining({application_token:'placeholder-application'}));
    expect(fs.existsSync(iso.env)).toBe(false);
    const output=Object.values(cap.readouterr()).join('');
    expect(output).not.toContain('placeholder-platform');expect(output).not.toContain('placeholder-application');
  });
  it('reuses the saved application token without another prompt',async()=>{
    iso.writeEnv('ABX_SERVER_TOKEN=placeholder-saved\n');
    const ask=answers();
    const result=await withTemplateEnvironment(ctx(),{ABX_SERVER_TOKEN:''},{},false,async env=>({...env}));
    expect(result).toEqual({ABX_SERVER_TOKEN:'placeholder-saved'});expect(ask).not.toHaveBeenCalled();
  });
  it('keeps explicit runtime input ahead of saved configuration',async()=>{
    iso.writeEnv('ABX_SERVER_TOKEN=placeholder-saved\n');
    const ask=answers();
    const result=await withTemplateEnvironment(ctx(),{ABX_SERVER_TOKEN:''},{ABX_SERVER_TOKEN:'placeholder-explicit'},false,async env=>({...env}));
    expect(result.ABX_SERVER_TOKEN).toBe('placeholder-explicit');expect(ask).not.toHaveBeenCalled();
  });
  it('cancellation stops before preparation and creation',async()=>{
    const f=source();answers('3');
    await expect(executeTemplateLaunch(ctx(),{template_ref:f.dir})).rejects.toThrow();
    expect(f.prepare).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();expect(fs.existsSync(iso.env)).toBe(false);
  });
  it('automatically saves and reuses application authentication in automation without prompting',async()=>{
    vi.spyOn(guidance.guidanceSeams,'interactive').mockReturnValue(false);
    const ask=vi.spyOn(guidance.guidanceSeams,'ask');
    const action=vi.fn(async (env:Readonly<Record<string,string>>)=>({...env}));
    const first=await withTemplateEnvironment(ctx(),{ABX_SERVER_TOKEN:''},{},true,action);
    const second=await withTemplateEnvironment(ctx(),{ABX_SERVER_TOKEN:''},{},true,action);
    expect(first.ABX_SERVER_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
    expect(ask).not.toHaveBeenCalled();
    expect(dotenvValues(iso.env).get('ABX_SERVER_TOKEN')).toBe(first.ABX_SERVER_TOKEN);
    expect(Object.values(cap.readouterr()).join('')).not.toContain(first.ABX_SERVER_TOKEN);
  });
  it('fails before preparation if application credential storage fails',async()=>{
    const f=source();answers('1','placeholder-platform');
    vi.spyOn(configCommands,'saveGuidedValue').mockImplementation(()=>{throw new Error('private failure details');});
    await expect(executeTemplateLaunch(ctx(),{template_ref:f.dir})).rejects.toThrow('Could not save application authentication');
    expect(f.prepare).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
  });
  it.each(['', ' ', 'bad\ntoken'])('rejects invalid explicit tokens without generating a replacement or preparing: %j',async token=>{
    const f=source();answers('1','placeholder-platform');
    await expect(executeTemplateLaunch(ctx(),{template_ref:f.dir},{envs:{ABX_SERVER_TOKEN:token}})).rejects.toThrow('ABX_SERVER_TOKEN');
    expect(f.prepare).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();expect(fs.existsSync(iso.env)).toBe(false);
  });
  it('inherits only saved declared model fields and preserves template defaults', async()=>{
    iso.writeEnv('ABX_LLM_API_KEY=placeholder-model\nABX_LLM_MODEL=saved-model\n');
    const result=await withTemplateEnvironment(ctx(), {ABX_LLM_API_KEY:'', ABX_LLM_MODEL:'template-model'}, {}, false, async env=>({...env}));
    expect(result).toEqual({ABX_LLM_API_KEY:'placeholder-model',ABX_LLM_MODEL:'template-model'});
    const explicit=await withTemplateEnvironment(ctx(), {ABX_LLM_API_KEY:''}, {ABX_LLM_API_KEY:'placeholder-explicit'}, false, async env=>({...env}));
    expect(explicit.ABX_LLM_API_KEY).toBe('placeholder-explicit');
  });
  it('optional template environment remains optional and excludes undeclared host secrets',async()=>{
    iso.setenv('ABX_SERVER_TOKEN','placeholder-host');
    const ask=answers();
    const result=await withTemplateEnvironment(ctx(),{OPTIONAL:''},{},false,async env=>({...env}));
    expect(result).toEqual({OPTIONAL:''});expect(ask).not.toHaveBeenCalled();
  });
});
