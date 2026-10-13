// Halaman Ambil Antrian (ambil-antrian.html), publik tanpa login.
// Bergantung pada src/common.ts (namespace global `Antrian`).
(() => {
  Antrian.ensureSeed();

  // Interval polling (ms), sebagai cadangan event `storage` dari tab lain.
  const POLL_MS = 2500;
  // Perkiraan: operator memanggil 1 tiket setiap 1 menit. Ubah angka ini jika
  // kecepatan layanan berubah.
  const CALL_INTERVAL_MIN = 1;
  // Id tiket terakhir yang diambil di tab ini (sessionStorage), supaya kartu
  // tiket tidak hilang saat halaman di-refresh.
  const KEY_LAST_TICKET = "lastTicketId";

  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  const takePanel = byId("take-panel");
  const takeForm = byId<HTMLFormElement>("take-form");
  const typeOptions = byId("type-options");
  const priorityOptions = byId("priority-options");
  const takeError = byId("take-error");
  const takeButton = byId<HTMLButtonElement>("take-btn");

  const ticketPanel = byId("ticket-panel");
  const ticketCard = byId("ticket-card");
  const againButton = byId<HTMLButtonElement>("again-btn");
  const printButton = byId<HTMLButtonElement>("print-btn");

  const PRIORITY_HINTS: Record<Antrian.Priority, string> = {
    normal: "Pengunjung umum",
    lansia: "Usia 60 tahun ke atas",
    disabilitas: "Penyandang disabilitas",
    vip: "Pasien prioritas khusus",
  };

  let selectedCode = "";
  let ticketId: string | null = null;

  // ---------- sessionStorage (aman jika tidak tersedia) ----------
  function rememberTicket(id: string | null): void {
    ticketId = id;
    try {
      if (id) sessionStorage.setItem(KEY_LAST_TICKET, id);
      else sessionStorage.removeItem(KEY_LAST_TICKET);
    } catch {
      // abaikan; kartu tiket hanya bertahan selama halaman tidak di-refresh
    }
  }

  function recallTicket(): string | null {
    try {
      return sessionStorage.getItem(KEY_LAST_TICKET);
    } catch {
      return null;
    }
  }

  // ---------- Perkiraan waktu tunggu ----------
  // Dengan `ahead` tiket di depan, nomor ini dipanggil pada panggilan ke-(ahead + 1).
  function estimateMinutes(ahead: number): number {
    return (Math.max(0, ahead) + 1) * CALL_INTERVAL_MIN;
  }

  function formatMinutes(total: number): string {
    if (total < 60) return `${total} menit`;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes === 0 ? `${hours} jam` : `${hours} jam ${minutes} menit`;
  }

  function buildEta(estimate: string): HTMLElement {
    const box = Antrian.el("p", "ticket-eta");
    box.append(
      Antrian.el("span", "ticket-eta-label", "Perkiraan dipanggil"),
      Antrian.el("strong", "ticket-eta-value", `sekitar ${estimate} lagi`),
    );
    return box;
  }

  // ---------- Pesan kesalahan ----------
  function showError(message: string): void {
    takeError.textContent = message;
    takeError.hidden = false;
  }

  function clearError(): void {
    takeError.textContent = "";
    takeError.hidden = true;
  }

  // ---------- Pilihan jenis antrian ----------
  let lastTypesSignature: string | undefined;

  // Pilihan digambar ulang hanya jika jenis aktif atau jumlah menunggu berubah,
  // supaya fokus keyboard tidak hilang tiap polling.
  function renderTypes(): void {
    const types = Antrian.getTypes().filter((t) => t.active);
    const tickets = Antrian.getTickets();

    const signature = types
      .map((t) => `${t.code}:${t.name}:${Antrian.waitingFor(t.code, tickets).length}`)
      .join("|");
    if (signature === lastTypesSignature) return;
    lastTypesSignature = signature;

    // Jenis yang dipilih lalu dinonaktifkan atau dihapus admin tidak boleh tetap terpilih.
    if (!types.some((t) => t.code === selectedCode)) selectedCode = "";

    typeOptions.replaceChildren();

    if (types.length === 0) {
      typeOptions.appendChild(
        Antrian.el("p", "empty", "Belum ada jenis antrian yang tersedia. Silakan hubungi petugas."),
      );
      takeButton.disabled = true;
      return;
    }
    takeButton.disabled = false;

    for (const type of types) {
      const waiting = Antrian.waitingFor(type.code, tickets).length;

      const label = Antrian.el("label", "choice");
      Antrian.applyTypeColor(label, type.code);

      const input = Antrian.el("input", "choice-input");
      input.type = "radio";
      input.name = "queue-type";
      input.value = type.code;
      input.checked = type.code === selectedCode;
      input.addEventListener("change", () => {
        selectedCode = type.code;
        clearError();
      });

      const body = Antrian.el("span", "choice-body");
      const text = Antrian.el("span", "choice-text");
      text.append(
        Antrian.el("span", "choice-title", type.name),
        Antrian.el(
          "span",
          "choice-meta",
          `${waiting} menunggu, sekitar ${formatMinutes(estimateMinutes(waiting))}`,
        ),
      );
      body.append(Antrian.el("span", "code-tile", type.code), text);

      label.append(input, body);
      typeOptions.appendChild(label);
    }
  }

  // ---------- Pilihan prioritas (sekali saja, dari Antrian.PRIORITIES) ----------
  function renderPriorities(): void {
    for (const priority of Antrian.PRIORITIES) {
      const label = Antrian.el("label", "choice choice--priority");

      const input = Antrian.el("input", "choice-input");
      input.type = "radio";
      input.name = "priority";
      input.value = priority.value;
      input.checked = priority.value === "normal";
      input.addEventListener("change", clearError);

      const body = Antrian.el("span", "choice-body");
      const text = Antrian.el("span", "choice-text");
      text.append(
        Antrian.el("span", "choice-title", priority.label),
        Antrian.el("span", "choice-meta", PRIORITY_HINTS[priority.value]),
      );
      body.appendChild(text);

      label.append(input, body);
      priorityOptions.appendChild(label);
    }
  }

  function selectedPriority(): string {
    const input = priorityOptions.querySelector<HTMLInputElement>("input[name='priority']:checked");
    return input?.value ?? "normal";
  }

  // ---------- Kartu tiket ----------
  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }

  // Teks status yang diperbarui otomatis mengikuti kondisi antrian.
  function describeStatus(ticket: Antrian.Ticket): { text: string; tone: string; eta?: string } {
    const tickets = Antrian.getTickets();

    if (ticket.status === "called") {
      return { text: "Nomor Anda sedang dipanggil. Silakan menuju loket.", tone: "called" };
    }
    if (ticket.status === "done") return { text: "Layanan untuk tiket ini sudah selesai.", tone: "done" };
    if (ticket.status === "skipped") {
      return { text: "Tiket dilewati karena tidak hadir. Silakan ambil nomor baru.", tone: "skipped" };
    }

    const ahead = Antrian.waitingFor(ticket.typeCode, tickets).findIndex((t) => t.id === ticket.id);
    const calling = Antrian.currentFor(ticket.typeCode, tickets);
    const aheadText = ahead <= 0 ? "Anda berikutnya." : `${ahead} antrian di depan Anda.`;
    const callingText = calling ? ` Sedang dipanggil: ${calling.label}.` : "";
    return {
      text: `${aheadText}${callingText}`,
      tone: "waiting",
      eta: formatMinutes(estimateMinutes(ahead)),
    };
  }

  function renderTicket(): void {
    if (ticketId === null) {
      ticketPanel.hidden = true;
      takePanel.hidden = false;
      return;
    }

    const ticket = Antrian.getTickets().find((t) => t.id === ticketId);
    if (!ticket) {
      // Antrian direset admin atau jenisnya dihapus: tiket sudah tidak berlaku.
      rememberTicket(null);
      ticketPanel.hidden = true;
      takePanel.hidden = false;
      Antrian.toast("Tiket sebelumnya sudah tidak berlaku karena antrian direset.", "info");
      return;
    }

    const type = Antrian.getTypes().find((t) => t.code === ticket.typeCode);
    const status = describeStatus(ticket);

    ticketCard.replaceChildren();
    Antrian.applyTypeColor(ticketCard, ticket.typeCode);
    ticketCard.className = `ticket-card ticket-card--${status.tone}`;

    const meta = Antrian.el("div", "ticket-meta");
    meta.append(
      Antrian.el("span", "ticket-service", type?.name ?? ticket.typeCode),
      Antrian.el("span", `badge badge--${ticket.priority}`, Antrian.priorityLabel(ticket.priority)),
      Antrian.el("span", "ticket-time", `Diambil pukul ${formatTime(ticket.createdAt)}`),
    );

    ticketCard.append(
      Antrian.el("span", "ticket-caption", "Nomor antrian Anda"),
      Antrian.el("strong", "ticket-number", ticket.label),
      meta,
      Antrian.el("p", "ticket-status", status.text),
    );
    if (status.eta) ticketCard.append(buildEta(status.eta));
    ticketCard.append(
      Antrian.el("p", "ticket-note", "Pantau layar antrian. Halaman ini diperbarui otomatis."),
    );

    takePanel.hidden = true;
    ticketPanel.hidden = false;
  }

  // ---------- Pengambilan tiket ----------
  takeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();

    if (selectedCode === "") {
      showError("Pilih jenis antrian terlebih dahulu.");
      return;
    }

    const result = Antrian.issueTicket(selectedCode, selectedPriority(), "kiosk");
    if (!result.ok || !result.value) {
      // Misalnya jenis baru saja dinonaktifkan admin.
      showError(result.error ?? "Tiket gagal diterbitkan.");
      lastTypesSignature = undefined;
      renderTypes();
      return;
    }

    rememberTicket(result.value.id);
    Antrian.toast(`Tiket ${result.value.label} berhasil diambil.`, "success");
    renderTicket();
    ticketPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  againButton.addEventListener("click", () => {
    rememberTicket(null);
    selectedCode = "";
    lastTypesSignature = undefined;
    takeForm.reset();
    clearError();
    renderTypes();
    renderTicket();
  });

  printButton.addEventListener("click", () => window.print());

  // ---------- Pembaruan otomatis ----------
  function refresh(): void {
    renderTypes();
    renderTicket();
  }

  // ---------- Mulai ----------
  renderPriorities();
  rememberTicket(recallTicket());
  refresh();

  // Jenis antrian baru dari Dashboard Admin muncul tanpa reload halaman.
  window.setInterval(refresh, POLL_MS);
  Antrian.onDataChange(refresh);
})();