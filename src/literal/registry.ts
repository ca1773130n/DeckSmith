/**
 * EVERY KIND THE BUILD DRAWS, by name: one entry per kind, one module per
 * entry under `src/literal/kinds/`. A `Record` over `LiteralKind`, so a name
 * added to the planner's list (src/types.ts `LITERAL_KIND_NAMES`) does not
 * compile until it is drawn here, and nothing is registered at run time.
 *
 * Two families.
 * - PICTURE KINDS compute their layers from the deck's own picture at build
 *   time (`picture: true`): haze, spikes, sobel, dark-channel,
 *   channel-threshold, ema-threshold, backbone, fixed-filters, crops.
 * - DATA KINDS draw what the source states (`picture: false`): table, scale,
 *   recap (the earlier scenes' own computed layers), and the visual forms a
 *   table would otherwise take — margins (results as positions), scope (what
 *   was and was not evaluated, as nested regions), ablation (the experiments
 *   not run, as empty cells) and prior-work (earlier families by what they
 *   do; it runs a classical method on the picture when a lane asks).
 * - MECHANISM KINDS compute how a method works from the plan's own material
 *   (src/literal/kinds/mechanisms.ts over the pure modules beside it):
 *   attention, optimization, splatting, message-passing, rl-rollout and
 *   retrieval read the beat's `literal` (attention and splatting may take a
 *   picture instead); diffusion is a picture kind.
 */
import type { LiteralKind } from "../types.js";
import type { KindImpl } from "./kind.js";
import { ablationKind } from "./kinds/ablation.js";
import { backboneKind } from "./kinds/backbone.js";
import { channelThresholdKind } from "./kinds/channel-threshold.js";
import { cropsKind } from "./kinds/crops.js";
import { darkChannelKind } from "./kinds/dark-channel.js";
import { emaKind } from "./kinds/ema-threshold.js";
import { fixedFiltersKind } from "./kinds/fixed-filters.js";
import { hazeKind } from "./kinds/haze.js";
import { marginsKind } from "./kinds/margins.js";
import {
  attentionKind,
  diffusionKind,
  messagePassingKind,
  optimizationKind,
  retrievalKind,
  rlRolloutKind,
  splattingKind,
} from "./kinds/mechanisms.js";
import { priorWorkKind } from "./kinds/prior-work.js";
import { recapKind } from "./kinds/recap.js";
import { scaleKind } from "./kinds/scale.js";
import { scopeKind } from "./kinds/scope.js";
import { sobelKind } from "./kinds/sobel.js";
import { spikesKind } from "./kinds/spikes.js";
import { tableKind } from "./kinds/table.js";

export const KINDS: Readonly<Record<LiteralKind, KindImpl>> = {
  haze: hazeKind,
  spikes: spikesKind,
  sobel: sobelKind,
  "dark-channel": darkChannelKind,
  "channel-threshold": channelThresholdKind,
  "ema-threshold": emaKind,
  backbone: backboneKind,
  "fixed-filters": fixedFiltersKind,
  crops: cropsKind,
  table: tableKind,
  scale: scaleKind,
  recap: recapKind,
  "prior-work": priorWorkKind,
  margins: marginsKind,
  scope: scopeKind,
  ablation: ablationKind,
  attention: attentionKind,
  diffusion: diffusionKind,
  optimization: optimizationKind,
  splatting: splattingKind,
  "message-passing": messagePassingKind,
  "rl-rollout": rlRolloutKind,
  retrieval: retrievalKind,
};
