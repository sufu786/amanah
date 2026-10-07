// Where a patient's obligations are kept: one file on their own computer. Phase 2, stage 2.
//
// No database and no account. The file holds obligations, notes to raise with a clinician, and a log
// of what the patient confirmed, rejected and added (constraint C4, kept on this machine only). It
// never holds report text: C5 discards the report once it has been checked, and an obligation keeps
// only the sentences it quotes, which is all it ever held.
//
// Writes go to a temporary file that then replaces the real one, so a crash or a full disk midway
// leaves the previous version intact rather than half a file. A file this app cannot read is an
// error the patient sees, never an empty list, because an empty list would read as nothing owed.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const FORMAT = 'amanah.store/1';
export const DEFAULT_PATH = join(homedir(), '.amanah', 'obligations.json');

const empty = () => ({ format: FORMAT, obligations: [], notes: [], log: [] });

export function loadStore(path = DEFAULT_PATH) {
  if (!existsSync(path)) return empty();
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} could not be read (${e.message}). It has not been changed. `
      + 'Nothing is shown in its place, because an empty list would look like nothing is owed.');
  }
  if (data.format !== FORMAT) throw new Error(`${path} is not an Amanah store (format ${JSON.stringify(data.format)})`);
  return data;
}

export function saveStore(store, path = DEFAULT_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** Add what one checking session produced, and write it. Returns the new store. */
export function addToStore({ obligations = [], notes = [], log = [] }, path = DEFAULT_PATH) {
  const store = loadStore(path);
  const next = {
    ...store,
    obligations: [...store.obligations, ...obligations],
    notes: [...store.notes, ...notes],
    log: [...store.log, ...log],
  };
  saveStore(next, path);
  return next;
}
