/**
 * A filesystem operation that can change the path binding of one or more open documents.
 * The filesystem operation stays outside the document domain; this command makes the
 * prepare/commit boundary explicit so callers cannot silently mutate tab bindings.
 */
export interface DocumentBindingTransition<TResult> {
  readonly prepare: () => Promise<TResult>;
  readonly commit: (result: TResult) => Promise<void>;
  readonly recover?: (result: TResult | null, error: unknown) => Promise<void>;
}
