export type LiveChange = {
  conversationId: string;
  kind: 'message' | 'draft' | 'receipt';
};

// Invalid or oversized metadata triggers a full reconciliation instead of losing updates.
export function parseLiveBatch(value: unknown): LiveChange[] | undefined {
  if (!value || typeof value !== 'object' || !('changes' in value)) return undefined;
  const changes = value.changes;
  if (!Array.isArray(changes) || changes.length > 100) return undefined;
  const valid = changes.every((item: unknown): item is LiveChange => {
    if (!item || typeof item !== 'object' || !('kind' in item) || !('conversationId' in item)) return false;
    return (item.kind === 'message' || item.kind === 'draft' || item.kind === 'receipt')
      && typeof item.conversationId === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.conversationId);
  });
  return valid ? changes as LiveChange[] : undefined;
}

export function refreshTargets(changes: LiveChange[] | undefined, selectedId: string | null) {
  return {
    inbox: !changes || changes.some(change => change.kind !== 'receipt'),
    conversation: Boolean(selectedId) && (!changes || changes.some(change => change.conversationId === selectedId)),
  };
}
