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
 *   and recap (the earlier scenes' own computed layers).
 */
import type { LiteralKind } from "../types.js";
import type { KindImpl } from "./kind.js";
import { backboneKind } from "./kinds/backbone.js";
import { channelThresholdKind } from "./kinds/channel-threshold.js";
import { cropsKind } from "./kinds/crops.js";
import { darkChannelKind } from "./kinds/dark-channel.js";
import { emaKind } from "./kinds/ema-threshold.js";
import { fixedFiltersKind } from "./kinds/fixed-filters.js";
import { hazeKind } from "./kinds/haze.js";
import { recapKind } from "./kinds/recap.js";
import { scaleKind } from "./kinds/scale.js";
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
};
