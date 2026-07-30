/**
 * One job at a time, and a line for the rest.
 *
 * WHY ONE. A deck is minutes of work, not milliseconds: planning spawns Codex
 * for about a minute, rendering drives a headless Chrome and ffmpeg for two more
 * on a four-minute video, and capture holds whole frames in memory. This machine
 * has already lost a Chrome to memory pressure at frame 5547 of a single render.
 * Two concurrent renders do not halve the wall clock, they double the peak and
 * turn a slow job into a killed one — so concurrency is 1, the queue is short and
 * bounded, and a waiting caller is told its place rather than left on a spinner.
 *
 * This file runs no pipeline and touches no filesystem. The work is injected as
 * a function, which is what makes the state machine testable without a network,
 * a browser, or a Codex.
 */
import { explain, type JobError } from "./errors.js";

export type JobState = "queued" | "running" | "done" | "error";
export type Stage = "ingest" | "plan" | "narrate" | "build" | "render";
export type StepState = "pending" | "running" | "done" | "skipped" | "error";

export interface StepView {
  name: Stage;
  state: StepState;
  /** Epoch ms, absent until the step starts. */
  startedAt?: number;
  /** Wall clock of the step, absent until it ends. */
  ms?: number;
  detail?: string;
}

export interface JobResult {
  deckUrl: string;
  videoUrl?: string;
  srtUrl?: string;
  packUrl?: string;
  slides: number;
  /** Seconds of finished deck — measured from the render when there was one. */
  duration: number;
  warnings: string[];
}

export interface JobView {
  id: string;
  state: JobState;
  /** The stage currently running, or the one it stopped at. */
  stage?: Stage;
  steps: StepView[];
  log: string[];
  error?: JobError;
  result?: JobResult;
  /** 1 = next to start. Absent once the job is running. */
  queuePosition?: number;
  createdAt: number;
  /** Wall clock since submission, so a UI can say "3m12s" without its own timer. */
  ms: number;
}

/** What the injected work is handed to report itself. */
export interface JobHandle {
  readonly id: string;
  readonly dir: string;
  begin(stage: Stage, detail?: string): void;
  done(stage: Stage, detail?: string): void;
  skip(stage: Stage, why: string): void;
  log(line: string): void;
}

export interface QueueOptions {
  /** Refuse past this many WAITING jobs. The running one is not counted. */
  maxQueued?: number;
  /** How long a finished job's files and record survive. */
  ttlMs?: number;
  /** Keep the tail of the log; a render writes a line per few frames. */
  maxLog?: number;
  /** Injected in tests so the clock is not the wall's. */
  now?: () => number;
  /** Called by `sweep` for each expired job, to delete its directory. */
  onExpire?: (id: string, dir: string) => void;
}

export class QueueFullError extends Error {
  readonly hint: string;
  readonly status = 503;
  constructor(max: number) {
    super(`The queue is full — ${max} ${max === 1 ? "job is" : "jobs are"} already waiting.`);
    this.name = "QueueFullError";
    this.hint =
      "Decks are made one at a time because a render is minutes of CPU and RAM. Try again in a few minutes.";
  }
}

interface Job {
  id: string;
  dir: string;
  state: JobState;
  stage?: Stage;
  steps: StepView[];
  log: string[];
  dropped: number;
  error?: JobError;
  result?: JobResult;
  createdAt: number;
  endedAt?: number;
  run: (h: JobHandle) => Promise<JobResult>;
}

export class Queue {
  readonly #jobs = new Map<string, Job>();
  readonly #waiting: string[] = [];
  readonly #watchers = new Map<string, Set<(v: JobView) => void>>();
  readonly #maxQueued: number;
  readonly #ttlMs: number;
  readonly #maxLog: number;
  readonly #now: () => number;
  readonly #onExpire: (id: string, dir: string) => void;
  #running: string | undefined;

  constructor(opts: QueueOptions = {}) {
    this.#maxQueued = opts.maxQueued ?? 8;
    this.#ttlMs = opts.ttlMs ?? 2 * 60 * 60_000;
    this.#maxLog = opts.maxLog ?? 400;
    this.#now = opts.now ?? Date.now;
    this.#onExpire = opts.onExpire ?? (() => {});
  }

  get depth(): number {
    return this.#waiting.length;
  }

  get running(): string | undefined {
    return this.#running;
  }

  /**
   * Take a job, or refuse. Refusing is the point: an unbounded queue on a
   * one-at-a-time worker is a promise the server cannot keep, and a caller told
   * "position 400" has been lied to more politely than one told "full".
   */
  submit(input: {
    id: string;
    dir: string;
    stages: Stage[];
    run: (h: JobHandle) => Promise<JobResult>;
  }): JobView {
    if (this.#waiting.length >= this.#maxQueued) throw new QueueFullError(this.#maxQueued);
    const job: Job = {
      id: input.id,
      dir: input.dir,
      state: "queued",
      steps: input.stages.map((name) => ({ name, state: "pending" })),
      log: [],
      dropped: 0,
      createdAt: this.#now(),
      run: input.run,
    };
    this.#jobs.set(job.id, job);
    this.#waiting.push(job.id);
    const ahead = this.#waiting.length - 1 + (this.#running ? 1 : 0);
    this.#note(
      job,
      this.#waiting.length === 1 && !this.#running
        ? "queued"
        : `queued behind ${ahead} ${ahead === 1 ? "job" : "jobs"}`,
    );
    // Every waiting job's position just changed by nobody's fault but this one's.
    for (const id of this.#waiting) this.#emit(id);
    void this.#pump();
    return this.view(job.id) as JobView;
  }

  view(id: string): JobView | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    const at = this.#waiting.indexOf(id);
    return {
      id: job.id,
      state: job.state,
      ...(job.stage ? { stage: job.stage } : {}),
      steps: job.steps.map((s) => ({ ...s })),
      log: job.dropped ? [`… ${job.dropped} earlier line(s) dropped`, ...job.log] : [...job.log],
      ...(job.error ? { error: job.error } : {}),
      ...(job.result ? { result: job.result } : {}),
      ...(at >= 0 ? { queuePosition: at + 1 } : {}),
      createdAt: job.createdAt,
      ms: (job.endedAt ?? this.#now()) - job.createdAt,
    };
  }

  /** Subscribe to changes for one job. Returns the unsubscribe. */
  watch(id: string, fn: (v: JobView) => void): () => void {
    const set = this.#watchers.get(id) ?? new Set();
    set.add(fn);
    this.#watchers.set(id, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.#watchers.delete(id);
    };
  }

  /**
   * Drop every job whose time is up and report their ids, so the caller can
   * delete the directories. A running job is never swept, however old — the TTL
   * measures how long an ANSWER is kept, not how long work may take.
   */
  sweep(): string[] {
    const cutoff = this.#now() - this.#ttlMs;
    const expired: string[] = [];
    for (const job of [...this.#jobs.values()]) {
      if (job.state === "running" || job.state === "queued") continue;
      if ((job.endedAt ?? job.createdAt) > cutoff) continue;
      this.#jobs.delete(job.id);
      this.#watchers.delete(job.id);
      expired.push(job.id);
      this.#onExpire(job.id, job.dir);
    }
    return expired;
  }

  /* ---------------------------------------------------------------- internals */

  async #pump(): Promise<void> {
    if (this.#running) return;
    const id = this.#waiting.shift();
    if (!id) return;
    const job = this.#jobs.get(id);
    if (!job) return void this.#pump();

    this.#running = id;
    job.state = "running";
    this.#note(job, "running");
    // Everyone behind just moved up a place.
    for (const other of this.#waiting) this.#emit(other);

    try {
      job.result = await job.run(this.#handle(job));
      job.state = "done";
      job.stage = undefined;
      this.#note(job, "done");
    } catch (err) {
      job.state = "error";
      job.error = explain(err);
      // The stage that was mid-flight is the stage that failed; mark it so the
      // step list and the message agree about where it stopped.
      const active = job.steps.find((s) => s.state === "running");
      if (active) {
        active.state = "error";
        active.ms = this.#now() - (active.startedAt ?? this.#now());
      }
      this.#note(job, `error: ${job.error.message}`);
    } finally {
      job.endedAt = this.#now();
      this.#running = undefined;
      this.#emit(job.id);
      void this.#pump();
    }
  }

  #handle(job: Job): JobHandle {
    return {
      id: job.id,
      dir: job.dir,
      begin: (stage, detail) => {
        job.stage = stage;
        const step = this.#step(job, stage);
        step.state = "running";
        step.startedAt = this.#now();
        if (detail) step.detail = detail;
        this.#note(job, `${stage}: started`);
      },
      done: (stage, detail) => {
        const step = this.#step(job, stage);
        step.state = "done";
        step.ms = this.#now() - (step.startedAt ?? this.#now());
        if (detail) step.detail = detail;
        this.#emit(job.id);
      },
      skip: (stage, why) => {
        const step = this.#step(job, stage);
        step.state = "skipped";
        step.detail = why;
        this.#emit(job.id);
      },
      log: (line) => this.#note(job, line),
    };
  }

  /** A stage the caller did not declare still gets a row rather than vanishing. */
  #step(job: Job, stage: Stage): StepView {
    const found = job.steps.find((s) => s.name === stage);
    if (found) return found;
    const added: StepView = { name: stage, state: "pending" };
    job.steps.push(added);
    return added;
  }

  #note(job: Job, line: string): void {
    job.log.push(line);
    // Keep the tail. A render writes a line every few seconds for two minutes,
    // and an unbounded log on a long queue is a memory leak with a progress bar.
    if (job.log.length > this.#maxLog) {
      job.dropped += job.log.length - this.#maxLog;
      job.log.splice(0, job.log.length - this.#maxLog);
    }
    this.#emit(job.id);
  }

  #emit(id: string): void {
    const watchers = this.#watchers.get(id);
    if (!watchers?.size) return;
    const view = this.view(id);
    if (!view) return;
    for (const fn of watchers) fn(view);
  }
}
