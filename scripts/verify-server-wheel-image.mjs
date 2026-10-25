/** Real Docker regression for production SDK injection and Dockerfile materialization. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DockerBuilder } from '../dist/providers/alicloud_express/docker_builder.js';
import { SERVER_SDK_RELEASE_SPEC, SERVER_SDK_RELEASE_VERSION } from '../dist/utils/server_sdk_pin.js';

const templates = resolve(process.env.ABX_REVIEW_TEMPLATES);
const server = resolve(process.env.ABX_REVIEW_SERVER_SDK);
assert(existsSync(join(templates, 'python-hello', 'Dockerfile')));
assert(existsSync(join(server, 'pyproject.toml')));
const serverSources = join(server, 'src', 'agent_sandbox', 'server');
const expectedSources = {};
for (const entry of readdirSync(serverSources, { recursive: true })) {
  if (entry.endsWith('.py')) {
    expectedSources[entry] = createHash('sha256').update(readFileSync(join(serverSources, entry))).digest('hex');
  }
}
assert(Object.keys(expectedSources).length > 40, 'compare the complete server module source set');
function gitRevision(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const context = mkdtempSync(join(tmpdir(), 'abx-real-wheel-'));
const tags = [];
const docker = (args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
try {
  for (const mode of ['conditional', 'continued']) {
    const directory = join(context, mode);
    cpSync(join(templates, 'python-hello'), directory, {
      recursive: true,
      filter: (path) => !/(?:^|\/)\.env(?:\.|$)|\.whl$|(?:^|\/)__pycache__(?:\/|$)/.test(path),
    });
    if (mode === 'continued') {
      writeFileSync(join(directory, 'Dockerfile'), [
        'FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>',
        'WORKDIR /home/user/app',
        'RUN echo before \\',
        `    && pip install --no-cache-dir "${SERVER_SDK_RELEASE_SPEC}" httpx==0.28.1 \\`,
        '    && printf after > /tmp/wheel-rewrite-complete',
        'USER user',
        'EXPOSE 9000',
        '',
      ].join('\n'));
    }
    const injected = await DockerBuilder.injectSdkWheel(directory, server);
    assert.equal(injected.length, 1, 'source-wheel injection must actually succeed');
    const tag = 'abx-wheel-review:' + mode;
    tags.push(tag);
    await new DockerBuilder().build(directory, tag, { on_output: (line) => console.log(line) });
    assert(!existsSync(join(directory, 'Dockerfile.abx-build')), 'ephemeral Dockerfile cleaned');
    const code = [
      'import importlib.metadata, os, hashlib, json, sys',
      'from pathlib import Path',
      'import agent_sandbox.server as runtime',
      'assert os.geteuid() != 0',
      `assert importlib.metadata.version("agent-sandbox-server") == ${JSON.stringify(SERVER_SDK_RELEASE_VERSION)}`,
      'for relative, expected in json.loads(sys.argv[1]).items():\n    assert hashlib.sha256((Path(runtime.__file__).parent / relative).read_bytes()).hexdigest() == expected, relative',
      mode === 'conditional'
        ? 'import commands; assert commands.hello("Image") == "Hello, Image!"; assert commands.run_script("print(6*7)").strip() == "42"'
        : 'from pathlib import Path; assert Path("/tmp/wheel-rewrite-complete").read_text() == "after"; assert importlib.metadata.version("httpx") == "0.28.1"',
      'print("PASS exact installed server source, non-root runtime and original RUN behavior")',
    ].join('\n');
    console.log(docker(['run', '--rm', '--network', 'none', '--entrypoint', 'python3', tag, '-c', code, JSON.stringify(expectedSources)]));
    console.log('PASS real production DockerBuilder: ' + mode);
    if (mode === 'conditional' && process.env.ABX_REVIEW_IMAGE_ARCHIVE) {
      const archive = resolve(process.env.ABX_REVIEW_IMAGE_ARCHIVE);
      const saved = spawnSync('docker', ['image', 'save', '--output', archive, tag], { encoding: 'utf8', timeout: 180000 });
      assert.equal(saved.status, 0, saved.stderr);
      const checksum = createHash('sha256');
      // Hash without buffering the full image archive in memory.
      const { createReadStream } = await import('node:fs');
      for await (const chunk of createReadStream(archive)) checksum.update(chunk);
      const digest = checksum.digest('hex');
      writeFileSync(archive + '.sha256', digest + '  python-hello-image.tar\n');
      const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
      assert.equal(commit.status, 0);
      writeFileSync(join(resolve(archive, '..'), 'python-hello-image-metadata.json'), JSON.stringify({
        format: 'docker-archive', template: 'python-hello',
        repository: process.env.GITHUB_REPOSITORY,
        checkout_commit: commit.stdout.trim(), workflow_run_id: process.env.GITHUB_RUN_ID,
        server_sdk_commit: gitRevision(server),
        template_source_commit: gitRevision(templates),
        base_image: 'fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49',
        local_image_id: docker(['image', 'inspect', '--format', '{{.Id}}', tag]).trim(),
        archive_sha256: digest,
        builder: 'production DockerBuilder.injectSdkWheel and DockerBuilder.build',
        acceptance: 'real production materialization/Docker runtime; cloud acceptance is separate',
      }, null, 2) + '\n');
      console.log('PASS exported the already built production image and provenance; no registry credentials');
    }
  }
} finally {
  for (const tag of tags) {
    // Images and contexts belong only to this dedicated ephemeral runner job.
    spawnSync('docker', ['image', 'rm', '--force', tag], { encoding: 'utf8' });
  }
  rmSync(context, { recursive: true, force: true });
}
