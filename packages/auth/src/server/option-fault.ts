// Does:  Defines OptionFault, what every option check of auth and its parts throws for an option it refuses.
// Holds: A fault carries a component and a finding only, the two fields a GateFault is built from.

export class OptionFault extends Error {
  override readonly name = 'OptionFault';
  readonly component: string;
  readonly finding: string;

  constructor(component: string, finding: string) {
    super(`${component}: ${finding}`);
    this.component = component;
    this.finding = finding;
  }
}
