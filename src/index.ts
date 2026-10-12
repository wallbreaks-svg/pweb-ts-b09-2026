// Halaman Dashboard Admin (index.html)
// Bergantung pada src/common.ts (namespace global `Antrian`).
(() => {
  // Auth guard + role guard: harus login sebagai admin atau moderator.
  const session = Antrian.guard("admin");
  if (!session) return;

  Antrian.ensureSeed();
  Antrian.bindSessionBar(session);

  // ---------- Elemen DOM ----------
  const byId = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Elemen #${id} tidak ditemukan`);
    return node;
  };

  const formById = (id: string): HTMLFormElement => {
    const node = byId(id);
    if (!(node instanceof HTMLFormElement)) throw new Error(`#${id} bukan form`);
    return node;
  };

  const inputById = (id: string): HTMLInputElement => {
    const node = byId(id);
    if (!(node instanceof HTMLInputElement)) throw new Error(`#${id} bukan input`);
    return node;
  };

  const selectById = (id: string): HTMLSelectElement => {
    const node = byId(id);
    if (!(node instanceof HTMLSelectElement)) throw new Error(`#${id} bukan select`);
    return node;
  };

  const buttonById = (id: string): HTMLButtonElement => {
    const node = byId(id);
    if (!(node instanceof HTMLButtonElement)) throw new Error(`#${id} bukan button`);
    return node;
  };

  const typeForm = formById("type-form");
  const codeInput = inputById("type-code");
  const nameInput = inputById("type-name");
  const typeError = byId("type-error");
  const typeList = byId("type-list");

  const issueForm = formById("issue-form");
  const issueType = selectById("issue-type");
  const issuePriority = selectById("issue-priority");
  const issueResult = byId("issue-result");

  const ticketGroups = byId("ticket-groups");
  const ticketFilter = selectById("ticket-filter");
  const resetButton = buttonById("reset-btn");

  // ---------- Render ----------
  function renderStats(tickets: Antrian.Ticket[]): void {
    const count = (status: Antrian.TicketStatus): string =>
      String(tickets.filter((t) => t.status === status).length);

    byId("stat-waiting").textContent = count("waiting");
    byId("stat-called").textContent = count("called");
    byId("stat-done").textContent = count("done");
    byId("stat-skipped").textContent = count("skipped");
  }

  function renderTypes(types: Antrian.QueueType[], tickets: Antrian.Ticket[]): void {
    typeList.replaceChildren();

    if (types.length === 0) {
      typeList.appendChild(
        Antrian.el("li", "empty", "Belum ada jenis antrian. Isi kode dan nama layanan di atas, lalu pilih Tambah."),
      );
      return;
    }

    for (const type of types) {
      const waiting = Antrian.waitingFor(type.code, tickets).length;

      const row = Antrian.el("li", type.active ? "type-row" : "type-row is-inactive");
      Antrian.applyTypeColor(row, type.code);

      const tile = Antrian.el("span", "code-tile", type.code);

      const info = Antrian.el("div", "type-info");
      const meta = Antrian.el("div", "type-meta");
      meta.appendChild(Antrian.el("span", "", `${waiting} menunggu`));
      if (!type.active) meta.appendChild(Antrian.el("span", "badge badge--off", "Nonaktif"));
      info.append(Antrian.el("div", "type-name", type.name), meta);

      const actions = Antrian.el("div", "type-actions");
      const toggle = Antrian.el("button", "btn btn--small", type.active ? "Nonaktifkan" : "Aktifkan");
      toggle.type = "button";
      const remove = Antrian.el("button", "btn btn--small btn--danger", "Hapus");
      remove.type = "button";
      actions.append(toggle, remove);

      toggle.addEventListener("click", () => {
        const result = Antrian.setTypeActive(type.code, !type.active);
        if (result.ok) {
          Antrian.toast(`${type.name} ${type.active ? "dinonaktifkan" : "diaktifkan"}.`, "success");
        } else {
          Antrian.toast(result.error ?? "Status jenis antrian gagal diubah.", "error");
        }
        renderAll();
      });

      remove.addEventListener("click", () => {
        const related = Antrian.getTickets().filter((t) => t.typeCode === type.code).length;
        const extra = related > 0 ? ` ${related} tiket di jenis ini ikut terhapus.` : "";
        if (!window.confirm(`Hapus jenis antrian "${type.name}"?${extra}`)) return;

        const result = Antrian.deleteType(type.code);
        if (result.ok) {
          Antrian.toast(`${type.name} dihapus.`, "success");
        } else {
          Antrian.toast(result.error ?? "Jenis antrian gagal dihapus.", "error");
        }
        renderAll();
      });

      row.append(tile, info, actions);
      typeList.appendChild(row);
    }
  }

  // Hanya jenis yang aktif yang bisa dipilih untuk tiket baru.
  function renderIssueSelect(types: Antrian.QueueType[]): void {
    const previous = issueType.value;
    const active = types.filter((t) => t.active);

    issueType.replaceChildren();
    issueType.appendChild(
      new Option(active.length > 0 ? "Pilih jenis antrian" : "Belum ada jenis antrian aktif", ""),
    );
    for (const type of active) {
      issueType.appendChild(new Option(`${type.name} (${type.code})`, type.code));
    }
    if (active.some((t) => t.code === previous)) issueType.value = previous;
  }

  const STATUS_ORDER: Record<Antrian.TicketStatus, number> = {
    called: 0,
    waiting: 1,
    skipped: 2,
    done: 3,
  };

  function compareDisplay(a: Antrian.Ticket, b: Antrian.Ticket): number {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.status === "waiting" ? Antrian.compareWaiting(a, b) : a.createdAt - b.createdAt;
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  }

  function renderTickets(types: Antrian.QueueType[], tickets: Antrian.Ticket[]): void {
    ticketGroups.replaceChildren();
    const showAll = ticketFilter.value === "all";
    let shown = 0;

    for (const type of types) {
      const list = tickets
        .filter((t) => t.typeCode === type.code)
        .filter((t) => showAll || t.status === "waiting" || t.status === "called")
        .sort(compareDisplay);
      if (list.length === 0) continue;
      shown += list.length;

      const group = Antrian.el("section", "ticket-group");
      Antrian.applyTypeColor(group, type.code);

      const head = Antrian.el("div", "group-head");
      head.append(
        Antrian.el("span", "code-tile", type.code),
        Antrian.el("span", "group-title", type.name),
        Antrian.el("span", "group-count", `${list.length} tiket`),
      );
      group.appendChild(head);

      const rows = Antrian.el("ul", "ticket-rows");
      for (const ticket of list) {
        const row = Antrian.el("li", ticket.status === "called" ? "ticket-row is-called" : "ticket-row");
        row.append(
          Antrian.el("span", "ticket-label", ticket.label),
          Antrian.el("span", `badge badge--${ticket.priority}`, Antrian.priorityLabel(ticket.priority)),
          Antrian.el("span", "ticket-time", formatTime(ticket.createdAt)),
          Antrian.el("span", `badge badge--${ticket.status}`, Antrian.statusLabel(ticket.status)),
        );
        rows.appendChild(row);
      }
      group.appendChild(rows);
      ticketGroups.appendChild(group);
    }

    if (shown === 0) {
      const message = showAll
        ? "Belum ada tiket. Terbitkan tiket pertama lewat form di atas."
        : "Tidak ada tiket yang sedang menunggu atau dipanggil.";
      ticketGroups.appendChild(Antrian.el("p", "empty", message));
    }
  }

  function renderAll(): void {
    const types = Antrian.getTypes();
    const tickets = Antrian.getTickets();
    renderStats(tickets);
    renderTypes(types, tickets);
    renderIssueSelect(types);
    renderTickets(types, tickets);
  }

  function showIssued(ticket: Antrian.Ticket): void {
    const type = Antrian.getTypes().find((t) => t.code === ticket.typeCode);

    issueResult.replaceChildren();
    Antrian.applyTypeColor(issueResult, ticket.typeCode);

    const info = Antrian.el("div", "issued-info");
    info.append(
      Antrian.el("strong", "", "Tiket diterbitkan"),
      Antrian.el("span", "", `${type?.name ?? ticket.typeCode}, prioritas ${Antrian.priorityLabel(ticket.priority)}`),
    );
    issueResult.append(Antrian.el("div", "issued-label", ticket.label), info);

    // Putar ulang animasi setiap kali ada tiket baru.
    issueResult.hidden = false;
    issueResult.classList.remove("is-new");
    void issueResult.offsetWidth;
    issueResult.classList.add("is-new");
  }

  // ---------- Form jenis antrian ----------
  function showTypeError(message: string, field: HTMLInputElement | null): void {
    typeError.textContent = message;
    typeError.hidden = false;
    codeInput.classList.remove("is-invalid");
    nameInput.classList.remove("is-invalid");
    if (field) {
      field.classList.add("is-invalid");
      field.focus();
    }
  }

  function clearTypeError(): void {
    typeError.textContent = "";
    typeError.hidden = true;
    codeInput.classList.remove("is-invalid");
    nameInput.classList.remove("is-invalid");
  }

  // Kode selalu 1 huruf kapital.
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, "");
    clearTypeError();
  });
  nameInput.addEventListener("input", clearTypeError);

  typeForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = Antrian.addType(codeInput.value, nameInput.value);
    if (!result.ok || !result.value) {
      const message = result.error ?? "Jenis antrian gagal ditambahkan.";
      // Pesan tentang kode ditandai di kolom kode, sisanya di kolom nama.
      const onCode = /^Kode/.test(message);
      showTypeError(message, onCode ? codeInput : nameInput);
      return;
    }

    clearTypeError();
    typeForm.reset();
    codeInput.focus();
    Antrian.toast(`${result.value.name} ditambahkan.`, "success");
    renderAll();
  });

  // ---------- Form penerbitan tiket ----------
  for (const priority of Antrian.PRIORITIES) {
    issuePriority.appendChild(new Option(priority.label, priority.value));
  }

  issueForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (issueType.value === "") {
      Antrian.toast("Pilih jenis antrian terlebih dahulu.", "error");
      issueType.focus();
      return;
    }

    const result = Antrian.issueTicket(issueType.value, issuePriority.value, "manual");
    if (!result.ok || !result.value) {
      Antrian.toast(result.error ?? "Tiket gagal diterbitkan.", "error");
      renderAll();
      return;
    }

    showIssued(result.value);
    Antrian.toast(`Tiket ${result.value.label} diterbitkan.`, "success");
    renderAll();
  });

  ticketFilter.addEventListener("change", renderAll);

  // ---------- Reset antrian ----------
  resetButton.addEventListener("click", () => {
    const total = Antrian.getTickets().length;
    const message =
      "Reset antrian? Semua tiket dihapus dan nomor kembali ke 001. Jenis antrian tetap ada." +
      (total > 0 ? ` (${total} tiket akan dihapus)` : "");
    if (!window.confirm(message)) return;

    Antrian.resetQueue();
    issueResult.hidden = true;
    Antrian.toast("Antrian direset. Nomor tiket mulai dari 001.", "success");
    renderAll();
  });

  // ---------- Mulai ----------
  renderAll();
  Antrian.onDataChange(renderAll);
})();