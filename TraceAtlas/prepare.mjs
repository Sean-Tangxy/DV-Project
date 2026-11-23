import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(process.argv[2] ?? fileURLToPath(new URL('../Project/ART1422 26Fall Project Data/ART1422 26Fall Project Data/project-3/sszx_verification_dataset_2026-11-18/', import.meta.url)));
const read = (name) => readFileSync(resolve(dir, name), 'utf8').replace(/^\uFEFF/, '');
const json = (name) => JSON.parse(read(name));
const lines = (name) => read(name).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const raw = lines('raw/history_items.jsonl');
const events = lines('normalized/events.jsonl');
const sessions = json('normalized/sessions.json');
const key = (thread, turn, id, ordinal) => JSON.stringify([thread, turn, id, ordinal]);
const index = new Map(raw.map((item, i) => [key(item.thread_id, item.turn_id, item.item_id, item.rollout_ordinal), i]));
const links = events.map(({ref}) => index.get(key(ref.thread_id, ref.turn_id, ref.item_id, ref.rollout_ordinal)) ?? null);
if (links.includes(null) || new Set(links).size !== raw.length || sessions.reduce((n, s) => n + s.record_count, 0) !== events.length) {
  throw new Error('Export does not reconcile: check raw records, event references and session counts.');
}
const relations = json('normalized/agent_relations.json').map(x => ({
  id: x.id,
  parent: x.source?.subagent?.thread_spawn?.parent_thread_id ?? x.attached_thread_parent_id ?? null,
  nickname: x.source?.subagent?.thread_spawn?.agent_nickname ?? null,
  agent: x.agent_path
}));
const payload = {project: process.argv[3] ?? (process.argv[2] ? '导入项目' : 'sszx_vs_zz'), source: process.argv[2] ? '本地历史导入' : '2026-11-18 历史导出', historyComplete: false, events, sessions, relations, raw, links};
writeFileSync(new URL('./dataset.js', import.meta.url), 'globalThis.SSZX_DATA = ' + JSON.stringify(payload) + ';\n');
console.log(events.length + ' normalized events; ' + raw.length + ' original items; ' + sessions.length + ' sessions');
