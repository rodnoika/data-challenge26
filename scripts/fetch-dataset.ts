// Usage: npm run fetch:dataset -- DEV   -> data/<group>.json (raw organiser payload)
import "./env";
import { writeFileSync, mkdirSync } from "node:fs";
import { organiserUrl } from "../src/server/service";

const group = process.argv[2] ?? "DEV";
const res = await fetch(organiserUrl(group));
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.json();
if (!body?.isSuccess) throw new Error(`API error: ${body?.error}`);
mkdirSync("data", { recursive: true });
const file = `data/${group.toLowerCase()}.json`;
writeFileSync(file, JSON.stringify(body, null, 1));
console.log(`Saved ${body.data.total_records} records to ${file}`);
