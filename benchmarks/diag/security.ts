// Does:  Decides the security result of a diag run from the recorder's folders and the scenario.
// Holds: Any leak or containment finding fails the pass; a clean pass has none.

import { basename } from 'node:path';
import type { RecorderFolder } from './diag-files.ts';
import { type DiagProcess, findingText } from './readout.ts';
import type { ScenarioFinding, ScenarioPassResult } from './scenario.ts';

export interface Security {
  readonly findings: readonly ScenarioFinding[];
  readonly sentence: string;
}

const folderFindings = (folder: RecorderFolder): readonly ScenarioFinding[] => {
  const where = basename(folder.folder);
  const journaled = folder.journal.filter((line) => line.fails_run);
  const named = new Set(journaled.map((line) => line.hook));
  const unjournaled = (folder.snapshots.at(-1)?.failing ?? []).filter((name) => !named.has(name));
  return [
    ...journaled.map((line) => ({
      kind: line.hook,
      subject: line.subject === null ? null : String(line.subject),
      route: line.route,
      where,
    })),
    ...unjournaled.map((name) => ({ kind: name, subject: null, route: null, where })),
  ];
};

export function decideSecurity(
  processes: readonly DiagProcess[],
  scenario: readonly ScenarioPassResult[],
  notAssessed: string | null,
): Security {
  const findings = [
    ...processes
      .filter((process) => process.group === 'check' || process.group === 'rounds')
      .flatMap((process) => folderFindings(process.folder)),
    ...scenario.flatMap((result) => result.findings),
  ];
  const [first] = findings;
  if (first !== undefined) {
    const more = findings.length - 1;
    const rest = more === 0 ? '' : `; ${more} more ${more === 1 ? 'finding' : 'findings'} in the readout`;
    return { findings, sentence: `Security: failed. ${findingText(first)}${rest}.` };
  }
  if (notAssessed !== null) {
    return { findings, sentence: `Security: not assessed. ${notAssessed}` };
  }
  const scanned = processes.filter((process) => process.group !== 'scenario planted').length;
  const planted = scenario.find((result) => result.pass === 'planted');
  const detected = planted?.plantedDetected.length ?? 0;
  const total = detected + (planted?.plantedMissing.length ?? 0);
  return {
    findings,
    sentence: `Security: clean. No leak or containment event in ${scanned} diag processes; ${detected} of ${total} planted leaks detected.`,
  };
}
