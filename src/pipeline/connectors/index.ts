import type { SourceType } from "@/shared/event";
import { communico } from "./communico";
import { feed } from "./feed";
import { reddit } from "./reddit";
import { seatgeek } from "./seatgeek";
import { ticketmaster } from "./ticketmaster";
import type { Connector } from "./types";
import { webpage } from "./webpage";

/** Registry: adding a new source *type* = one file + one line here. New websites are just `sources` rows. */
export const connectors: Record<SourceType, Connector> = {
  reddit,
  ticketmaster,
  seatgeek,
  ical: feed,
  webpage,
  communico,
};

export type { Connector, SourceRef } from "./types";
