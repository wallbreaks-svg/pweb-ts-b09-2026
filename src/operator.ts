// Halaman Panel Operator (operator.html)
// Bergantung pada src/common.ts (namespace global `Antrian`).
(() => {
  // Auth guard: cukup sudah login (admin, moderator, atau user).
  const session = Antrian.guard("any");
  if (!session) return;

  Antrian.ensureSeed();
  Antrian.bindSessionBar(session);

  const grid = document.getElementById("operator-grid") as HTMLElement;

  // Tautan ke Dashboard hanya untuk admin dan moderator.
  const dashboardLink = document.getElementById("dashboard-link");
  if (dashboardLink && Antrian.isAdminRole(session.role)) dashboardLink.hidden = false;

  // Untuk menandai nomor yang baru saja berganti (animasi).
  const lastCalled: Record<string, string | undefined> = {};
  let firstRender = true;

  function buildSlot(
    modifier: string,
    label: string,
    value: string | undefined,
    note?: string,
  ): { slot: HTMLElement; number: HTMLElement } {
    const slot = Antrian.el("div", `slot slot--${modifier}`);
    slot.appendChild(Antrian.el("span", "slot-label", label));
    const number = Antrian.el("strong", value ? "slot-number" : "slot-number is-empty", value ?? "-");
    slot.appendChild(number);
    if (note) slot.appendChild(Antrian.el("span", "slot-note", note));
    return { slot, number };
  }

  function buildLane(type: Antrian.QueueType, tickets: Antrian.Ticket[]): HTMLElement {
    const waiting = Antrian.waitingFor(type.code, tickets);
    const current = Antrian.currentFor(type.code, tickets);
    const next = waiting[0];

    const lane = Antrian.el("section", type.active ? "lane" : "lane is-inactive");
    Antrian.applyTypeColor(lane, type.code);

    // Kepala: kode, nama, jumlah yang menunggu
    const head = Antrian.el("header", "lane-head");
    head.append(
      Antrian.el("span", "code-tile", type.code),
      Antrian.el("h2", "lane-title", type.name),
    );
    if (!type.active) head.appendChild(Antrian.el("span", "badge badge--off", "Nonaktif"));
    head.appendChild(Antrian.el("span", "lane-count", `${waiting.length} menunggu`));

    // Papan nomor
    const board = Antrian.el("div", "lane-board");
    const now = buildSlot("now", "Sedang dipanggil", current?.label);
    if (current) now.slot.classList.add("is-live");
    if (current && !firstRender && lastCalled[type.code] !== current.id) {
      now.number.classList.add("is-fresh");
    }
    lastCalled[type.code] = current?.id;

    const nextNote = next ? `Prioritas ${Antrian.priorityLabel(next.priority)}` : undefined;
    const following = buildSlot("next", "Berikutnya", next?.label, nextNote);
    board.append(now.slot, following.slot);

    // Tombol aksi
    const actions = Antrian.el("div", "lane-actions");

    const callButton = Antrian.el("button", "btn btn--call", "Panggil Berikutnya");
    callButton.type = "button";
    callButton.disabled = !next;

    const skipButton = Antrian.el("button", "btn", "Lewati");
    skipButton.type = "button";
    skipButton.disabled = !current;

    const finishButton = Antrian.el("button", "btn", "Selesai");
    finishButton.type = "button";
    finishButton.disabled = !current;

    callButton.addEventListener("click", () => {
      const result = Antrian.callNext(type.code);
      if (result.ok && result.value) {
        Antrian.toast(`Memanggil ${result.value.label}.`, "success");
      } else {
        Antrian.toast(result.error ?? "Tiket gagal dipanggil.", "error");
      }
      render();
    });

    skipButton.addEventListener("click", () => {
      const result = Antrian.skipCurrent(type.code);
      if (result.ok && result.value) {
        Antrian.toast(`${result.value.label} dilewati karena tidak hadir.`, "info");
      } else {
        Antrian.toast(result.error ?? "Tiket gagal dilewati.", "error");
      }
      render();
    });

    finishButton.addEventListener("click", () => {
      const result = Antrian.finishCurrent(type.code);
      if (result.ok && result.value) {
        Antrian.toast(`${result.value.label} selesai.`, "success");
      } else {
        Antrian.toast(result.error ?? "Tiket gagal diselesaikan.", "error");
      }
      render();
    });

    actions.append(callButton, skipButton, finishButton);

    // Baris petunjuk selalu ada (kosong jika ada tiket menunggu) supaya tinggi semua jalur sama.
    const hint = Antrian.el("p", "lane-hint", next ? "" : "Tidak ada tiket menunggu untuk jenis antrian ini.");

    lane.append(head, board, actions, hint);
    return lane;
  }

  function render(): void {
    const types = Antrian.getTypes();
    const tickets = Antrian.getTickets();

    grid.replaceChildren();
    if (types.length === 0) {
      grid.appendChild(
        Antrian.el("p", "empty", "Belum ada jenis antrian. Admin dapat menambahkannya lewat Dashboard Admin."),
      );
      return;
    }

    for (const type of types) grid.appendChild(buildLane(type, tickets));
    firstRender = false;
  }

  render();
  Antrian.onDataChange(render);
})();