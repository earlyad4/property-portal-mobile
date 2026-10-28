export function normalizeBootstrap(data: any) {
  const status = (s: string) => ({ pending: "open", completed: "resolved" }[s?.toLowerCase()] || s?.toLowerCase());
  return {
    ...data,
    tickets: (data.maintenanceRequests || data.tickets || []).map((t: any) => ({
      ...t, status: status(t.status), createdAt: t.submittedAt || t.createdAt,
      updatedAt: t.updated_at || t.updatedAt || t.submittedAt,
      messages: (t.timeline || t.messages || []).map((m: any) => ({
        ...m, ticketId: m.requestId || m.ticketId, authorKind: m.author_kind || m.authorKind,
        authorName: m.author || m.authorName, createdAt: m.at || m.createdAt,
      })),
    })),
    documents: (data.documents || []).map((d: any) => ({ ...d, kind: d.type || d.kind, status: d.status?.toLowerCase(), createdAt: d.submittedAt || d.createdAt })),
    broadcasts: (data.broadcasts || []).map((b: any) => ({ ...b, body: b.message || b.body, acknowledgedAt: b.dismissedBy?.includes(data.tenant?.id) ? b.createdAt : b.acknowledgedAt })),
  };
}

