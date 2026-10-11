"use strict";
// Halaman Login (login.html)
// Dibungkus IIFE supaya tidak mencemari global scope (script dimuat tanpa module).
(() => {
    // ---------- Konstanta ----------
    const API_BASE = "https://dummyjson.com";
    const LOGIN_URL = `${API_BASE}/auth/login`;
    const ME_URL = `${API_BASE}/auth/me`;
    const FILTER_URL = (role) => `${API_BASE}/users/filter?key=role&value=${role}&limit=0&select=username`;
    // Key Local Storage (dipakai juga oleh halaman lain untuk cek sesi)
    const KEY_TOKEN = "token";
    const KEY_ROLE = "role";
    const KEY_FIRST_NAME = "firstName";
    const REDIRECT_ADMIN = "index.html";
    const REDIRECT_USER = "operator.html";
    // ---------- Elemen DOM ----------
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const submitBtn = document.getElementById("submit-btn");
    const errorBox = document.getElementById("error-box");
    // ---------- Helper UI ----------
    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;
        usernameInput.disabled = isLoading;
        passwordInput.disabled = isLoading;
        submitBtn.classList.toggle("loading", isLoading);
        submitBtn.textContent = isLoading ? "Memproses..." : "Masuk";
    }
    function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
    }
    function clearError() {
        errorBox.textContent = "";
        errorBox.hidden = true;
        usernameInput.classList.remove("invalid");
        passwordInput.classList.remove("invalid");
    }
    // ---------- Helper Role ----------
    function normalizeRole(raw) {
        const value = (raw ?? "").toLowerCase();
        if (value === "admin" || value === "moderator" || value === "user") {
            return value;
        }
        return null;
    }
    // Admin dan moderator memiliki hak akses yang sama.
    function hasAdminAccess(role) {
        return role === "admin" || role === "moderator";
    }
    function redirectByRole(role) {
        window.location.replace(hasAdminAccess(role) ? REDIRECT_ADMIN : REDIRECT_USER);
    }
    // ---------- Request ----------
    async function requestLogin(username, password) {
        const res = await fetch(LOGIN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, expiresInMins: 60 }),
        });
        const data = (await res.json().catch(() => ({})));
        if (!res.ok) {
            // dummyjson mengirim 400 dengan message "Invalid credentials"
            throw new CredentialError(data.message ?? "Invalid credentials");
        }
        return data;
    }
    // Role utama diambil dari respons server. Jika respons login tidak memuat role,
    // ambil dari /auth/me (pakai token). Jika masih gagal, cocokkan lewat endpoint filter.
    async function resolveRole(data, token) {
        const direct = normalizeRole(data.role);
        if (direct)
            return direct;
        try {
            const res = await fetch(ME_URL, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const me = (await res.json());
                const fromMe = normalizeRole(me.role);
                if (fromMe)
                    return fromMe;
            }
        }
        catch {
            // lanjut ke fallback berikutnya
        }
        const username = (data.username ?? "").toLowerCase();
        for (const role of ["admin", "moderator"]) {
            const res = await fetch(FILTER_URL(role));
            if (!res.ok)
                continue;
            const list = (await res.json());
            if (list.users?.some((u) => u.username.toLowerCase() === username)) {
                return role;
            }
        }
        return "user";
    }
    // ---------- Sesi ----------
    function saveSession(token, role, firstName) {
        localStorage.setItem(KEY_TOKEN, token);
        localStorage.setItem(KEY_ROLE, role);
        localStorage.setItem(KEY_FIRST_NAME, firstName);
    }
    // Jika sudah login, langsung arahkan sesuai role.
    function redirectIfLoggedIn() {
        try {
            const token = localStorage.getItem(KEY_TOKEN);
            const role = normalizeRole(localStorage.getItem(KEY_ROLE) ?? undefined);
            if (token && role)
                redirectByRole(role);
        }
        catch {
            // Local Storage tidak tersedia; biarkan form tampil.
        }
    }
    // ---------- Error khusus ----------
    class CredentialError extends Error {
    }
    // ---------- Submit ----------
    async function handleSubmit(event) {
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
        }
        catch (err) {
            if (err instanceof CredentialError) {
                showError("Username atau password salah. Silakan coba lagi.");
                usernameInput.classList.add("invalid");
                passwordInput.classList.add("invalid");
            }
            else if (err instanceof TypeError) {
                // fetch melempar TypeError saat jaringan gagal
                showError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
            }
            else {
                showError("Terjadi kesalahan saat masuk. Silakan coba lagi.");
            }
            setLoading(false);
        }
    }
    // ---------- Init ----------
    redirectIfLoggedIn();
    form.addEventListener("submit", handleSubmit);
})();
