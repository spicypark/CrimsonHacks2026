import type { RawItem, SourceType } from "@/shared/event";

/** The slice of a `sources` row a connector needs. */
export interface SourceRef {
  id: number;
  type: SourceType;
  /** Feed/page URL, subreddit name, or "" for API-wide sources. */
  target: string;
  label: string;
}

/**
 * The seam every source type plugs into. One adapter per source *type*, not per website.
 *
 * Contract:
 * - Returns raw items only — no AI, no DB writes, no geocoding.
 * - Structured sources fill `item.event`; unstructured ones leave it null and put readable text in `item.text`.
 * - `externalId` must be stable across runs for the same item (used for upserts).
 * - Throws on total failure (bad key, unreachable); the orchestrator logs it and moves on.
 */
export interface Connector {
  type: SourceType;
  fetch(source: SourceRef): Promise<RawItem[]>;
}
