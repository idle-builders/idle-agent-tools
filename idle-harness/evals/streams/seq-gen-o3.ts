// seq-gen, in a shuffled order.

import { build } from './seq-gen.ts';

export default (dir: string) => build(dir, { order: 'shuffled' });
