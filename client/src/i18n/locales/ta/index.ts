import core from './core';
import app from './app';
import automation from './automation';
import extras from './extras';

type Tree = { [k: string]: string | Tree };
const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null;
/** Deep merge: later trees add keys to (and never delete from) the earlier ones. */
function merge(...trees: Tree[]): Tree {
  const out: Tree = {};
  for (const tree of trees) {
    for (const [k, v] of Object.entries(tree)) {
      const prev = out[k];
      out[k] = isTree(v) && isTree(prev) ? merge(prev, v) : v;
    }
  }
  return out;
}

const ta = merge(core as Tree, app as Tree, automation as Tree, extras as Tree);
export default ta;
