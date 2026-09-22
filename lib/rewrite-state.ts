export interface RewriteActionState {
  loading?: boolean;
  error?: boolean;
}

export function canApplyRewrite<T extends RewriteActionState>(preview: T | null | undefined): preview is T {
  return Boolean(preview && !preview.loading && !preview.error);
}
