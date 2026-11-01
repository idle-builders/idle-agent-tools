// seq-gen, family by family.

import { build } from './seq-gen.ts';

export default (dir: string) => build(dir, { order: 'families' });
