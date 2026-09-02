#!/usr/bin/env node
/**
 * The stdio entry point. `decksmith-mcp`, or `node dist/mcp/main.js`.
 *
 * STDOUT IS THE WIRE. A stdio MCP server speaks JSON-RPC on stdout, so one
 * stray `console.log` anywhere in the pipeline — or in a dependency — is a
 * corrupt frame and a dead session. The pipeline logs through `job.note` rather
 * than the console, but nothing in the library PROMISES that, so the console is
 * repointed at stderr below. A stray line then lands in the client's server log,
 * where a person can see it, instead of killing the connection.
 *
 * The obvious version of that — reassigning `process.stdout.write` — is wrong,
 * and wrong silently: the transport writes the protocol through the same
 * function, so it redirects the wire into stderr and `initialize` never answers.
 * That is not reasoning, it is what the first version of this file did.
 */
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { VERSION } from "../version.js";
import {
  capabilitiesSchema,
  createSchema,
  deckTools,
  defaultWork,
  estimateSchema,
  statusSchema,
} from "./tools.js";

// `console`, not `process.stdout.write` — the transport writes the wire THROUGH
// `process.stdout.write`, so clobbering that redirects the protocol itself into
// stderr and the client sees a server that never answers. Measured, because that
// is exactly what the first version of this file did: `initialize` returned
// nothing at all. Only the console is redirected, which is what a stray log
// actually goes through.
for (const level of ["log", "info", "debug", "warn", "trace"] as const) {
  console[level] = (...args: unknown[]) => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };
}

const env = process.env;
/**
 * The fence. Documents outside it are not readable.
 *
 * `homedir()`, not `cwd()`: a stdio server is launched by the client, and not
 * every client launches it in a project — Claude Desktop uses `/`, where a
 * prefix test against the root fences nothing at all.
 */
const root = env.DECKSMITH_MCP_ROOT ?? homedir();
const work = env.DECKSMITH_MCP_WORK ?? defaultWork();
const tools = deckTools({ root, work });

/** `z.toJSONSchema` is zod 4's, already a dependency. The SDK needs none of it. */
const schema = (s: z.ZodType) =>
  z.toJSONSchema(s, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as {
    type: "object";
  };

const TOOLS = [
  {
    name: "decksmith_capabilities",
    description:
      "Formats, themes, every setting's range, which of Codex, edge-tts, ffmpeg and Chrome are actually installed, and where generated illustrations would come from. Call this first.",
    inputSchema: schema(capabilitiesSchema),
  },
  {
    name: "decksmith_estimate_length",
    description:
      "What a duration/slides/narration-density combination costs — characters a slide, speaking rate, animation speed — and what it cannot buy. Instant, no job. Call this before create_deck whenever a duration is involved.",
    inputSchema: schema(estimateSchema),
  },
  {
    name: "decksmith_create_deck",
    description:
      "Turn a markdown document into an animated deck, and optionally a narrated mp4. Takes minutes: returns as soon as the job finishes or wait_seconds expires, whichever is first, and the job keeps running either way.",
    inputSchema: schema(createSchema),
  },
  {
    name: "decksmith_job_status",
    description:
      "Where a job got to, blocking up to wait_seconds for it to finish. Returns the storyboard path as soon as there is one — read it and edit it, that is where the quality is won.",
    inputSchema: schema(statusSchema),
  },
] as const;

const server = new Server({ name: "decksmith", version: VERSION }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    const out = await call(req.params.name, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
  } catch (err) {
    // An error the AGENT can act on, not a stack. `isError` keeps it a tool
    // result rather than a protocol failure, so the conversation continues.
    return {
      isError: true,
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    };
  }
});

function call(name: string, args: Record<string, unknown>): Promise<unknown> | unknown {
  switch (name) {
    case "decksmith_capabilities":
      return tools.capabilities();
    case "decksmith_estimate_length":
      return tools.estimate(estimateSchema.parse(args));
    case "decksmith_create_deck":
      return tools.create(createSchema.parse(args));
    case "decksmith_job_status":
      return tools.status(statusSchema.parse(args));
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

await server.connect(new StdioServerTransport());
process.stderr.write(`decksmith mcp: root ${root}, work ${work}\n`);
