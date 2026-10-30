// E20 — the data desk of E16, long enough for improvement to pay off: forty questions about the same export, with
// improvement after every tenth. In E16 an improvement session cost more than what it promoted saved over fifteen
// questions; here what it takes up has thirty questions left to pay for itself.

import { MORE, QUESTIONS } from '../fixtures/orders.ts';
import { desk } from './e16-data-desk.ts';

export default desk('E20', 'a long data desk, where improvement has time to pay off', [...QUESTIONS, ...MORE], 10);
