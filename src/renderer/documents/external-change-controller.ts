export interface ExternalChangeDecisionInput {
  readonly hasUnavailableState: boolean;
  readonly expectedSavedContent: string;
  readonly modified: boolean;
  readonly externalChangeIgnored: boolean;
  readonly hasFilePath: boolean;
  readonly content: string;
}

export type ExternalChangeDecision =
  'reappeared' | 'matches-baseline' | 'reload-clean-document' | 'create-conflict';

/** Classifies stable document watcher content without reading files or changing the DOM. */
export class ExternalChangeController {
  classify(input: ExternalChangeDecisionInput): ExternalChangeDecision {
    if (input.hasUnavailableState) return 'reappeared';
    if (input.content === input.expectedSavedContent) return 'matches-baseline';
    if (input.hasFilePath && !input.modified && !input.externalChangeIgnored)
      return 'reload-clean-document';
    return 'create-conflict';
  }
}
