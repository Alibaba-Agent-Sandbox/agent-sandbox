import os, pathlib, signal, time
root = pathlib.Path('/tmp/skill-acceptance')
(root/'heartbeat.pid').write_text(str(os.getpid())+'\n')
def stop(signum, frame):
    (root/'heartbeat.stopped').write_text(str(signum)+'\n')
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
while True:
    with (root/'heartbeat.log').open('a') as f: f.write(str(time.time_ns())+'\n')
    time.sleep(0.2)
