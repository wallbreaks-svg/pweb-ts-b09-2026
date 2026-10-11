// Halaman Login (login.html)
// Dibungkus IIFE supaya tidak mencemari global scope (script dimuat tanpa module).
(() => {
  // ---------- Konstanta ----------
  const API_BASE = "https://dummyjson.com";
  const LOGIN_URL = `${API_BASE}/auth/login`;
  const ME_URL = `${API_BASE}/auth/me`;
  const FILTER_URL = (role: string): string =>
    `${API_BASE}/users/filter?key=role&value=${role}&limit=0&select=username`;

  // Key Local Storage (dipakai juga oleh halaman lain untuk cek sesi)
  const KEY_TOKEN = "token";
  const KEY_ROLE = "role";
  const KEY_FIRST_NAME = "firstName";

  const REDIRECT_ADMIN = "index.html";
  const REDIRECT_USER = "operator.html";

  // ---------- Tipe ----------
  type Role = "admin" | "moderator" | "user";

  interface LoginResponse {
    accessToken?: string;
    token?: string;
    username?: string;
    firstName?: string;
    role?: string;
    message?: string;
  }

  interface MeResponse {
    role?: string;
    firstName?: string;
  }

  interface FilterResponse {
    users?: { username: string }[];
  }

  // ---------- Elemen DOM ----------
  const form = document.getElementById("login-form") as HTMLFormElement;
  const usernameInput = document.getElementById("username") as HTMLInputElement;
  const passwordInput = document.getElementById("password") as HTMLInputElement;
  const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
  const errorBox = document.getElementById("error-box") as HTMLDivElement;

  // ---------- Helper UI ----------
  function setLoading(isLoading: boolean): void {
    submitBtn.disabled = isLoading;
    usernameInput.disabled = isLoading;
    passwordInput.disabled = isLoading;
    submitBtn.classList.toggle("loading", isLoading);
    submitBtn.textContent = isLoading ? "Memproses..." : "Masuk";
  }

  function showError(message: string): void {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError(): void {
    errorBox.textContent = "";
    errorBox.hidden = true;
    usernameInput.classList.remove("invalid");
    passwordInput.classList.remove("invalid");
  }

  // ---------- Helper Role ----------
  function normalizeRole(raw: string | undefined): Role | null {
    const value = (raw ?? "").toLowerCase();
    if (value === "admin" || value === "moderator" || value === "user") {
      return value;
    }
    return null;
  }

  // Admin dan moderator memiliki hak akses yang sama.
  function hasAdminAccess(role: Role): boolean {
    return role === "admin" || role === "moderator";
  }

  function redirectByRole(role: Role): void {
    window.location.replace(hasAdminAccess(role) ? REDIRECT_ADMIN : REDIRECT_USER);
  }

  // ---------- Request ----------
  async function requestLogin(username: string, password: string): Promise<LoginResponse> {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, expiresInMins: 60 }),
    });

    const data = (await res.json().catch(() => ({}))) as LoginResponse;

    if (!res.ok) {
      // dummyjson mengirim 400 dengan message "Invalid credentials"
      throw new CredentialError(data.message ?? "Invalid credentials");
    }
    return data;
  }

  // Role utama diambil dari respons server. Jika respons login tidak memuat role,
  // ambil dari /auth/me (pakai token). Jika masih gagal, cocokkan lewat endpoint filter.
  async function resolveRole(data: LoginResponse, token: string): Promise<Role> {
    const direct = normalizeRole(data.role);
    if (direct) return direct;

    try {
      const res = await fetch(ME_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const me = (await res.json()) as MeResponse;
        const fromMe = normalizeRole(me.role);
        if (fromMe) return fromMe;
      }
    } catch {
      // lanjut ke fallback berikutnya
    }

    const username = (data.username ?? "").toLowerCase();
    for (const role of ["admin", "moderator"] as const) {
      const res = await fetch(FILTER_URL(role));
      if (!res.ok) continue;
      const list = (await res.json()) as FilterResponse;
      if (list.users?.some((u) => u.username.toLowerCase() === username)) {
        return role;
      }
    }
    return "user";
  }

  // ---------- Sesi ----------
  function saveSession(token: string, role: Role, firstName: string): void {
    localStorage.setItem(KEY_TOKEN, token);
    localStorage.setItem(KEY_ROLE, role);
    localStorage.setItem(KEY_FIRST_NAME, firstName);
  }

  // Jika sudah login, langsung arahkan sesuai role.
  function redirectIfLoggedIn(): void {
    try {
      const token = localStorage.getItem(KEY_TOKEN);
      const role = normalizeRole(localStorage.getItem(KEY_ROLE) ?? undefined);
      if (token && role) redirectByRole(role);
    } catch {
      // Local Storage tidak tersedia; biarkan form tampil.
    }
  }

  // ---------- Error khusus ----------
  class CredentialError extends Error {}

  // ---------- Submit ----------
  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError("Username dan password wajib diisi.");
      (username ? passwordInput : usernameInput).classList.add("invalid");
      return;
    }

    setLoading(true);
    try {
      const data = await requestLogin(username, password);
      const token = data.accessToken ?? data.token;
      if (!token) {
        throw new Error("Respons server tidak memuat token.");
      }

      const role = await resolveRole(data, token);
      saveSession(token, role, data.firstName ?? data.username ?? username);
      redirectByRole(role);
    } catch (err) {
      if (err instanceof CredentialError) {
        showError("Username atau password salah. Silakan coba lagi.");
        usernameInput.classList.add("invalid");
        passwordInput.classList.add("invalid");
      } else if (err instanceof TypeError) {
        // fetch melempar TypeError saat jaringan gagal
        showError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
      } else {
        showError("Terjadi kesalahan saat masuk. Silakan coba lagi.");
      }
      setLoading(false);
    }
  }

  // ---------- Init ----------
  redirectIfLoggedIn();
  form.addEventListener("submit", handleSubmit);
})();