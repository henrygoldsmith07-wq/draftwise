export interface RewriteActionState {
  loading?: boolean;
  error?: boolean;
}

export function canApplyRewrite(preview: RewriteActionState | null | undefined) {
  return Boolean(preview && !preview.loading && !preview.error);
}
