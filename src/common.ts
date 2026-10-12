// Modul bersama: sesi login, auth guard, dan data antrian di Local Storage.
//
// Dimuat lebih dulu dengan <script src="dist/common.js" defer></script>, lalu
// halaman lain memakainya lewat namespace global `Antrian`. Sengaja tidak
// memakai import/export supaya tetap cocok dengan <script ... defer> biasa.
//
// Skema Local Storage (jangan diubah sepihak, dipakai semua halaman):
//   token, role, firstName : sesi login (ditulis oleh login.ts)
//   queueTypes             : QueueType[]  data master jenis antrian
//   queueTickets           : Ticket[]     semua tiket antrian
//   queueCounters          : { [kode]: nomor terakhir yang sudah diterbitkan }

namespace Antrian {
  // ---------- Tipe ----------
  export type Role = "admin" | "moderator" | "user";
  export type Priority = "normal" | "lansia" | "disabilitas" | "vip";
  export type TicketStatus = "waiting" | "called" | "done" | "skipped";
  export type TicketSource = "manual" | "kiosk";

  export interface Session {
    token: string;
    role: Role;
    firstName: string;
  }

  export interface QueueType {
    code: string; // 1 huruf kapital, unik
    name: string; // nama layanan, unik (tidak peka huruf besar/kecil)
    active: boolean; // nonaktif = tidak bisa dipilih untuk tiket baru
  }

  export interface Ticket {
    id: string;
    typeCode: string;
    number: number;
    label: string; // contoh: A-001
    priority: Priority;
    status: TicketStatus;
    source: TicketSource;
    createdAt: number;
    calledAt?: number;
    finishedAt?: number;
  }

  export interface Result<T> {
    ok: boolean;
    error?: string;
    value?: T;
  }

  type Counters = Record<string, number>;

  // ---------- Konstanta ----------
  export const KEY_TOKEN = "token";
  export const KEY_ROLE = "role";
  export const KEY_FIRST_NAME = "firstName";
  export const KEY_TYPES = "queueTypes";
  export const KEY_TICKETS = "queueTickets";
  export const KEY_COUNTERS = "queueCounters";
  export const LOGIN_PAGE = "login.html";

  // Urutan di sini = urutan pilihan di form. `rank` kecil = didahulukan.
  export const PRIORITIES: { value: Priority; label: string; rank: number }[] = [
    { value: "normal", label: "Normal", rank: 3 },
    { value: "lansia", label: "Lansia", rank: 2 },
    { value: "disabilitas", label: "Disabilitas", rank: 1 },
    { value: "vip", label: "VIP", rank: 0 },
  ];

  const STATUS_LABELS: Record<TicketStatus, string> = {
    waiting: "Menunggu",
    called: "Dipanggil",
    done: "Selesai",
    skipped: "Dilewati",
  };

  const DEFAULT_TYPES: QueueType[] = [
    { code: "U", name: "Poli Umum", active: true },
    { code: "G", name: "Poli Gigi", active: true },
    { code: "F", name: "Farmasi", active: true },
    { code: "L", name: "Laboratorium", active: true },
  ];

  // ---------- Hasil operasi ----------
  function ok<T>(value: T): Result<T> {
    return { ok: true, value };
  }

  function fail<T>(error: string): Result<T> {
    return { ok: false, error };
  }

  // ---------- Local Storage & Validasi Tipe ----------
  function readJson(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeJson(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isStatus(value: unknown): value is TicketStatus {
    return value === "waiting" || value === "called" || value === "done" || value === "skipped";
  }

  function isQueueType(value: unknown): value is QueueType {
    return (
      isRecord(value) &&
      typeof value.code === "string" &&
      typeof value.name === "string" &&
      typeof value.active === "boolean"
    );
  }

  function isTicket(value: unknown): value is Ticket {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.typeCode === "string" &&
      typeof value.number === "number" &&
      typeof value.label === "string" &&
      typeof value.priority === "string" &&
      isPriority(value.priority) &&
      isStatus(value.status) &&
      (value.source === "manual" || value.source === "kiosk") &&
      typeof value.createdAt === "number"
    );
  }

  export function getTypes(): QueueType[] {
    const data = readJson(KEY_TYPES);
    return Array.isArray(data) ? data.filter(isQueueType) : [];
  }

  function saveTypes(types: QueueType[]): void {
    writeJson(KEY_TYPES, types);
  }

  export function getTickets(): Ticket[] {
    const data = readJson(KEY_TICKETS);
    return Array.isArray(data) ? data.filter(isTicket) : [];
  }

  function saveTickets(tickets: Ticket[]): void {
    writeJson(KEY_TICKETS, tickets);
  }

  function getCounters(): Counters {
    const data = readJson(KEY_COUNTERS);
    const counters: Counters = {};
    if (isRecord(data)) {
      for (const [code, value] of Object.entries(data)) {
        if (typeof value === "number") counters[code] = value;
      }
    }
    return counters;
  }

  function saveCounters(counters: Counters): void {
    writeJson(KEY_COUNTERS, counters);
  }

  // Isi data awal hanya saat key belum pernah dibuat. Jika admin menghapus
  // semua jenis antrian, datanya tetap kosong (tidak diisi ulang).
  export function ensureSeed(): void {
    try {
      if (localStorage.getItem(KEY_TYPES) === null) {
        saveTypes(DEFAULT_TYPES.map((t) => ({ ...t })));
      }
      if (localStorage.getItem(KEY_TICKETS) === null) saveTickets([]);
      if (localStorage.getItem(KEY_COUNTERS) === null) saveCounters({});
    } catch {
      // Local Storage tidak tersedia; halaman tetap tampil tanpa data awal.
    }
  }

  // Panggil callback saat data berubah dari tab lain (event `storage`).
  export function onDataChange(callback: () => void): void {
    window.addEventListener("storage", (event: StorageEvent) => {
      const watched = [KEY_TYPES, KEY_TICKETS, KEY_COUNTERS];
      if (event.key === null || watched.includes(event.key)) callback();
    });
  }

  // ---------- Sesi login ----------
  export function toRole(value: string | null | undefined): Role | null {
    const v = (value ?? "").toLowerCase();
    return v === "admin" || v === "moderator" || v === "user" ? v : null;
  }

  // Moderator memiliki hak akses yang sama dengan admin.
  export function isAdminRole(role: Role): boolean {
    return role === "admin" || role === "moderator";
  }

  export function getSession(): Session | null {
    try {
      const token = localStorage.getItem(KEY_TOKEN);
      const role = toRole(localStorage.getItem(KEY_ROLE));
      if (!token || !role) return null;
      const firstName = localStorage.getItem(KEY_FIRST_NAME) || "Pengguna";
      return { token, role, firstName };
    } catch {
      return null;
    }
  }

  // Auth guard. "any" = cukup sudah login, "admin" = admin atau moderator.
  // Jika tidak memenuhi, pengguna dipindah paksa ke halaman login.
  export function guard(access: "any" | "admin"): Session | null {
    const session = getSession();
    if (!session || (access === "admin" && !isAdminRole(session.role))) {
      window.location.replace(LOGIN_PAGE);
      return null;
    }
    return session;
  }

  // Hanya menghapus data sesi. Data antrian (jenis & tiket) sengaja dibiarkan.
  export function logout(): void {
    try {
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_ROLE);
      localStorage.removeItem(KEY_FIRST_NAME);
    } catch {
      // abaikan; tetap arahkan ke halaman login
    }
    window.location.replace(LOGIN_PAGE);
  }

  // ---------- Label ----------
  export function roleLabel(role: Role): string {
    if (role === "admin") return "Admin";
    if (role === "moderator") return "Moderator";
    return "User";
  }

  export function priorityLabel(priority: Priority): string {
    return PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
  }

  export function statusLabel(status: TicketStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  export function formatLabel(code: string, number: number): string {
    return `${code}-${String(number).padStart(3, "0")}`;
  }

  function isPriority(value: string): value is Priority {
    return PRIORITIES.some((p) => p.value === value);
  }

  function rankOf(priority: Priority): number {
    return PRIORITIES.find((p) => p.value === priority)?.rank ?? 99;
  }

  // ---------- Jenis antrian ----------
  export function addType(rawCode: string, rawName: string): Result<QueueType> {
    const code = rawCode.trim().toUpperCase();
    const name = rawName.trim().replace(/\s+/g, " ");

    if (!/^[A-Z]$/.test(code)) return fail("Kode harus berupa 1 huruf (A sampai Z).");
    if (name === "") return fail("Nama layanan wajib diisi.");
    if (name.length > 30) return fail("Nama layanan maksimal 30 karakter.");

    const types = getTypes();
    if (types.some((t) => t.code.toUpperCase() === code)) {
      return fail(`Kode ${code} sudah dipakai. Pilih huruf lain.`);
    }
    if (types.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return fail(`Nama "${name}" sudah ada. Gunakan nama lain.`);
    }

    const created: QueueType = { code, name, active: true };
    types.push(created);
    saveTypes(types);
    return ok(created);
  }

  export function setTypeActive(code: string, active: boolean): Result<QueueType> {
    const types = getTypes();
    const type = types.find((t) => t.code === code);
    if (!type) return fail("Jenis antrian tidak ditemukan.");
    type.active = active;
    saveTypes(types);
    return ok(type);
  }

  // Menghapus jenis beserta tiketnya. Mengembalikan jumlah tiket yang ikut terhapus.
  export function deleteType(code: string): Result<number> {
    const types = getTypes();
    if (!types.some((t) => t.code === code)) return fail("Jenis antrian tidak ditemukan.");

    const tickets = getTickets();
    const remaining = tickets.filter((t) => t.typeCode !== code);
    const counters = getCounters();
    delete counters[code];

    saveTypes(types.filter((t) => t.code !== code));
    saveTickets(remaining);
    saveCounters(counters);
    return ok(tickets.length - remaining.length);
  }

  // Mengosongkan semua tiket dan mengembalikan nomor ke awal. Jenis antrian tetap ada.
  export function resetQueue(): void {
    saveTickets([]);
    saveCounters({});
  }

  // ---------- Tiket ----------
  // Dipakai oleh Dashboard Admin (source "manual") dan halaman Ambil Antrian ("kiosk").
  export function issueTicket(
    typeCode: string,
    priority: string,
    source: TicketSource = "manual",
  ): Result<Ticket> {
    const type = getTypes().find((t) => t.code === typeCode);
    if (!type) return fail("Jenis antrian tidak ditemukan.");
    if (!type.active) return fail(`${type.name} sedang nonaktif dan tidak bisa dipilih.`);
    if (!isPriority(priority)) return fail("Tingkat prioritas tidak valid.");

    const counters = getCounters();
    const number = (counters[type.code] ?? 0) + 1;
    counters[type.code] = number;

    const now = Date.now();
    const label = formatLabel(type.code, number);
    const ticket: Ticket = {
      id: `${label}-${now.toString(36)}`,
      typeCode: type.code,
      number,
      label,
      priority,
      status: "waiting",
      source,
      createdAt: now,
    };

    const tickets = getTickets();
    tickets.push(ticket);
    saveTickets(tickets);
    saveCounters(counters);
    return ok(ticket);
  }

  // Urutan antrian: prioritas lebih tinggi dulu, lalu siapa yang datang lebih awal.
  export function compareWaiting(a: Ticket, b: Ticket): number {
    return (
      rankOf(a.priority) - rankOf(b.priority) ||
      a.createdAt - b.createdAt ||
      a.number - b.number
    );
  }

  export function waitingFor(code: string, tickets: Ticket[] = getTickets()): Ticket[] {
    return tickets
      .filter((t) => t.typeCode === code && t.status === "waiting")
      .sort(compareWaiting);
  }

  export function currentFor(code: string, tickets: Ticket[] = getTickets()): Ticket | undefined {
    return tickets.find((t) => t.typeCode === code && t.status === "called");
  }

  // Tiket yang sedang dipanggil otomatis selesai, lalu tiket berikutnya dipanggil.
  export function callNext(code: string): Result<Ticket> {
    const tickets = getTickets();
    const next = tickets
      .filter((t) => t.typeCode === code && t.status === "waiting")
      .sort(compareWaiting)[0];
    if (!next) return fail("Tidak ada tiket yang menunggu.");

    const now = Date.now();
    for (const t of tickets) {
      if (t.typeCode === code && t.status === "called") {
        t.status = "done";
        t.finishedAt = now;
      }
    }
    next.status = "called";
    next.calledAt = now;
    saveTickets(tickets);
    return ok(next);
  }

  function closeCurrent(code: string, status: "done" | "skipped"): Result<Ticket> {
    const tickets = getTickets();
    const current = tickets.find((t) => t.typeCode === code && t.status === "called");
    if (!current) return fail("Belum ada tiket yang sedang dipanggil.");
    current.status = status;
    current.finishedAt = Date.now();
    saveTickets(tickets);
    return ok(current);
  }

  // Menutup tiket yang sedang dipanggil tanpa memanggil tiket berikutnya.
  export function finishCurrent(code: string): Result<Ticket> {
    return closeCurrent(code, "done");
  }

  // Tiket yang tidak hadir ditandai "Dilewati".
  export function skipCurrent(code: string): Result<Ticket> {
    return closeCurrent(code, "skipped");
  }

  // ---------- Bantuan tampilan ----------
  export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Setiap jenis antrian punya warna sendiri (seperti papan petunjuk rumah sakit),
  // diturunkan dari hurufnya supaya konsisten di semua halaman.
  export function applyTypeColor(node: HTMLElement, code: string): void {
    const index = Math.max(0, code.toUpperCase().charCodeAt(0) - 65);
    const hue = Math.round((200 + index * 137.5) % 360);
    node.style.setProperty("--dept", `hsl(${hue}, 56%, 33%)`);
    node.style.setProperty("--dept-soft", `hsl(${hue}, 60%, 94%)`);
  }

  export function showPage(): void {
    document.documentElement.classList.remove("guarding");
  }

  // Mengisi navbar (nama, role, avatar) dan memasang tombol Logout.
  export function bindSessionBar(session: Session): void {
    const name = document.getElementById("user-name");
    const role = document.getElementById("user-role");
    const avatar = document.getElementById("user-avatar");
    const logoutButton = document.getElementById("logout-btn");

    if (name) name.textContent = session.firstName;
    if (role) role.textContent = roleLabel(session.role);
    if (avatar) avatar.textContent = session.firstName.charAt(0).toUpperCase();
    if (logoutButton) logoutButton.addEventListener("click", logout);
    showPage();
  }

  let toastTimer: number | undefined;

  export function toast(message: string, kind: "success" | "error" | "info" = "info"): void {
    let box = document.getElementById("toast");
    if (!box) {
      box = el("div", "toast");
      box.id = "toast";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const target: HTMLElement = box;
    target.textContent = message;
    target.className = `toast toast--${kind} is-visible`;

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      target.classList.remove("is-visible");
    }, 3200);
  }
}