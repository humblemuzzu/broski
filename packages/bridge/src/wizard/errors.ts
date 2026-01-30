export class WizardCancelledError extends Error {
  constructor() {
    super('Wizard cancelled by user')
    this.name = 'WizardCancelledError'
  }
}
