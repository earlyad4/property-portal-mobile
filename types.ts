export type TicketStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type DocumentStatus = "pending" | "verified" | "rejected";
export type QualityStatus = "pending" | "under_review" | "completed";

export type Building = {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  emirate: string | null;
};

export type TenantProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  buildingId: string;
  buildingName?: string;
  unit: string | null;
  leaseStart?: string | null;
  leaseEnd?: string | null;
  deletion_requested_at?: string | null;
  deletion_scheduled_for?: string | null;
};

export type TicketMessage = {
  id: string;
  ticketId: string;
  message: string;
  authorKind: "tenant" | "admin" | "technician" | "system";
  authorName?: string | null;
  createdAt: string;
};

export type MaintenanceRequest = {
  id: string;
  reference?: string;
  tenantId: string;
  buildingId: string;
  unit: string | null;
  category: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority?: string | null;
  technicianId?: string | null;
  technicianName?: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: TicketMessage[];
};

export type DocumentRecord = {
  id: string;
  tenantId: string;
  kind: string;
  fileName: string;
  status: DocumentStatus;
  note?: string | null;
  createdAt: string;
};

export type QualityReport = {
  id: string;
  tenantId: string;
  buildingId: string;
  category: string;
  title: string;
  description: string;
  status: QualityStatus;
  rating?: number | null;
  createdAt: string;
};

export type Broadcast = {
  id: string;
  buildingId: string;
  title: string;
  body: string;
  createdAt: string;
  acknowledgedAt?: string | null;
};

export type BootstrapData = {
  tenant: TenantProfile;
  building: Building;
  tickets: MaintenanceRequest[];
  documents: DocumentRecord[];
  qualityReports: QualityReport[];
  broadcasts: Broadcast[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};
