import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import {
  api,
  saveSession,
  readSession,
  clearSession,
  setAccessToken,
  openTenantSocket,
  StoredSession,
} from "./lib/api";
import {
  BootstrapData,
  Building,
  MaintenanceRequest,
  TenantProfile,
  TicketMessage,
  Broadcast,
} from "./types";
import { capturePhysicalDeviceVerification } from "./lib/crash-reporting";

// -----------------------------------------------------------------------------
// Design tokens
// -----------------------------------------------------------------------------

const COLORS = {
  brand: "#8C1C13",
  brandDeep: "#6F1610",
  brandSoft: "#F6E6E3",
  bg: "#F5EFE8",
  surface: "#FFFFFF",
  surfaceMuted: "#FAF5EF",
  ink: "#2A1B18",
  inkSoft: "#5A4845",
  muted: "#8A7772",
  stroke: "#E3D6CA",
  danger: "#B03023",
  green: "#2F7D57",
  amber: "#B57A13",
  blue: "#2C5EA8",
};

const NAV_TABS = [
  { id: "home", label: "Home" },
  { id: "requests", label: "Requests" },
  { id: "documents", label: "Docs" },
  { id: "chat", label: "Chat" },
  { id: "profile", label: "Profile" },
] as const;
type TabId = typeof NAV_TABS[number]["id"];

// Push notifications handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushAsync() {
  if (Platform.OS === "web") return null;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch (err) {
    console.warn("push token registration failed", err);
    return null;
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusColor(status: string) {
  const s = String(status).toLowerCase();
  if (s === "resolved" || s === "closed") return COLORS.green;
  if (s === "assigned" || s === "in_progress") return COLORS.blue;
  if (s === "open" || s === "pending") return COLORS.amber;
  return COLORS.muted;
}

// -----------------------------------------------------------------------------
// Root App
// -----------------------------------------------------------------------------

export default function App() {
  const [booting, setBooting] = useState(true);
  const [tenant, setTenant] = useState<TenantProfile | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);

  // On mount: restore session if present
  useEffect(() => {
    (async () => {
      try {
        const stored = await readSession();
        if (stored?.accessToken) {
          setAccessToken(stored.accessToken);
          try {
            const me = await api.me();
            setTenant(me.tenant || me);
            setSession(stored);
          } catch {
            await clearSession();
          }
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // When authenticated: load bootstrap + register push token
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {
      try {
        const boot = await api.bootstrap();
        if (!cancelled) setBootstrap(boot);
      } catch (err: any) {
        Alert.alert("Failed to load", err.message || "Please try again.");
      }
    })();
    (async () => {
      const token = await registerForPushAsync();
      if (token) api.registerPushToken(token, Platform.OS).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const handleSignOut = useCallback(async () => {
    await clearSession();
    setTenant(null);
    setSession(null);
    setBootstrap(null);
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={styles.bootShell}>
        <ActivityIndicator color={COLORS.brand} size="large" />
        <Text style={styles.bootText}>Starting PropertyPortal…</Text>
      </SafeAreaView>
    );
  }

  if (!tenant) {
    return <AuthFlow onAuthenticated={(t, s) => { setTenant(t); setSession(s); }} />;
  }

  return (
    <TenantShell
      tenant={tenant}
      bootstrap={bootstrap}
      sessionToken={session?.accessToken || ""}
      onRefresh={async () => setBootstrap(await api.bootstrap())}
      onSignOut={handleSignOut}
    />
  );
}

// -----------------------------------------------------------------------------
// Authentication (login + register)
// -----------------------------------------------------------------------------

function AuthFlow({ onAuthenticated }: { onAuthenticated: (t: TenantProfile, s: StoredSession) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <SafeAreaView style={styles.authShell}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.authBrand}>
          <View style={styles.authMark}><Text style={styles.authMarkText}>P</Text></View>
          <Text style={styles.authTitle}>PropertyPortal</Text>
          <Text style={styles.authSubtitle}>Your building services, one tap away.</Text>
        </View>
        <View style={styles.authTabs}>
          <TouchableOpacity style={[styles.authTab, mode === "login" && styles.authTabActive]} onPress={() => setMode("login")}>
            <Text style={[styles.authTabText, mode === "login" && styles.authTabTextActive]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.authTab, mode === "register" && styles.authTabActive]} onPress={() => setMode("register")}>
            <Text style={[styles.authTabText, mode === "register" && styles.authTabTextActive]}>Create account</Text>
          </TouchableOpacity>
        </View>

        {mode === "login" ? (
          <LoginForm onAuthenticated={onAuthenticated} />
        ) : (
          <RegisterForm onAuthenticated={onAuthenticated} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LoginForm({ onAuthenticated }: { onAuthenticated: (t: TenantProfile, s: StoredSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert("Missing info", "Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.login(email.trim(), password);
      if (res.deletionRequestCancelled) {
        Alert.alert("Deletion request cancelled", "Welcome back. Your pending account deletion request has been cancelled.");
      }
      const session: StoredSession = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: res.expiresAt,
        tenantId: res.tenant?.id,
        email: res.tenant?.email,
      };
      await saveSession(session);
      onAuthenticated(res.tenant, session);
    } catch (err: any) {
      Alert.alert("Sign in failed", err.message || "Check your credentials and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.authCard}>
      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"
        placeholder="you@example.com" style={styles.input} placeholderTextColor={COLORS.muted}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
        placeholder="••••••••" style={styles.input} placeholderTextColor={COLORS.muted}
      />
      <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={styles.primaryBtnText}>{busy ? "Signing in…" : "Sign in"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function RegisterForm({ onAuthenticated }: { onAuthenticated: (t: TenantProfile, s: StoredSession) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [form, setForm] = useState({
    name: "", email: "", password: "", phone: "", buildingId: "", unit: "",
  });
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listBuildings();
        setBuildings(list);
      } catch (err: any) {
        Alert.alert("Cannot load buildings", err.message || "Please try again.");
      } finally {
        setLoadingBuildings(false);
      }
    })();
  }, []);

  async function submit() {
    const { name, email, password, buildingId } = form;
    if (!name.trim() || !email.trim() || !password || !buildingId) {
      Alert.alert("Missing info", "Name, email, password and building are required.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.register({
        name: name.trim(), email: email.trim(), password, phone: form.phone || undefined,
        buildingId, unit: form.unit || undefined,
      });
      const session: StoredSession = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresAt: res.expiresAt,
        tenantId: res.tenant?.id,
        email: res.tenant?.email,
      };
      await saveSession(session);
      onAuthenticated(res.tenant, session);
    } catch (err: any) {
      Alert.alert("Registration failed", err.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const selectedBuilding = buildings.find((b) => b.id === form.buildingId);

  return (
    <View style={styles.authCard}>
      <Text style={styles.label}>Full name</Text>
      <TextInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Jane Smith" style={styles.input} placeholderTextColor={COLORS.muted} />

      <Text style={styles.label}>Email</Text>
      <TextInput
        value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address"
        placeholder="you@example.com" style={styles.input} placeholderTextColor={COLORS.muted}
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry
        placeholder="At least 8 characters" style={styles.input} placeholderTextColor={COLORS.muted}
      />

      <Text style={styles.label}>Phone (optional)</Text>
      <TextInput
        value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad"
        placeholder="+971…" style={styles.input} placeholderTextColor={COLORS.muted}
      />

      <Text style={styles.label}>Building</Text>
      {loadingBuildings ? (
        <View style={[styles.input, { justifyContent: "center" }]}><ActivityIndicator color={COLORS.brand} /></View>
      ) : (
        <TouchableOpacity style={styles.input} onPress={() => setPickerOpen(true)}>
          <Text style={{ color: selectedBuilding ? COLORS.ink : COLORS.muted }}>
            {selectedBuilding ? `${selectedBuilding.name}${selectedBuilding.code ? ` · ${selectedBuilding.code}` : ""}` : "Tap to choose your building"}
          </Text>
        </TouchableOpacity>
      )}

      <Text style={styles.label}>Unit (optional)</Text>
      <TextInput
        value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })}
        placeholder="e.g. 12B" style={styles.input} placeholderTextColor={COLORS.muted}
      />

      <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
        <Text style={styles.primaryBtnText}>{busy ? "Creating…" : "Create account"}</Text>
      </TouchableOpacity>

      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose your building</Text>
            <FlatList
              data={buildings} keyExtractor={(b) => b.id}
              ListEmptyComponent={<Text style={styles.muted}>No buildings available yet.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.modalItem} onPress={() => { setForm({ ...form, buildingId: item.id }); setPickerOpen(false); }}>
                  <Text style={styles.modalItemTitle}>{item.name}</Text>
                  <Text style={styles.modalItemSub}>{[item.code, item.emirate, item.address].filter(Boolean).join(" · ")}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={() => setPickerOpen(false)}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Authenticated shell
// -----------------------------------------------------------------------------

function TenantShell({
  tenant, bootstrap, sessionToken, onRefresh, onSignOut,
}: {
  tenant: TenantProfile;
  bootstrap: BootstrapData | null;
  sessionToken: string;
  onRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabId>("home");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.brand} />
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topBarHello}>Hi, {tenant.name?.split(" ")[0] || "there"}</Text>
          <Text style={styles.topBarSub}>{bootstrap?.building?.name || "—"}{tenant.unit ? ` · Unit ${tenant.unit}` : ""}</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === "home" && <HomeTab tenant={tenant} bootstrap={bootstrap} refreshing={refreshing} onRefresh={refresh} />}
        {tab === "requests" && <RequestsTab bootstrap={bootstrap} refreshing={refreshing} onRefresh={refresh} sessionToken={sessionToken} />}
        {tab === "documents" && <DocumentsTab bootstrap={bootstrap} refreshing={refreshing} onRefresh={refresh} />}
        {tab === "chat" && <ChatTab bootstrap={bootstrap} sessionToken={sessionToken} />}
        {tab === "profile" && <ProfileTab tenant={tenant} building={bootstrap?.building} onSignOut={onSignOut} />}
      </View>

      <View style={styles.tabbar}>
        {NAV_TABS.map((t) => (
          <TouchableOpacity key={t.id} style={styles.tabBtn} onPress={() => setTab(t.id as TabId)}>
            <View style={[styles.tabDot, tab === t.id && { backgroundColor: COLORS.brand }]} />
            <Text style={[styles.tabLabel, tab === t.id && { color: COLORS.brand, fontWeight: "700" }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Home tab (summary + broadcasts)
// -----------------------------------------------------------------------------

function HomeTab({ tenant, bootstrap, refreshing, onRefresh }: {
  tenant: TenantProfile; bootstrap: BootstrapData | null;
  refreshing: boolean; onRefresh: () => Promise<void>;
}) {
  if (!bootstrap) {
    return <Centered><ActivityIndicator color={COLORS.brand} /></Centered>;
  }

  const openTickets = bootstrap.tickets.filter((t) => !["resolved", "closed"].includes(t.status));
  const activeBroadcasts = bootstrap.broadcasts.filter((b) => !b.acknowledgedAt);

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      contentContainerStyle={styles.scrollPad}
    >
      {activeBroadcasts.map((b) => <BroadcastCard key={b.id} broadcast={b} onRefresh={onRefresh} />)}

      <View style={styles.statsRow}>
        <StatTile label="Open tickets" value={String(openTickets.length)} />
        <StatTile label="Documents" value={String(bootstrap.documents.length)} />
        <StatTile label="Broadcasts" value={String(activeBroadcasts.length)} />
      </View>

      <Text style={styles.sectionTitle}>Recent tickets</Text>
      {bootstrap.tickets.length === 0 ? (
        <EmptyCard text="You haven't submitted any maintenance requests yet." />
      ) : (
        bootstrap.tickets.slice(0, 5).map((t) => <TicketRow key={t.id} ticket={t} />)
      )}
    </ScrollView>
  );
}

function BroadcastCard({ broadcast, onRefresh }: { broadcast: Broadcast; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function ack() {
    setBusy(true);
    try { await api.ackBroadcast(broadcast.id); await onRefresh(); }
    catch (err: any) { Alert.alert("Error", err.message); }
    finally { setBusy(false); }
  }
  return (
    <View style={[styles.card, { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand }]}>
      <Text style={{ color: COLORS.brandDeep, fontWeight: "700", fontSize: 15 }}>{broadcast.title}</Text>
      <Text style={{ color: COLORS.brandDeep, marginTop: 6 }}>{broadcast.body}</Text>
      <Text style={[styles.muted, { marginTop: 6 }]}>{fmtDate(broadcast.createdAt)}</Text>
      <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10 }]} onPress={ack} disabled={busy}>
        <Text style={styles.secondaryBtnText}>{busy ? "…" : "Got it"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <View style={[styles.card, { alignItems: "center" }]}><Text style={styles.muted}>{text}</Text></View>;
}

function TicketRow({ ticket, onPress }: { ticket: MaintenanceRequest; onPress?: () => void }) {
  const color = statusColor(ticket.status);
  const Container: any = onPress ? TouchableOpacity : View;
  return (
    <Container style={styles.card} onPress={onPress}>
      <View style={styles.rowBetween}>
        <Text style={styles.ticketTitle} numberOfLines={1}>{ticket.title || ticket.category}</Text>
        <View style={[styles.badge, { backgroundColor: color + "22", borderColor: color }]}>
          <Text style={[styles.badgeText, { color }]}>{ticket.status}</Text>
        </View>
      </View>
      <Text style={styles.muted} numberOfLines={2}>{ticket.description}</Text>
      <Text style={[styles.muted, { marginTop: 4, fontSize: 12 }]}>Updated {fmtDate(ticket.updatedAt)}</Text>
    </Container>
  );
}

// -----------------------------------------------------------------------------
// Requests tab
// -----------------------------------------------------------------------------

function RequestsTab({ bootstrap, refreshing, onRefresh, sessionToken }: {
  bootstrap: BootstrapData | null; refreshing: boolean; onRefresh: () => Promise<void>; sessionToken: string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!bootstrap) return <Centered><ActivityIndicator color={COLORS.brand} /></Centered>;
  const active = activeId ? bootstrap.tickets.find((t) => t.id === activeId) || null : null;

  return (
    <>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        contentContainerStyle={styles.scrollPad}
      >
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowForm(true)}>
          <Text style={styles.primaryBtnText}>+ New maintenance request</Text>
        </TouchableOpacity>
        <Text style={styles.sectionTitle}>My tickets</Text>
        {bootstrap.tickets.length === 0 ? (
          <EmptyCard text="No requests yet. Tap the button above to submit one." />
        ) : (
          bootstrap.tickets.map((t) => <TicketRow key={t.id} ticket={t} onPress={() => setActiveId(t.id)} />)
        )}
      </ScrollView>

      {showForm && <NewRequestModal onClose={() => setShowForm(false)} onSubmitted={async () => { setShowForm(false); await onRefresh(); }} />}
      {active && <TicketDetailModal ticketId={active.id} onClose={() => setActiveId(null)} sessionToken={sessionToken} onChanged={onRefresh} />}
    </>
  );
}

function NewRequestModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [form, setForm] = useState({ category: "Electrical", title: "", description: "", priority: "normal" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.title.trim() || !form.description.trim()) {
      Alert.alert("Missing info", "Add a short title and a description.");
      return;
    }
    setBusy(true);
    try {
      await api.submitRequest(form);
      onSubmitted();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New maintenance request</Text>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {["Electrical", "Plumbing", "HVAC", "Carpentry", "Cleaning", "Other"].map((c) => (
              <TouchableOpacity key={c}
                style={[styles.chip, form.category === c && { backgroundColor: COLORS.brand }]}
                onPress={() => setForm({ ...form, category: c })}
              >
                <Text style={[styles.chipText, form.category === c && { color: "#fff", fontWeight: "700" }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Title</Text>
          <TextInput value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} style={styles.input} placeholder="e.g. Broken AC in living room" placeholderTextColor={COLORS.muted} />
          <Text style={styles.label}>Description</Text>
          <TextInput value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} multiline placeholder="Describe the issue…" placeholderTextColor={COLORS.muted} />
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chipRow}>
            {["normal", "urgent"].map((p) => (
              <TouchableOpacity key={p}
                style={[styles.chip, form.priority === p && { backgroundColor: COLORS.brand }]}
                onPress={() => setForm({ ...form, priority: p })}
              >
                <Text style={[styles.chipText, form.priority === p && { color: "#fff", fontWeight: "700" }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={onClose}><Text style={styles.secondaryBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
              <Text style={styles.primaryBtnText}>{busy ? "Submitting…" : "Submit"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TicketDetailModal({ ticketId, onClose, sessionToken, onChanged }: {
  ticketId: string; onClose: () => void; sessionToken: string; onChanged: () => Promise<void>;
}) {
  const [ticket, setTicket] = useState<MaintenanceRequest | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<any>>(null);

  const load = useCallback(async () => {
    try {
      const t = await api.getTicket(ticketId);
      setTicket(t);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  // Subscribe to this ticket's room over WebSocket for live message updates.
  useEffect(() => {
    if (!sessionToken) return;
    const sock = openTenantSocket(sessionToken, {
      onMessage: (msg) => {
        if (msg?.event === "ticket:message" && (msg?.data?.requestId || msg?.data?.ticketId) === ticketId) load();
        if (msg?.event === "ticket:updated" && msg?.data?.id === ticketId) load();
      },
    });
    sock.subscribe(`ticket:${ticketId}`);
    return () => sock.close();
  }, [sessionToken, ticketId, load]);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.postTicketMessage(ticketId, message.trim());
      setMessage("");
      await load();
      await onChanged();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarHello} numberOfLines={1}>{ticket?.title || "Ticket"}</Text>
            <Text style={styles.topBarSub}>{ticket?.reference || ticket?.id?.slice(0, 8)} · {ticket?.status}</Text>
          </View>
          <TouchableOpacity onPress={onClose}><Text style={{ color: "#fff", fontWeight: "600", padding: 8 }}>Close</Text></TouchableOpacity>
        </View>
        {!ticket ? <Centered><ActivityIndicator color={COLORS.brand} /></Centered> : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={10}>
            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <Text style={{ color: COLORS.inkSoft }}>{ticket.description}</Text>
              <Text style={[styles.muted, { marginTop: 6, fontSize: 12 }]}>Created {fmtDate(ticket.createdAt)}{ticket.technicianName ? ` · Technician: ${ticket.technicianName}` : ""}</Text>
            </View>
            <FlatList
              ref={listRef}
              data={ticket.messages || []}
              keyExtractor={(m) => m.id}
              style={{ flex: 1, marginTop: 12 }}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              ListEmptyComponent={<Text style={[styles.muted, { textAlign: "center", marginTop: 20 }]}>No messages yet. Say hi.</Text>}
              renderItem={({ item }: { item: TicketMessage }) => (
                <View style={[styles.chatMsg, item.authorKind === "tenant" ? styles.chatMsgMe : styles.chatMsgThem]}>
                  <Text style={item.authorKind === "tenant" ? styles.chatMsgTextMe : styles.chatMsgText}>{item.message}</Text>
                  <Text style={[styles.chatMsgMeta, item.authorKind === "tenant" ? { color: "#ffe3dd" } : { color: COLORS.muted }]}>
                    {item.authorName || item.authorKind} · {fmtDate(item.createdAt)}
                  </Text>
                </View>
              )}
            />
            <View style={styles.chatInputRow}>
              <TextInput value={message} onChangeText={setMessage} placeholder="Message…" placeholderTextColor={COLORS.muted} style={[styles.input, { flex: 1 }]} />
              <TouchableOpacity style={[styles.primaryBtn, { paddingHorizontal: 18, paddingVertical: 12 }]} onPress={send} disabled={sending}>
                <Text style={styles.primaryBtnText}>{sending ? "…" : "Send"}</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Documents tab
// -----------------------------------------------------------------------------

function DocumentsTab({ bootstrap, refreshing, onRefresh }: {
  bootstrap: BootstrapData | null; refreshing: boolean; onRefresh: () => Promise<void>;
}) {
  if (!bootstrap) return <Centered><ActivityIndicator color={COLORS.brand} /></Centered>;
  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
      contentContainerStyle={styles.scrollPad}
    >
      <Text style={styles.sectionTitle}>My documents</Text>
      {bootstrap.documents.length === 0 ? (
        <EmptyCard text="No documents uploaded yet. Your building admin will let you know if any are needed." />
      ) : (
        bootstrap.documents.map((d) => (
          <View key={d.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.ticketTitle}>{d.fileName}</Text>
              <View style={[styles.badge, { borderColor: COLORS.stroke }]}><Text style={styles.badgeText}>{d.status}</Text></View>
            </View>
            <Text style={styles.muted}>{d.kind}</Text>
            <Text style={[styles.muted, { fontSize: 12, marginTop: 4 }]}>Uploaded {fmtDate(d.createdAt)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

// -----------------------------------------------------------------------------
// Chat tab (consolidated list of ticket conversations)
// -----------------------------------------------------------------------------

function ChatTab({ bootstrap, sessionToken }: { bootstrap: BootstrapData | null; sessionToken: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!bootstrap) return <Centered><ActivityIndicator color={COLORS.brand} /></Centered>;

  return (
    <>
      <ScrollView contentContainerStyle={styles.scrollPad}>
        <Text style={styles.sectionTitle}>Conversations</Text>
        {bootstrap.tickets.length === 0 ? (
          <EmptyCard text="You can chat with building staff once you open a maintenance request." />
        ) : (
          bootstrap.tickets.map((t) => (
            <TouchableOpacity key={t.id} style={styles.card} onPress={() => setActiveId(t.id)}>
              <View style={styles.rowBetween}>
                <Text style={styles.ticketTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.muted}>{fmtDate(t.updatedAt)}</Text>
              </View>
              <Text style={styles.muted} numberOfLines={1}>{t.reference || t.id.slice(0, 8)} · {t.status}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
      {activeId && <TicketDetailModal ticketId={activeId} sessionToken={sessionToken} onClose={() => setActiveId(null)} onChanged={async () => {}} />}
    </>
  );
}

// -----------------------------------------------------------------------------
// Profile tab
// -----------------------------------------------------------------------------

function ProfileTab({ tenant, building, onSignOut }: {
  tenant: TenantProfile; building: Building | undefined; onSignOut: () => Promise<void>;
}) {
  const [deletion, setDeletion] = useState<any>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);

  useEffect(() => {
    api.accountDeletionStatus().then(setDeletion).catch(() => {});
  }, []);

  async function requestDeletion() {
    Alert.alert(
      "Delete account access?",
      "This cannot be undone after 30 days. Your profile access will be disabled then, while building, apartment, maintenance and ticket records are retained. Sign in during the 30-day period to cancel automatically.",
      [
        { text: "Keep account", style: "cancel" },
        { text: "Continue", style: "destructive", onPress: () => Alert.alert(
          "Final confirmation",
          "Are you sure? Your account access is scheduled to be disabled in 30 days.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Delete my account", style: "destructive", onPress: async () => {
              setDeletionBusy(true);
              try {
                const result = await api.requestAccountDeletion();
                setDeletion(result);
                Alert.alert("Request scheduled", `Account access will be disabled after ${fmtDate(result.scheduledFor)}. Signing in before then cancels the request.`);
                await onSignOut();
              } catch (error: any) {
                Alert.alert("Request failed", error.message || "Please try again.");
              } finally { setDeletionBusy(false); }
            } },
          ],
        ) },
      ],
    );
  }

  async function cancelDeletion() {
    setDeletionBusy(true);
    try {
      await api.cancelAccountDeletion();
      setDeletion(null);
      Alert.alert("Request cancelled", "Your account will remain active.");
    } catch (error: any) {
      Alert.alert("Cancellation failed", error.message || "Please try again.");
    } finally { setDeletionBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollPad}>
      <View style={styles.card}>
        <Text style={styles.ticketTitle}>{tenant.name}</Text>
        <Text style={styles.muted}>{tenant.email}</Text>
        <View style={{ height: 12 }} />
        <Row label="Building" value={building?.name || "—"} />
        <Row label="Address" value={building?.address || "—"} />
        <Row label="Unit" value={tenant.unit || "—"} />
        <Row label="Phone" value={tenant.phone || "—"} />
      </View>
      {deletion?.scheduledFor ? (
        <View style={[styles.card, { marginTop: 16, borderColor: COLORS.amber }]}> 
          <Text style={styles.ticketTitle}>Account deletion pending</Text>
          <Text style={styles.muted}>Access is scheduled to be disabled after {fmtDate(deletion.scheduledFor)}. Operational property and maintenance records will be retained.</Text>
          <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 12 }]} disabled={deletionBusy} onPress={cancelDeletion}>
            <Text style={styles.secondaryBtnText}>{deletionBusy ? "Cancelling…" : "Cancel deletion request"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 20, borderColor: COLORS.danger }]} disabled={deletionBusy} onPress={requestDeletion}>
          <Text style={[styles.secondaryBtnText, { color: COLORS.danger }]}>{deletionBusy ? "Scheduling…" : "Delete my account"}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 20 }]} onPress={() => {
        Alert.alert("Sign out", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: () => { onSignOut(); } },
        ]);
      }}>
        <Text style={styles.secondaryBtnText}>Sign out</Text>
      </TouchableOpacity>
      {process.env.EXPO_PUBLIC_CRASH_TEST_ENABLED === "true" && (
        <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 12 }]} onPress={() => {
          capturePhysicalDeviceVerification();
          Alert.alert("Verification event sent", "Confirm the event is symbolicated and tagged with this store build's immutable release in Sentry.");
        }}>
          <Text style={styles.secondaryBtnText}>Send crash-reporting verification event</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", paddingVertical: 6 }}>
      <Text style={[styles.muted, { width: 90 }]}>{label}</Text>
      <Text style={{ flex: 1, color: COLORS.ink }}>{value}</Text>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  bootShell: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  bootText: { color: COLORS.inkSoft },

  authShell: { flex: 1, backgroundColor: COLORS.bg },
  authScroll: { padding: 24, paddingBottom: 60 },
  authBrand: { alignItems: "center", marginTop: 30, marginBottom: 18 },
  authMark: { width: 60, height: 60, borderRadius: 14, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  authMarkText: { color: "#fff", fontSize: 26, fontWeight: "700" },
  authTitle: { fontSize: 24, fontWeight: "700", color: COLORS.ink, marginTop: 12 },
  authSubtitle: { color: COLORS.muted, marginTop: 4, textAlign: "center" },
  authTabs: { flexDirection: "row", marginTop: 20, backgroundColor: COLORS.surfaceMuted, padding: 4, borderRadius: 12, borderWidth: 1, borderColor: COLORS.stroke },
  authTab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
  authTabActive: { backgroundColor: COLORS.brand },
  authTabText: { color: COLORS.inkSoft, fontWeight: "600" },
  authTabTextActive: { color: "#fff" },
  authCard: { marginTop: 16, backgroundColor: COLORS.surface, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: COLORS.stroke },

  label: { fontSize: 12, fontWeight: "700", color: COLORS.inkSoft, marginTop: 12, marginBottom: 6, letterSpacing: 0.3 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.stroke, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: COLORS.ink },
  primaryBtn: { backgroundColor: COLORS.brand, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { backgroundColor: COLORS.surface, borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: COLORS.stroke },
  secondaryBtnText: { color: COLORS.ink, fontWeight: "600", fontSize: 15 },

  shell: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { backgroundColor: COLORS.brand, paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  topBarHello: { color: "#fff", fontSize: 18, fontWeight: "700" },
  topBarSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 },

  tabbar: { flexDirection: "row", backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.stroke, paddingVertical: 8 },
  tabBtn: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "transparent" },
  tabLabel: { fontSize: 12, color: COLORS.inkSoft },

  scrollPad: { padding: 16, paddingBottom: 40, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.ink, marginTop: 18, marginBottom: 6 },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.stroke, borderRadius: 12, padding: 14 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  ticketTitle: { fontSize: 15, fontWeight: "700", color: COLORS.ink, flex: 1 },
  muted: { color: COLORS.muted, fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: "700", color: COLORS.inkSoft, textTransform: "capitalize" },

  statsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  statTile: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.stroke, alignItems: "flex-start" },
  statValue: { fontSize: 22, fontWeight: "700", color: COLORS.ink },
  statLabel: { fontSize: 12, color: COLORS.muted, marginTop: 2 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.stroke, backgroundColor: COLORS.surface },
  chipText: { color: COLORS.inkSoft },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(42,27,24,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: 20, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "90%" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: COLORS.ink, marginBottom: 8 },
  modalItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.stroke },
  modalItemTitle: { fontSize: 15, fontWeight: "700", color: COLORS.ink },
  modalItemSub: { color: COLORS.muted, fontSize: 13, marginTop: 2 },

  chatMsg: { padding: 10, borderRadius: 12, maxWidth: "82%" },
  chatMsgMe: { backgroundColor: COLORS.brand, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  chatMsgThem: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.stroke, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  chatMsgText: { color: COLORS.ink },
  chatMsgTextMe: { color: "#fff" },
  chatMsgMeta: { fontSize: 11, marginTop: 4 },
  chatInputRow: { flexDirection: "row", padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: COLORS.stroke, backgroundColor: COLORS.surface },
});
