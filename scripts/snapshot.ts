/**
 * Writes a snapshot of the local event data to data/pullup-snapshot.db (git-ignored).
 * Upload it to the live site with the command printed at the end (see README "Moving data to production").
 */
import fs from "node:fs";
import path from "node:path";
import { writeSnapshot } from "@/lib/db/snapshot";

const out = path.resolve("data", "pullup-snapshot.db");
const counts = writeSnapshot(out);
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${out} (${mb} MB)`);
console.log(counts);
