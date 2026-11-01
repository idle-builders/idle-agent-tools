// seq-gen, shifting halfway to new sequences and a new supplier's enzyme table.

import { build } from './seq-gen.ts';

export default (dir: string) => build(dir, { shift: true });
