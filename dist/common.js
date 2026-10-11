"use strict";
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
var Antrian;
(function (Antrian) {
    // ---------- Konstanta ----------
    Antrian.KEY_TOKEN = "token";
    Antrian.KEY_ROLE = "role";
    Antrian.KEY_FIRST_NAME = "firstName";
    Antrian.KEY_TYPES = "queueTypes";
    Antrian.KEY_TICKETS = "queueTickets";
    Antrian.KEY_COUNTERS = "queueCounters";
    Antrian.LOGIN_PAGE = "login.html";
    // Urutan di sini = urutan pilihan di form. `rank` kecil = didahulukan.
    Antrian.PRIORITIES = [
        { value: "normal", label: "Normal", rank: 3 },
        { value: "lansia", label: "Lansia", rank: 2 },
        { value: "disabilitas", label: "Disabilitas", rank: 1 },
        { value: "vip", label: "VIP", rank: 0 },
    ];
    const STATUS_LABELS = {
        waiting: "Menunggu",
        called: "Dipanggil",
        done: "Selesai",
        skipped: "Dilewati",
    };
    const DEFAULT_TYPES = [
        { code: "U", name: "Poli Umum", active: true },
        { code: "G", name: "Poli Gigi", active: true },
        { code: "F", name: "Farmasi", active: true },
        { code: "L", name: "Laboratorium", active: true },
    ];
    // ---------- Hasil operasi ----------
    function ok(value) {
        return { ok: true, value };
    }
    function fail(error) {
        return { ok: false, error };
    }
    // ---------- Local Storage ----------
    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        }
        catch {
            return fallback;
        }
    }
    function writeJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    function getTypes() {
        const data = readJson(Antrian.KEY_TYPES, []);
        return Array.isArray(data) ? data : [];
    }
    Antrian.getTypes = getTypes;
    function saveTypes(types) {
        writeJson(Antrian.KEY_TYPES, types);
    }
    function getTickets() {
        const data = readJson(Antrian.KEY_TICKETS, []);
        return Array.isArray(data) ? data : [];
    }
    Antrian.getTickets = getTickets;
    function saveTickets(tickets) {
        writeJson(Antrian.KEY_TICKETS, tickets);
    }
    function getCounters() {
        const data = readJson(Antrian.KEY_COUNTERS, {});
        return data !== null && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
    }
    function saveCounters(counters) {
        writeJson(Antrian.KEY_COUNTERS, counters);
    }
    // Isi data awal hanya saat key belum pernah dibuat. Jika admin menghapus
    // semua jenis antrian, datanya tetap kosong (tidak diisi ulang).
    function ensureSeed() {
        try {
            if (localStorage.getItem(Antrian.KEY_TYPES) === null) {
                saveTypes(DEFAULT_TYPES.map((t) => ({ ...t })));
            }
            if (localStorage.getItem(Antrian.KEY_TICKETS) === null)
                saveTickets([]);
            if (localStorage.getItem(Antrian.KEY_COUNTERS) === null)
                saveCounters({});
        }
        catch {
            // Local Storage tidak tersedia; halaman tetap tampil tanpa data awal.
        }
    }
    Antrian.ensureSeed = ensureSeed;
    // Panggil callback saat data berubah dari tab lain (event `storage`).
    function onDataChange(callback) {
        window.addEventListener("storage", (event) => {
            const watched = [Antrian.KEY_TYPES, Antrian.KEY_TICKETS, Antrian.KEY_COUNTERS];
            if (event.key === null || watched.includes(event.key))
                callback();
        });
    }
    Antrian.onDataChange = onDataChange;
    // ---------- Sesi login ----------
    function toRole(value) {
        const v = (value ?? "").toLowerCase();
        return v === "admin" || v === "moderator" || v === "user" ? v : null;
    }
    Antrian.toRole = toRole;
    // Moderator memiliki hak akses yang sama dengan admin.
    function isAdminRole(role) {
        return role === "admin" || role === "moderator";
    }
    Antrian.isAdminRole = isAdminRole;
    function getSession() {
        try {
            const token = localStorage.getItem(Antrian.KEY_TOKEN);
            const role = toRole(localStorage.getItem(Antrian.KEY_ROLE));
            if (!token || !role)
                return null;
            const firstName = localStorage.getItem(Antrian.KEY_FIRST_NAME) || "Pengguna";
            return { token, role, firstName };
        }
        catch {
            return null;
        }
    }
    Antrian.getSession = getSession;
    // Auth guard. "any" = cukup sudah login, "admin" = admin atau moderator.
    // Jika tidak memenuhi, pengguna dipindah paksa ke halaman login.
    function guard(access) {
        const session = getSession();
        if (!session || (access === "admin" && !isAdminRole(session.role))) {
            window.location.replace(Antrian.LOGIN_PAGE);
            return null;
        }
        return session;
    }
    Antrian.guard = guard;
    // Hanya menghapus data sesi. Data antrian (jenis & tiket) sengaja dibiarkan.
    function logout() {
        try {
            localStorage.removeItem(Antrian.KEY_TOKEN);
            localStorage.removeItem(Antrian.KEY_ROLE);
            localStorage.removeItem(Antrian.KEY_FIRST_NAME);
        }
        catch {
            // abaikan; tetap arahkan ke halaman login
        }
        window.location.replace(Antrian.LOGIN_PAGE);
    }
    Antrian.logout = logout;
    // ---------- Label ----------
    function roleLabel(role) {
        if (role === "admin")
            return "Admin";
        if (role === "moderator")
            return "Moderator";
        return "User";
    }
    Antrian.roleLabel = roleLabel;
    function priorityLabel(priority) {
        return Antrian.PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
    }
    Antrian.priorityLabel = priorityLabel;
    function statusLabel(status) {
        return STATUS_LABELS[status] ?? status;
    }
    Antrian.statusLabel = statusLabel;
    function formatLabel(code, number) {
        return `${code}-${String(number).padStart(3, "0")}`;
    }
    Antrian.formatLabel = formatLabel;
    function isPriority(value) {
        return Antrian.PRIORITIES.some((p) => p.value === value);
    }
    function rankOf(priority) {
        return Antrian.PRIORITIES.find((p) => p.value === priority)?.rank ?? 99;
    }
    // ---------- Jenis antrian ----------
    function addType(rawCode, rawName) {
        const code = rawCode.trim().toUpperCase();
        const name = rawName.trim().replace(/\s+/g, " ");
        if (!/^[A-Z]$/.test(code))
            return fail("Kode harus berupa 1 huruf (A sampai Z).");
        if (name === "")
            return fail("Nama layanan wajib diisi.");
        if (name.length > 30)
            return fail("Nama layanan maksimal 30 karakter.");
        const types = getTypes();
        if (types.some((t) => t.code.toUpperCase() === code)) {
            return fail(`Kode ${code} sudah dipakai. Pilih huruf lain.`);
        }
        if (types.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
            return fail(`Nama "${name}" sudah ada. Gunakan nama lain.`);
        }
        const created = { code, name, active: true };
        types.push(created);
        saveTypes(types);
        return ok(created);
    }
    Antrian.addType = addType;
    function setTypeActive(code, active) {
        const types = getTypes();
        const type = types.find((t) => t.code === code);
        if (!type)
            return fail("Jenis antrian tidak ditemukan.");
        type.active = active;
        saveTypes(types);
        return ok(type);
    }
    Antrian.setTypeActive = setTypeActive;
    // Menghapus jenis beserta tiketnya. Mengembalikan jumlah tiket yang ikut terhapus.
    function deleteType(code) {
        const types = getTypes();
        if (!types.some((t) => t.code === code))
            return fail("Jenis antrian tidak ditemukan.");
        const tickets = getTickets();
        const remaining = tickets.filter((t) => t.typeCode !== code);
        const counters = getCounters();
        delete counters[code];
        saveTypes(types.filter((t) => t.code !== code));
        saveTickets(remaining);
        saveCounters(counters);
        return ok(tickets.length - remaining.length);
    }
    Antrian.deleteType = deleteType;
    // Mengosongkan semua tiket dan mengembalikan nomor ke awal. Jenis antrian tetap ada.
    function resetQueue() {
        saveTickets([]);
        saveCounters({});
    }
    Antrian.resetQueue = resetQueue;
    // ---------- Tiket ----------
    // Dipakai oleh Dashboard Admin (source "manual") dan halaman Ambil Antrian ("kiosk").
    function issueTicket(typeCode, priority, source = "manual") {
        const type = getTypes().find((t) => t.code === typeCode);
        if (!type)
            return fail("Jenis antrian tidak ditemukan.");
        if (!type.active)
            return fail(`${type.name} sedang nonaktif dan tidak bisa dipilih.`);
        if (!isPriority(priority))
            return fail("Tingkat prioritas tidak valid.");
        const counters = getCounters();
        const number = (counters[type.code] ?? 0) + 1;
        counters[type.code] = number;
        const now = Date.now();
        const label = formatLabel(type.code, number);
        const ticket = {
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
    Antrian.issueTicket = issueTicket;
    // Urutan antrian: prioritas lebih tinggi dulu, lalu siapa yang datang lebih awal.
    function compareWaiting(a, b) {
        return (rankOf(a.priority) - rankOf(b.priority) ||
            a.createdAt - b.createdAt ||
            a.number - b.number);
    }
    Antrian.compareWaiting = compareWaiting;
    function waitingFor(code, tickets = getTickets()) {
        return tickets
            .filter((t) => t.typeCode === code && t.status === "waiting")
            .sort(compareWaiting);
    }
    Antrian.waitingFor = waitingFor;
    function currentFor(code, tickets = getTickets()) {
        return tickets.find((t) => t.typeCode === code && t.status === "called");
    }
    Antrian.currentFor = currentFor;
    // Tiket yang sedang dipanggil otomatis selesai, lalu tiket berikutnya dipanggil.
    function callNext(code) {
        const tickets = getTickets();
        const next = tickets
            .filter((t) => t.typeCode === code && t.status === "waiting")
            .sort(compareWaiting)[0];
        if (!next)
            return fail("Tidak ada tiket yang menunggu.");
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
    Antrian.callNext = callNext;
    function closeCurrent(code, status) {
        const tickets = getTickets();
        const current = tickets.find((t) => t.typeCode === code && t.status === "called");
        if (!current)
            return fail("Belum ada tiket yang sedang dipanggil.");
        current.status = status;
        current.finishedAt = Date.now();
        saveTickets(tickets);
        return ok(current);
    }
    // Menutup tiket yang sedang dipanggil tanpa memanggil tiket berikutnya.
    function finishCurrent(code) {
        return closeCurrent(code, "done");
    }
    Antrian.finishCurrent = finishCurrent;
    // Tiket yang tidak hadir ditandai "Dilewati".
    function skipCurrent(code) {
        return closeCurrent(code, "skipped");
    }
    Antrian.skipCurrent = skipCurrent;
    // ---------- Bantuan tampilan ----------
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className)
            node.className = className;
        if (text !== undefined)
            node.textContent = text;
        return node;
    }
    Antrian.el = el;
    // Setiap jenis antrian punya warna sendiri (seperti papan petunjuk rumah sakit),
    // diturunkan dari hurufnya supaya konsisten di semua halaman.
    function applyTypeColor(node, code) {
        const index = Math.max(0, code.toUpperCase().charCodeAt(0) - 65);
        const hue = Math.round((200 + index * 137.5) % 360);
        node.style.setProperty("--dept", `hsl(${hue}, 56%, 33%)`);
        node.style.setProperty("--dept-soft", `hsl(${hue}, 60%, 94%)`);
    }
    Antrian.applyTypeColor = applyTypeColor;
    function showPage() {
        document.documentElement.classList.remove("guarding");
    }
    Antrian.showPage = showPage;
    // Mengisi navbar (nama, role, avatar) dan memasang tombol Logout.
    function bindSessionBar(session) {
        const name = document.getElementById("user-name");
        const role = document.getElementById("user-role");
        const avatar = document.getElementById("user-avatar");
        const logoutButton = document.getElementById("logout-btn");
        if (name)
            name.textContent = session.firstName;
        if (role)
            role.textContent = roleLabel(session.role);
        if (avatar)
            avatar.textContent = session.firstName.charAt(0).toUpperCase();
        if (logoutButton)
            logoutButton.addEventListener("click", logout);
        showPage();
    }
    Antrian.bindSessionBar = bindSessionBar;
    let toastTimer;
    function toast(message, kind = "info") {
        let box = document.getElementById("toast");
        if (!box) {
            box = el("div", "toast");
            box.id = "toast";
            box.setAttribute("role", "status");
            box.setAttribute("aria-live", "polite");
            document.body.appendChild(box);
        }
        const target = box;
        target.textContent = message;
        target.className = `toast toast--${kind} is-visible`;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            target.classList.remove("is-visible");
        }, 3200);
    }
    Antrian.toast = toast;
})(Antrian || (Antrian = {}));
