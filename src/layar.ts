// Halaman Layar Antrian (layar.html), publik tanpa login.
// Bergantung pada src/common.ts (namespace global `Antrian`).
(() => {
  Antrian.ensureSeed();

  // Interval polling (ms). Ketentuan tugas: 2-3 detik.
  const POLL_MS = 2500;
  const KEY_SOUND = "layarSound";

  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

  const grid = byId("screen-grid");
  const latestNumber = byId("latest-number");
  const latestName = byId("latest-name");
  const clockTime = byId("clock-time");
  const clockDate = byId("clock-date");
  const fullscreenButton = byId<HTMLButtonElement>("fullscreen-btn");
  const soundButton = byId<HTMLButtonElement>("sound-btn");

  // ---------- Jam ----------
  function tickClock(): void {
    const now = new Date();
    clockTime.textContent = now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    clockDate.textContent = now.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // ---------- Suara panggilan ----------
  // Browser hanya mengizinkan suara setelah ada interaksi pengguna, jadi
  // suara baru aktif setelah tombol "Suara" ditekan.
  let soundOn = false;
  let audioContext: AudioContext | null = null;

  try {
    soundOn = localStorage.getItem(KEY_SOUND) === "on";
  } catch {
    soundOn = false;
  }

  function updateSoundButton(): void {
    soundButton.textContent = soundOn ? "Suara: aktif" : "Suara: mati";
    soundButton.setAttribute("aria-pressed", String(soundOn));
  }

  // Dua nada pendek sebelum pengumuman (Web Audio API, tanpa file audio).
  function chime(): void {
    try {
      if (!audioContext) audioContext = new AudioContext();
      const ctx = audioContext;
      if (ctx.state === "suspended") void ctx.resume();

      const notes = [880, 659.25];
      notes.forEach((frequency, index) => {
        const start = ctx.currentTime + index * 0.28;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.28);
      });
    } catch {
      // Audio tidak tersedia; tampilan visual tetap berjalan.
    }
  }

  function announce(ticket: Antrian.Ticket, typeName: string): void {
    if (!soundOn) return;
    chime();
    if (!("speechSynthesis" in window)) return;

    const text = `Nomor antrian ${ticket.typeCode} ${ticket.number}, silakan menuju ${typeName}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.rate = 0.9;
    // Beri jeda supaya nada selesai dulu. Utterance antre otomatis jika ada beberapa.
    window.setTimeout(() => window.speechSynthesis.speak(utterance), 600);
  }

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    try {
      localStorage.setItem(KEY_SOUND, soundOn ? "on" : "off");
    } catch {
      // abaikan; pengaturan hanya berlaku selama halaman terbuka
    }
    updateSoundButton();
    if (soundOn) {
      // Panggilan ini dari klik pengguna, sehingga browser mengizinkan audio berikutnya.
      chime();
      Antrian.toast("Suara panggilan diaktifkan.", "success");
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  });

  // ---------- Layar penuh ----------
  function updateFullscreenButton(): void {
    const active = document.fullscreenElement !== null;
    fullscreenButton.textContent = active ? "Keluar layar penuh" : "Layar penuh";
    fullscreenButton.setAttribute("aria-pressed", String(active));
  }

  if (!document.fullscreenEnabled) fullscreenButton.hidden = true;

  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      Antrian.toast("Layar penuh tidak bisa diaktifkan di browser ini.", "error");
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  // ---------- Render ----------
  // Id tiket yang terakhir tampil per jenis, untuk mendeteksi panggilan baru.
  const lastShown: Record<string, string | undefined> = {};
  let firstRender = true;
  let lastSignature: string | undefined;

  // Perubahan data dikenali dari isi Local Storage, sehingga layar tidak
  // digambar ulang (dan animasinya tidak diputar ulang) saat tidak ada yang berubah.
  function signature(): string {
    try {
      return `${localStorage.getItem(Antrian.KEY_TYPES) ?? ""}|${localStorage.getItem(Antrian.KEY_TICKETS) ?? ""}`;
    } catch {
      return "";
    }
  }

  function buildCard(
    type: Antrian.QueueType,
    tickets: Antrian.Ticket[],
  ): { card: HTMLElement; fresh: boolean } {
    const waiting = Antrian.waitingFor(type.code, tickets);
    const current = Antrian.currentFor(type.code, tickets);
    const next = waiting[0];

    const card = Antrian.el("article", current ? "screen-card is-live" : "screen-card");
    Antrian.applyTypeColor(card, type.code);

    const head = Antrian.el("header", "card-head");
    head.append(
      Antrian.el("span", "code-tile", type.code),
      Antrian.el("h2", "card-title", type.name),
    );

    const fresh = !firstRender && current !== undefined && lastShown[type.code] !== current.id;
    const body = Antrian.el("div", "card-body");
    body.append(
      Antrian.el("span", "card-label", "Sedang dipanggil"),
      Antrian.el(
        "strong",
        `card-number${current ? "" : " is-empty"}${fresh ? " is-fresh" : ""}`,
        current?.label ?? "-",
      ),
    );

    const foot = Antrian.el("footer", "card-foot");
    const remaining = Antrian.el("span", "card-remaining");
    remaining.append(
      Antrian.el("strong", "", String(waiting.length)),
      Antrian.el("span", "", " menunggu"),
    );
    foot.append(remaining, Antrian.el("span", "card-next", next ? `Berikutnya ${next.label}` : "Tidak ada antrian"));

    card.append(head, body, foot);
    return { card, fresh };
  }

  // Panggilan terbaru dari semua jenis aktif, ditampilkan besar di bagian atas.
  function renderLatest(types: Antrian.QueueType[], tickets: Antrian.Ticket[]): void {
    const activeCodes = new Set(types.map((t) => t.code));
    let latest: Antrian.Ticket | undefined;
    for (const t of tickets) {
      if (t.status !== "called" || !activeCodes.has(t.typeCode)) continue;
      if (!latest || (t.calledAt ?? 0) > (latest.calledAt ?? 0)) latest = t;
    }

    if (!latest) {
      latestNumber.textContent = "-";
      latestNumber.classList.add("is-empty");
      latestName.textContent = "Belum ada nomor yang dipanggil";
      return;
    }

    const typeName = types.find((t) => t.code === latest?.typeCode)?.name ?? latest.typeCode;
    const changed = latestNumber.textContent !== latest.label;
    latestNumber.textContent = latest.label;
    latestNumber.classList.remove("is-empty");
    latestName.textContent = `Silakan menuju ${typeName}`;

    if (changed && !firstRender) {
      latestNumber.classList.remove("is-fresh");
      void latestNumber.offsetWidth; // putar ulang animasi
      latestNumber.classList.add("is-fresh");
    }
  }

  function render(): void {
    const current = signature();
    if (current === lastSignature) return;
    lastSignature = current;

    // Hanya jenis antrian aktif yang tampil di layar.
    const types = Antrian.getTypes().filter((t) => t.active);
    const tickets = Antrian.getTickets();

    grid.replaceChildren();
    if (types.length === 0) {
      grid.appendChild(Antrian.el("p", "empty", "Belum ada jenis antrian yang aktif."));
    }

    for (const type of types) {
      const { card, fresh } = buildCard(type, tickets);
      grid.appendChild(card);

      const ticket = Antrian.currentFor(type.code, tickets);
      if (fresh && ticket) announce(ticket, type.name);
      lastShown[type.code] = ticket?.id;
    }

    renderLatest(types, tickets);
    firstRender = false;
  }

  // ---------- Mulai ----------
  updateSoundButton();
  updateFullscreenButton();
  tickClock();
  render();

  window.setInterval(tickClock, 1000);
  // Polling: pembaruan otomatis tanpa reload halaman.
  window.setInterval(render, POLL_MS);
  // Event `storage` membuat tab lain langsung terbarui tanpa menunggu polling.
  Antrian.onDataChange(() => {
    lastSignature = undefined;
    render();
  });
})();