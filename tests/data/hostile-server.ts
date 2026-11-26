// Does:  Proves the pool sends no startup or password byte to a hostile server and refuses what it sends.
// Holds: Each case ends in the named failure with the fixture's recorded bytes inside what the criterion allows.

import { createReport } from '../support/support-proof.ts';
import {
  ac1,
  ac2,
  alpnOther,
  type CaseResult,
  hostileAnswer,
  iterationsOverBound,
  noCancelKey,
  oversizedLength,
  parametersOverBound,
  wrongSignature,
} from './rig/hostile-cases.ts';

const report = createReport();
const results: CaseResult[] = [
  ...(await ac1()),
  ...(await ac2()),
  await wrongSignature(),
  await oversizedLength(),
  await hostileAnswer('a field length below -1 closes the connection', 'field-below-minus-one', 'PROTOCOL_VIOLATION'),
  await hostileAnswer(
    'a field length that runs past its message closes the connection',
    'field-past-message',
    'PROTOCOL_VIOLATION',
  ),
  await iterationsOverBound(),
  await parametersOverBound(),
  await alpnOther(),
  await noCancelKey(),
];
for (const result of results) {
  report.result(result.name, result.problems, result.observed);
}
report.finish();
