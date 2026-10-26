/** Durable Linux task state lives in the sandbox, independently of the MCP connection. */
import { randomUUID } from "node:crypto";
import { quoteShellLiteral as quote } from "../utils/shell.js";

export interface TaskSandbox {
  commands: { run(command: string, options: { shell: boolean; timeout: number }): Promise<unknown> };
}

const ROOT = "/tmp/.abx-tasks";

// A supervisor owns wait()/exit status; /proc identity prevents signalling a reused PID.
const SUPERVISOR = `import json,os,signal,subprocess,sys,time
root,command,cwd=sys.argv[1:]
def save(data):
 p=root+'/state.tmp';open(p,'w').write(json.dumps(data));os.replace(p,root+'/state.json')
def ticks(pid):
 return open('/proc/%s/stat'%pid).read().rsplit(') ',1)[1].split()[19]
state={'task_id':os.path.basename(root),'state':'starting','started_at':time.time()}
try:
 with open(root+'/stdout','wb') as out,open(root+'/stderr','wb') as err:
  child=subprocess.Popen(['sh','-c',command],cwd=cwd or None,stdout=out,stderr=err,start_new_session=True)
  state.update(pid=child.pid,pid_start=ticks(child.pid),state='running');save(state)
  # Leave the leader waitable until its original process group is empty.
  # Its unreaped PID/start time anchors identity even when descendants outlive sh.
  while True:
   exited=os.waitid(os.P_PID,child.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT)
   if os.path.exists(root+'/cancel') and state['state']!='cancelling':
    state['state']='cancelling';save(state)
   if exited is not None:
    alive=False
    for entry in os.listdir('/proc'):
     if not entry.isdigit(): continue
     try:
      parts=open('/proc/'+entry+'/stat').read().rsplit(') ',1)[1].split()
      if parts[0] not in ('Z','X') and parts[2]==str(child.pid) and parts[3]==str(child.pid): alive=True;break
     except (FileNotFoundError,ProcessLookupError): pass
    if not alive: break
   time.sleep(.02)
  code=child.wait()
 state.update(exit_code=code,state='cancelled' if os.path.exists(root+'/cancel') else ('succeeded' if code==0 else 'failed'),finished_at=time.time());save(state)
except Exception as exc:
 state.update(state='failed',error=str(exc),finished_at=time.time());save(state)
`;

/** Run a short control command; a failed control operation is never a successful task. */
async function control(sandbox: TaskSandbox, command: string): Promise<Record<string, unknown>> {
  const result = await sandbox.commands.run(command, { shell: true, timeout: 15 }) as { stdout: string; stderr: string; exit_code: number };
  if (result.exit_code !== 0) throw new Error(`Task control failed (${result.exit_code}): ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** Submit once; callers must retain the returned ID rather than resubmit after uncertain transport errors. */
export async function startTask(sandbox: TaskSandbox, command: string, cwd = ""): Promise<Record<string, unknown>> {
  const id = randomUUID();
  const root = `${ROOT}/${id}`;
  const source = Buffer.from(SUPERVISOR).toString("base64");
  const launch = `umask 077; mkdir -p ${quote(root)} && printf %s ${quote(source)} | base64 -d > ${quote(root + "/run.py")} && nohup python3 ${quote(root + "/run.py")} ${quote(root)} ${quote(command)} ${quote(cwd)} </dev/null >${quote(root + "/launcher.log")} 2>&1 &`;
  // The launcher is deliberately detached with all descriptors redirected.
  return control(sandbox, `${launch}\npython3 -c ${quote(`import json,os,time
p=${JSON.stringify(root + "/state.json")}
for i in range(100):
 if os.path.exists(p):
  print(open(p).read());break
 time.sleep(.02)
else: raise RuntimeError('Supervisor did not become ready; inspect ${root}/launcher.log; do not blindly resubmit')`)}`);
}

/** Query or cancel only the persisted task's process group, checking its Linux process identity first. */
export async function queryTask(sandbox: TaskSandbox, id: string, cancel = false, maxBytes = 16384): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error("Invalid task_id");
  const source = `import json,os,signal,time
root=${JSON.stringify(`${ROOT}/${id}`)}
state=json.load(open(root+'/state.json'))
active=state['state'] in ('starting','running','cancelling')
alive=False
if active and 'pid' in state:
 try:
  parts=open('/proc/%s/stat'%state['pid']).read().rsplit(') ',1)[1].split()
  if parts[19]==state['pid_start']:
   for entry in os.listdir('/proc'):
    if not entry.isdigit(): continue
    try:
     member=open('/proc/'+entry+'/stat').read().rsplit(') ',1)[1].split()
     if member[0] not in ('Z','X') and member[2]==str(state['pid']) and member[3]==str(state['pid']): alive=True;break
    except (FileNotFoundError,ProcessLookupError): pass
 except FileNotFoundError: pass
if ${cancel ? "True" : "False"} and active and alive:
 open(root+'/cancel','w').close()
 try: os.killpg(state['pid'],signal.SIGTERM)
 except ProcessLookupError: pass
 time.sleep(.05)
 state=json.load(open(root+'/state.json'))
 if state['state'] in ('starting','running'): state['state']='cancelling'
elif active and alive and os.path.exists(root+'/cancel'):
 state['state']='cancelling'
elif active and not alive:
 # Supervisor may be committing exit status: re-read, never manufacture success.
 state=json.load(open(root+'/state.json'))
 if state['state'] in ('starting','running'): state['state']='unknown'
for name in ['stdout','stderr']:
 try:
  with open(root+'/'+name,'rb') as f:
   f.seek(0,2);size=f.tell();f.seek(max(0,size-${maxBytes}));state[name]=f.read().decode('utf-8',errors='replace');state[name+'_truncated']=size>${maxBytes}
 except FileNotFoundError: state[name]=''
print(json.dumps(state))`;
  return control(sandbox, `python3 -c ${quote(source)}`);
}
