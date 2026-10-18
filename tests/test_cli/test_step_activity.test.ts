/** Build and push steps show their log under the phase header. */

import { describe, expect, it } from "vitest";

import type { ActivityHandle, ActivityUpdate } from "../../src/cli/output.js";

const TEMPLATE_MODULE = "../../src/providers/alicloud_express/cli/template.js";

interface StepReporterLike {
  phase(message: string): void;
  log(line: string): void;
  done(message: string): void;
  close(): void;
}

interface TemplateModule {
  _StepReporter: new (out: unknown, opts: { verbose: boolean }) => StepReporterLike;
  templateSeams: { _STEP_TICK_SECONDS: number };
}

async function loadTemplate(): Promise<TemplateModule> {
  return (await import(/* @vite-ignore */ TEMPLATE_MODULE as string)) as TemplateModule;
}

/** Stand-in for `OutputManager`. */
class Out {
  use_activity_line: boolean;
  progress_lines: string[] = [];
  info_lines: string[] = [];
  updates: string[] = [];
  closed = 0;
  onUpdate: (() => void) | null = null;

  constructor(opts: { activity: boolean }) {
    this.use_activity_line = opts.activity;
  }

  progress(message: string): void {
    this.progress_lines.push(message);
  }

  info(message: string): void {
    this.info_lines.push(message);
  }

  startActivity(_message: string): ActivityHandle {
    const update: ActivityUpdate = (summary = "") => {
      this.updates.push(summary);
      this.onUpdate?.();
    };
    return {
      update,
      close: () => {
        this.closed += 1;
      },
    };
  }

  async activity<T>(message: string, fn: (update: ActivityUpdate | null) => T | Promise<T>): Promise<T> {
    const handle = this.startActivity(message);
    try {
      return await fn(handle.update);
    } finally {
      handle.close();
    }
  }
}

describe("TestStepReporter", () => {
  it("test_docker_lines_scroll_under_the_phase", async () => {
    const { _StepReporter } = await loadTemplate();
    const out = new Out({ activity: true });
    const reporter = new _StepReporter(out, { verbose: false });
    try {
      reporter.phase("[3/3] Building Docker image locally: app:latest");
      reporter.log("  #1 [internal] load build definition");
      reporter.log("");
      reporter.log("#2 [1/4] FROM python:3.12-slim");
      reporter.log("#3 [2/4] RUN pip install agent-sandbox");
    } finally {
      reporter.close();
    }

    expect(out.updates[0]!.split("\n")).toEqual(["#1 [internal] load build definition"]);
    expect(out.updates[out.updates.length - 1]!.split("\n")).toEqual([
      "#1 [internal] load build definition",
      "#2 [1/4] FROM python:3.12-slim",
      "#3 [2/4] RUN pip install agent-sandbox",
    ]);
    expect(out.info_lines).toEqual([]);
    expect(out.closed).toBe(1);
  });

  it("test_verbose_prints_every_line_and_skips_the_feed", async () => {
    const { _StepReporter } = await loadTemplate();
    const out = new Out({ activity: true });
    const reporter = new _StepReporter(out, { verbose: true });
    try {
      reporter.phase("Building");
      reporter.log("Step 1/2 : FROM python");
    } finally {
      reporter.close();
    }

    expect(out.progress_lines).toEqual(["Building"]);
    expect(out.info_lines).toEqual(["Step 1/2 : FROM python"]);
    expect(out.updates).toEqual([]);
    expect(out.closed).toBe(0);
  });

  it("test_without_a_tty_one_progress_line_and_no_log_spam", async () => {
    const { _StepReporter } = await loadTemplate();
    const out = new Out({ activity: false });
    const reporter = new _StepReporter(out, { verbose: false });
    try {
      reporter.phase("Pushing to ACR: example:latest");
      reporter.log("layer abc: Pushed");
      reporter.done("Image pushed to ACR: example:latest");
    } finally {
      reporter.close();
    }

    expect(out.progress_lines).toEqual(["Pushing to ACR: example:latest", "Image pushed to ACR: example:latest"]);
    expect(out.info_lines).toEqual([]);
    expect(out.updates).toEqual([]);
  });

  it("test_silent_phase_keeps_refreshing", async () => {
    const tpl = await loadTemplate();
    const saved = tpl.templateSeams._STEP_TICK_SECONDS;
    tpl.templateSeams._STEP_TICK_SECONDS = 0.05;
    try {
      const out = new Out({ activity: true });
      const seen = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        out.onUpdate = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
      const reporter = new tpl._StepReporter(out, { verbose: false });
      try {
        reporter.phase("Injecting SDK wheel");
        expect(await seen).toBe(true);
      } finally {
        reporter.close();
      }

      expect(out.updates.length).toBeGreaterThan(0);
      expect(out.closed).toBe(1);
    } finally {
      tpl.templateSeams._STEP_TICK_SECONDS = saved;
    }
  });
});
