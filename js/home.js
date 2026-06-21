// js/home.js — STONK Home 로그인 팝업/자동로그인/권한/방 생성/방 입장/Market Pulse 인터랙션
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SC = window.SiteConfig;

  const state = {
    auth: null,
    db: null,
    user: null,
    isAdmin: false,
    firebaseReady: false,
    lastCreatedRoom: "",
    pulseRoom: "",
    pulseTimer: null,
    pulseInterval: null,
    lastPulseFetchAt: 0,
    lastPulseFetchRoom: "",
  };

  const roomInput = $("roomCodeInput");
  const roomMsg = $("roomMsg");
  const recentBox = $("recentBox");
  const recentRoom = $("recentRoom");
  const authBadges = [$("authBadgeModal"), $("authBadgeJoin")].filter(Boolean);
  const authMsg = $("authMsg");
  const signedOutBox = $("signedOutBox");
  const signedInBox = $("signedInBox");
  const userEmail = $("userEmail");
  const userRole = $("userRole");
  const navAuthBtn = $("btnAuthOpen");
  const authModal = $("authModal");
  const joinAuthText = $("joinAuthText");
  const openAuthFromCard = $("btnOpenAuthFromCard");
  const rememberLogin = $("rememberLogin");
  const REMEMBER_KEY = "stonk:rememberLogin";
  const createRoomMsg = $("createRoomMsg");
  const roomTitleInput = $("roomTitleInput");
  const btnOpenCreatedAdmin = $("btnOpenCreatedAdmin");
  const btnRefreshPulse = $("btnRefreshPulse");
  const PULSE_CACHE_MS = 45000;
  const PULSE_REFRESH_MS = 60000;

  function room() {
    // 단일 방 운영: 방 코드 개념 제거 → 항상 고정 방(MAIN)
    return "MAIN";
  }

  function openAuthModal() {
    if (!authModal) return;
    authModal.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => {
      const target = state.user ? $("btnLogout") : $("emailInput");
      if (target) target.focus();
    }, 0);
  }

  function closeAuthModal() {
    if (!authModal) return;
    authModal.hidden = true;
    document.body.classList.remove("modal-open");
    if (navAuthBtn) navAuthBtn.focus();
  }

  function setRoom(value, message) {
    const code = SC.normalizeRoomCode(value);
    roomInput.value = code;
    if (code) SC.setLastRoomCode(code);
    roomMsg.textContent = message || (code ? `${code} 방 코드가 설정되었습니다.` : "방 코드를 입력하세요.");
    refreshLinks();
    loadMarketPulse();
    if (window.__bgEquipRefresh) window.__bgEquipRefresh();
  }

  function getRoomOrWarn() {
    const code = room();
    if (!code) {
      roomMsg.textContent = "관리자에게 받은 방 코드를 먼저 입력하세요.";
      roomInput.focus();
      return "";
    }
    SC.setLastRoomCode(code);
    return code;
  }

  function requireLogin() {
    if (state.user) return true;
    if (authMsg) authMsg.textContent = "먼저 로그인하거나 회원가입하세요.";
    openAuthModal();
    return false;
  }

  function generateRoomCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function hostNickname(user) {
    const email = String((user && user.email) || "");
    const name = email.split("@")[0] || "관리자";
    return name.length > 16 ? name.slice(0, 16) : name;
  }

  // PHASE 3: 닉네임은 Home 이 중심. 저장된 값 우선, 없으면 이메일에서 파생.
  function deriveNickname(user) {
    try {
      const stored = localStorage.getItem("stonk:lastNickname") || localStorage.getItem("mb_nickname");
      if (stored) return stored;
    } catch (e) {}
    return hostNickname(user);
  }

  // PHASE 3: Home 중심 세션 플래그 저장(민감 토큰은 저장하지 않음 — Auth 세션은 Firebase 관리).
  function markHomeSession(code) {
    try {
      const c = SC.normalizeRoomCode(code);
      if (c) localStorage.setItem("stonk:lastRoomCode", c);
      localStorage.setItem("stonk:homeSessionReady", "true");
      localStorage.setItem("stonk:lastEntryAt", String(Date.now()));
      if (state.user) {
        localStorage.setItem("stonk:lastUid", state.user.uid);
        const nick = deriveNickname(state.user);
        localStorage.setItem("stonk:lastNickname", nick);
        localStorage.setItem("mb_nickname", nick); // Battle 닉네임 브릿지
      }
    } catch (e) {}
  }

  async function reserveUniqueRoomCode() {
    if (!state.db) throw new Error("Firebase DB가 준비되지 않았습니다.");
    for (let i = 0; i < 20; i += 1) {
      const code = generateRoomCode();
      const snap = await state.db.ref("rooms/" + code).once("value");
      if (!snap.exists()) return code;
    }
    throw new Error("방 코드 생성에 실패했습니다. 다시 시도하세요.");
  }

  async function createAdminRoom() {
    if (!requireLogin()) return;
    if (!state.isAdmin) {
      if (createRoomMsg) createRoomMsg.textContent = "관리자 계정에서만 방을 생성할 수 있습니다.";
      return;
    }
    if (!state.db) {
      if (createRoomMsg) createRoomMsg.textContent = "Firebase DB 연결 후 방 생성이 가능합니다.";
      return;
    }

    const btn = $("btnCreateRoom");
    const oldText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "생성 중..."; }
    if (createRoomMsg) createRoomMsg.textContent = "중복되지 않는 방 코드를 확인하는 중입니다.";

    try {
      const code = await reserveUniqueRoomCode();
      const title = String((roomTitleInput && roomTitleInput.value) || "").trim() || "STONK 투자 대전";
      const ts = window.firebase.database.ServerValue.TIMESTAMP;
      const user = state.user;
      const player = {
        nickname: hostNickname(user),
        cash: 0,
        holdings: null,
        totalAsset: 0,
        joinedAt: ts,
        connected: false,
        role: "host",
      };
      const roomData = {
        status: "waiting",
        title,
        hostId: user.uid,
        hostEmail: user.email || "",
        createdAt: ts,
        players: { [user.uid]: player },
        settings: {
          initialCash: 5000000,
          tickMs: 4000,
          maxPlayers: 6,
          source: "STONK Home",
        },
        meta: {
          title,
          createdBy: user.uid,
          createdByEmail: user.email || "",
          createdAt: ts,
          updatedAt: ts,
          source: "STONK Home",
          homeVersion: SC.VERSION,
        },
      };
      await state.db.ref("rooms/" + code).set(roomData);
      state.lastCreatedRoom = code;
      if (btnOpenCreatedAdmin) btnOpenCreatedAdmin.disabled = false;
      setRoom(code, `${code} 방이 생성되었습니다. 이 코드를 참여자에게 공유하세요.`);
      if (createRoomMsg) createRoomMsg.textContent = `방 생성 완료: ${code} · Battle/Board/Wiki에서 바로 사용할 수 있습니다.`;
      if (recentRoom && recentBox) { recentRoom.textContent = code; recentBox.hidden = false; }
    } catch (e) {
      if (createRoomMsg) createRoomMsg.textContent = "방 생성 실패: " + ((e && e.message) || e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText || "새 방 생성"; }
    }
  }


  function go(site, requireRoom, requireAdmin) {
    if (!requireLogin()) return;
    if (requireAdmin && !state.isAdmin) {
      roomMsg.textContent = "관리자 계정에서만 Admin 페이지를 열 수 있습니다.";
      return;
    }
    const code = requireRoom ? getRoomOrWarn() : room();
    if (requireRoom && !code) return;
    markHomeSession(code); // PHASE 3: Home 에서 입장 완료 → 세션 플래그 저장
    location.href = SC.buildSiteUrl(site, { room: code });
  }

  function refreshLinks() {
    const code = room();
    const map = {
      topBattle: "battle", topArcade: "arcade", topGacha: "gacha", topBank: "bank", topCompany: "company", topBoard: "board", topWiki: "wiki", topAdmin: "admin",
      siteBattle: "battle", siteArcade: "arcade", siteGacha: "gacha", siteBank: "bank", siteBoard: "board", siteWiki: "wiki", siteAdmin: "admin",
    };
    Object.entries(map).forEach(([id, site]) => {
      const el = $(id);
      if (el) el.href = SC.buildSiteUrl(site, { room: code });
    });
  }

  function setAdminVisible(visible) {
    document.querySelectorAll(".admin-only").forEach((el) => {
      const show = !!visible;
      el.hidden = !show;
      el.classList.toggle("admin-visible", show);
      el.setAttribute("aria-hidden", show ? "false" : "true");
    });
  }

  function setAuthUi(user, isAdmin) {
    state.user = user || null;
    state.isAdmin = !!isAdmin;

    if (signedOutBox) signedOutBox.hidden = !!user;
    if (signedInBox) signedInBox.hidden = !user;
    setAdminVisible(!!user && !!isAdmin);

    if (!user) {
      authBadges.forEach((badge) => { badge.textContent = "로그인 필요"; badge.classList.add("muted"); });
      if (authMsg) authMsg.textContent = "로그인하면 방 입장과 권한 확인이 가능합니다.";
      if (navAuthBtn) {
        navAuthBtn.textContent = "로그인";
        navAuthBtn.classList.remove("signed-in", "admin");
      }
      if (joinAuthText) joinAuthText.textContent = "아직 로그인하지 않았습니다.";
      if (openAuthFromCard) openAuthFromCard.textContent = "로그인";
      if (createRoomMsg) createRoomMsg.textContent = "관리자 로그인 후 Home에서 방을 생성할 수 있습니다.";
      if (btnOpenCreatedAdmin) btnOpenCreatedAdmin.disabled = true;
      return;
    }

    // PHASE 3: 로그인 시점에 닉네임/uid 를 공유 키에 저장(타 사이트 fallback 용)
    try {
      localStorage.setItem("stonk:lastUid", user.uid);
      localStorage.setItem("stonk:lastNickname", deriveNickname(user));
    } catch (e) {}

    const label = user.email || user.uid;
    if (userEmail) userEmail.textContent = label;
    if (userRole) userRole.textContent = isAdmin ? "관리자 권한 확인됨" : "일반 참여자";
    authBadges.forEach((badge) => {
      badge.textContent = isAdmin ? "ADMIN" : "LOGIN";
      badge.classList.toggle("muted", false);
    });
    if (authMsg) authMsg.textContent = "로그인 완료";
    if (navAuthBtn) {
      navAuthBtn.textContent = isAdmin ? "관리자" : "내 계정";
      navAuthBtn.classList.add("signed-in");
      navAuthBtn.classList.toggle("admin", !!isAdmin);
    }
    if (joinAuthText) joinAuthText.textContent = isAdmin ? "관리자로 로그인되었습니다." : "일반 참여자로 로그인되었습니다.";
    if (openAuthFromCard) openAuthFromCard.textContent = "계정 보기";
    if (createRoomMsg) createRoomMsg.textContent = isAdmin ? "새 방 생성 버튼을 누르면 Firebase에 실제 대기방이 생성됩니다." : "방 생성은 관리자 계정에서만 가능합니다.";
  }

  function authErrorMessage(e) {
    const code = e && e.code;
    const map = {
      "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
      "auth/missing-password": "비밀번호를 입력하세요.",
      "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
      "auth/email-already-in-use": "이미 가입된 이메일입니다. 로그인을 눌러주세요.",
      "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
      "auth/user-not-found": "가입되지 않은 이메일입니다. 회원가입을 눌러주세요.",
      "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
      "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
      "auth/network-request-failed": "네트워크 오류입니다. 연결을 확인하세요.",
      "auth/operation-not-allowed": "Firebase 콘솔에서 이메일/비밀번호 로그인을 활성화했는지 확인하세요.",
    };
    return map[code] || "오류: " + ((e && e.message) || code || "알 수 없는 오류");
  }

  async function checkAdmin(user) {
    if (!user) return false;
    const email = String(user.email || "").toLowerCase();
    if ((SC.ADMIN_UIDS || []).includes(user.uid)) return true;
    if ((SC.ADMIN_EMAILS || []).map((v) => String(v).toLowerCase()).includes(email)) return true;
    if (!state.db) return false;
    try {
      const snap = await state.db.ref("admins/" + user.uid).once("value");
      return snap.val() === true;
    } catch (e) {
      return false;
    }
  }

  async function doAuth(kind) {
    if (!state.auth) {
      if (authMsg) authMsg.textContent = "Firebase 초기화에 실패했습니다. 설정값을 확인하세요.";
      return;
    }
    const email = ($("emailInput") && $("emailInput").value.trim()) || "";
    const password = ($("passwordInput") && $("passwordInput").value) || "";
    if (!email || !password) {
      if (authMsg) authMsg.textContent = "이메일과 비밀번호를 입력하세요.";
      return;
    }
    const keepLogin = !rememberLogin || rememberLogin.checked;
    try {
      localStorage.setItem(REMEMBER_KEY, keepLogin ? "1" : "0");
    } catch (e) {}
    if (authMsg) authMsg.textContent = kind === "signup" ? "회원가입 중..." : "로그인 중...";
    try {
      const persistence = keepLogin
        ? window.firebase.auth.Auth.Persistence.LOCAL
        : window.firebase.auth.Auth.Persistence.SESSION;
      await state.auth.setPersistence(persistence);
      if (kind === "signup") await state.auth.createUserWithEmailAndPassword(email, password);
      else await state.auth.signInWithEmailAndPassword(email, password);
      if (authMsg) authMsg.textContent = kind === "signup" ? "회원가입 완료" : "로그인 완료";
      closeAuthModal();
    } catch (e) {
      if (authMsg) authMsg.textContent = authErrorMessage(e);
    }
  }

  function normalizePulseItems(raw) {
    if (!raw) return [];
    const data = Array.isArray(raw) ? raw : Object.values(raw);
    return data
      .map((item) => {
        if (typeof item === "string") return { text: item };
        if (!item || typeof item !== "object") return null;
        return {
          label: item.label || item.name || item.symbol || item.stockName || "",
          change: item.change || item.changeRate || item.rate || "",
          text: item.text || item.news || item.message || item.title || "",
          tone: item.tone || item.type || item.direction || "",
        };
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }

  function priceText(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("ko-KR") + "원";
  }

  function roomTitle(roomData, code) {
    return (roomData && (roomData.title || roomData.meta?.title || roomData.name)) || code || "방";
  }

  function pulseItemsFromRoom(roomData, code) {
    if (!roomData || typeof roomData !== "object") return [];

    const items = [];
    const title = roomTitle(roomData, code);
    const status = roomData.status ? String(roomData.status).toUpperCase() : "WAITING";
    items.push({ label: title, text: `상태 ${status}`, tone: "" });

    const latest = roomData.latestNews;
    if (latest) {
      const text = typeof latest === "string" ? latest : (latest.text || latest.title || latest.message || "");
      if (text) items.push({ label: "속보", text, tone: "news" });
    }

    const stocks = roomData.stocks && typeof roomData.stocks === "object" ? roomData.stocks : {};
    const movers = Object.values(stocks)
      .filter((s) => s && typeof s === "object" && s.name)
      .map((s) => ({
        label: s.name,
        change: pct(s.changeRate),
        text: priceText(s.price),
        tone: Number(s.changeRate) > 0 ? "up" : Number(s.changeRate) < 0 ? "down" : "",
        abs: Math.abs(Number(s.changeRate) || 0),
        news: s.news || "",
      }))
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 6);

    items.push(...movers);

    Object.values(stocks)
      .filter((s) => s && s.name && s.news)
      .slice(0, 3)
      .forEach((s) => {
        items.push({
          label: s.name,
          change: pct(s.changeRate),
          text: s.news,
          tone: Number(s.changeRate) >= 0 ? "up" : "down",
        });
      });

    if (roomData.market && roomData.market.lastTickAt) {
      const diff = Math.max(0, Date.now() - Number(roomData.market.lastTickAt));
      const sec = Math.floor(diff / 1000);
      items.push({ label: "시장", text: sec < 60 ? `${sec}초 전 갱신` : `${Math.floor(sec / 60)}분 전 갱신`, tone: "" });
    }

    return items.slice(0, 12);
  }

  function renderPulse(items, statusText) {
    const line = $("tickerLine");
    const status = $("pulseStatus");
    if (status) status.textContent = statusText || "방 데이터 연결 대기";
    if (!line) return;

    if (!items.length) {
      line.classList.add("static-line");
      line.innerHTML = [
        "방 코드를 입력하면 Battle 방의 실제 종목 등락률과 뉴스가 표시됩니다.",
        "Battle에서 가격이 움직이면 이 영역도 자동으로 갱신됩니다.",
        "Home · Battle · Board · Wiki가 같은 room 코드를 기준으로 연결됩니다.",
      ].map((text) => `<span>${escapeHtml(text)}</span>`).join("");
      return;
    }

    const html = items.map((item) => {
      const toneText = String(item.tone || item.change || "");
      const tone = toneText.includes("down") || toneText.includes("-") ? "down" : toneText.includes("up") || toneText.includes("+") ? "up" : "";
      const label = [item.label, item.change].filter(Boolean).join(" ");
      const body = [label, item.text].filter(Boolean).join(" · ");
      return `<span class="${tone}">${escapeHtml(body)}</span>`;
    }).join("");
    line.innerHTML = html + html;
    line.classList.toggle("static-line", items.length <= 3);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pulseCacheKey(code) {
    return "stonk:pulse:" + SC.normalizeRoomCode(code);
  }

  function readPulseCache(code) {
    try {
      const raw = sessionStorage.getItem(pulseCacheKey(code));
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !Array.isArray(cached.items)) return null;
      if (Date.now() - Number(cached.at || 0) > PULSE_CACHE_MS) return null;
      return cached;
    } catch (e) {
      return null;
    }
  }

  function writePulseCache(code, items, statusText) {
    try {
      sessionStorage.setItem(pulseCacheKey(code), JSON.stringify({
        at: Date.now(),
        items: items || [],
        statusText: statusText || "",
      }));
    } catch (e) {}
  }

  async function readDbOnce(path) {
    if (!state.db) return null;
    const snap = await state.db.ref(path).once("value");
    return snap.exists() ? snap.val() : null;
  }

  async function readStockSample(code) {
    if (!state.db) return {};
    const highSnap = await state.db.ref(`rooms/${code}/stocks`).orderByChild("changeRate").limitToLast(6).once("value");
    const lowSnap = await state.db.ref(`rooms/${code}/stocks`).orderByChild("changeRate").limitToFirst(3).once("value");
    return { ...(lowSnap.val() || {}), ...(highSnap.val() || {}) };
  }

  async function loadMarketPulseOnce(code, force) {
    code = SC.normalizeRoomCode(code || room());
    if (!code) {
      renderPulse([], "방 코드 입력 전");
      return;
    }

    const now = Date.now();
    if (!force && state.lastPulseFetchRoom === code && now - state.lastPulseFetchAt < 5000) return;

    const cached = !force && readPulseCache(code);
    if (cached) {
      renderPulse(cached.items, cached.statusText || `${code} 최근 데이터`);
      return;
    }

    state.lastPulseFetchRoom = code;
    state.lastPulseFetchAt = now;
    renderPulse([], `${code} 데이터 확인 중`);

    try {
      if (SC.PULSE_ENDPOINT) {
        const url = SC.PULSE_ENDPOINT + (SC.PULSE_ENDPOINT.includes("?") ? "&" : "?") + "room=" + encodeURIComponent(code);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Pulse API " + res.status);
        const json = await res.json();
        const items = normalizePulseItems(json.items || json.pulse || json.data || json);
        const statusText = items.length ? `${code} 서버 데이터` : `${code} 데이터 없음`;
        renderPulse(items, statusText);
        writePulseCache(code, items, statusText);
        return;
      }

      if (state.db) {
        const marketPulse = await readDbOnce(`rooms/${code}/marketPulse`);
        if (marketPulse) {
          const items = normalizePulseItems(marketPulse);
          const statusText = items.length ? `${code} Pulse 데이터` : `${code} Pulse 데이터 없음`;
          renderPulse(items, statusText);
          writePulseCache(code, items, statusText);
          return;
        }

        const pulse = await readDbOnce(`rooms/${code}/pulse`);
        if (pulse) {
          const items = normalizePulseItems(pulse);
          const statusText = items.length ? `${code} Pulse 데이터` : `${code} Pulse 데이터 없음`;
          renderPulse(items, statusText);
          writePulseCache(code, items, statusText);
          return;
        }

        const [meta, latestNews, stocks] = await Promise.all([
          readDbOnce(`rooms/${code}/meta`),
          readDbOnce(`rooms/${code}/latestNews`),
          readStockSample(code),
        ]);
        const roomData = {
          title: meta && (meta.title || meta.name),
          status: meta && meta.status,
          latestNews,
          stocks,
        };
        const items = pulseItemsFromRoom(roomData, code);
        const statusText = items.length ? `${code} 방 데이터 연결됨` : `${code} 표시할 데이터 없음`;
        renderPulse(items, statusText);
        writePulseCache(code, items, statusText);
        return;
      }
    } catch (e) {
      renderPulse([], `${code} 읽기 실패`);
      return;
    }

    renderPulse([], `${code} Firebase 대기`);
  }

  function schedulePulseWatch(force) {
    clearTimeout(state.pulseTimer);
    state.pulseTimer = setTimeout(() => loadMarketPulseOnce(room(), !!force), 700);
  }

  function loadMarketPulse(force) {
    return loadMarketPulseOnce(room(), !!force);
  }

  function startPulseInterval() {
    if (state.pulseInterval) clearInterval(state.pulseInterval);
    state.pulseInterval = setInterval(() => {
      if (document.hidden) return;
      if (!room()) return;
      loadMarketPulseOnce(room(), true);
    }, PULSE_REFRESH_MS);
  }

  async function initFirebase() {
    if (!window.firebase || !SC.FIREBASE_CONFIG) {
      setAuthUi(null, false);
      if (authMsg) authMsg.textContent = "Firebase SDK를 불러오지 못했습니다.";
      return;
    }
    try {
      const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(SC.FIREBASE_CONFIG);
      state.auth = app.auth();
      state.db = app.database();
      state.firebaseReady = true;
      loadMarketPulse(false);
      state.auth.onAuthStateChanged(async (user) => {
        if (!user) {
          setAuthUi(null, false);
          return;
        }
        setAuthUi(user, false);
        if (window.__bgEquipRefresh) window.__bgEquipRefresh();
        if (window.__bankRefresh) window.__bankRefresh();
        const isAdmin = await checkAdmin(user);
        setAuthUi(user, isAdmin);
        // 로그인 권한 확인과 Market Pulse 읽기는 분리합니다.
        // 권한 확인 때문에 방 데이터 전체를 다시 읽지 않도록 유지합니다.
      });
    } catch (e) {
      setAuthUi(null, false);
      if (authMsg) authMsg.textContent = "Firebase 연결 실패: " + (e.message || e);
    }
  }


  function initRememberLogin() {
    if (!rememberLogin) return;
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      rememberLogin.checked = saved !== "0";
    } catch (e) {
      rememberLogin.checked = true;
    }
  }

  function initRecent() {
    const urlRoom = SC.getUrlRoomCode();
    const last = SC.getLastRoomCode();
    if (urlRoom) {
      setRoom(urlRoom, `${urlRoom} 방 코드가 URL에서 불러와졌습니다.`);
      return;
    }
    if (last) {
      recentRoom.textContent = last;
      recentBox.hidden = false;
      setRoom(last, `${last} 최근 방 코드를 불러왔습니다.`);
    } else {
      refreshLinks();
    }
  }

  roomInput.addEventListener("input", () => {
    const pos = roomInput.selectionStart;
    roomInput.value = SC.normalizeRoomCode(roomInput.value);
    try { roomInput.setSelectionRange(pos, pos); } catch (e) {}
    if (room()) SC.setLastRoomCode(room());
    refreshLinks();
    schedulePulseWatch(false);
    if (window.__bgEquipRefresh) window.__bgEquipRefresh();
  });

  navAuthBtn.addEventListener("click", openAuthModal);
  openAuthFromCard.addEventListener("click", openAuthModal);
  $("btnAuthClose").addEventListener("click", closeAuthModal);
  // 배경을 눌러도 팝업이 닫히지 않게 유지합니다. X 버튼과 로그인 성공 시에만 닫힙니다.
  $("btnLogin").addEventListener("click", () => doAuth("login"));
  $("btnSignup").addEventListener("click", () => doAuth("signup"));
  $("btnLogout").addEventListener("click", async () => {
    try { localStorage.removeItem("stonk:homeSessionReady"); } catch (e) {}
    if (state.auth) await state.auth.signOut();
  });
  $("btnUseRecent").addEventListener("click", () => setRoom(recentRoom.textContent, `${recentRoom.textContent} 방 코드를 다시 불러왔습니다.`));
  $("btnGoBattle").addEventListener("click", () => go("battle", false, false));
  // 라이트/다크 테마 토글 (Battle 과 같은 localStorage 키 공유)
  const themeBtn = $("themeToggle");
  const syncThemeIcon = () => { if (themeBtn) themeBtn.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙"; };
  syncThemeIcon();
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("stonk:theme", next); } catch (e) {}
    syncThemeIcon();
  });
  const btnScrollJoin = $("btnScrollJoin");
  if (btnScrollJoin) btnScrollJoin.addEventListener("click", () => $("joinCard").scrollIntoView({ behavior: "smooth", block: "center" }));
  $("btnJoinBattle").addEventListener("click", () => go("battle", true, false));
  const btnJoinArcade = $("btnJoinArcade");
  if (btnJoinArcade) btnJoinArcade.addEventListener("click", () => go("arcade", true, false));
  const btnJoinGacha = $("btnJoinGacha");
  if (btnJoinGacha) btnJoinGacha.addEventListener("click", () => go("gacha", true, false));
  const btnJoinBank = $("btnJoinBank");
  if (btnJoinBank) btnJoinBank.addEventListener("click", () => go("bank", true, false));
  const btnGoBank = $("btnGoBank");
  if (btnGoBank) btnGoBank.addEventListener("click", () => go("bank", true, false));
  const btnJoinCompany = $("btnJoinCompany");
  if (btnJoinCompany) btnJoinCompany.addEventListener("click", () => go("company", true, false));
  $("btnJoinBoard").addEventListener("click", () => go("board", true, false));
  $("btnJoinWiki").addEventListener("click", () => go("wiki", true, false));
  $("btnJoinAdmin").addEventListener("click", () => go("admin", true, true));
  $("btnCreateRoom").addEventListener("click", createAdminRoom);
  if (btnRefreshPulse) btnRefreshPulse.addEventListener("click", () => loadMarketPulse(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && room()) loadMarketPulse(false);
  });

  $("btnOpenCreatedAdmin").addEventListener("click", () => {
    const code = state.lastCreatedRoom || room();
    if (!code) { if (createRoomMsg) createRoomMsg.textContent = "먼저 방을 생성하거나 방 코드를 입력하세요."; return; }
    location.href = SC.buildAdminUrl(code);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (document.activeElement === roomInput) go("battle", true, false);
    if (document.activeElement === $("passwordInput")) doAuth("login");
  });

  // ===== 배경화면 착용(스킨) — Gacha 보유 → Home 착용 → Battle 적용 =====
  // 저장 위치: rooms/{room}/players/{uid}/equippedBackground (보안 규칙상 본인 쓰기 가능)
  // 이미지: Gacha 사이트의 backgrounds 폴더(같은 origin)에서 webp→jpg→png 순으로 시도
  const BG_IMG_BASE = "https://tom981105-web.github.io/STONK-Gacha/backgrounds/";
  const BG_ITEMS = [
    { id: "sbg-candle-basic", name: "기본 캔들 차트", grade: "Common" },
    { id: "sbg-line-blue", name: "블루 라인 차트", grade: "Common" },
    { id: "sbg-bid-green", name: "초록 호가창", grade: "Common" },
    { id: "sbg-bid-red", name: "빨강 호가창", grade: "Common" },
    { id: "sbg-night-exchange", name: "야간 거래소", grade: "Common" },
    { id: "sbg-mono-terminal", name: "흑백 터미널", grade: "Common" },
    { id: "sbg-small-bull", name: "소형 양봉", grade: "Common" },
    { id: "sbg-small-bear", name: "소형 음봉", grade: "Common" },
    { id: "sbg-uptrend", name: "상승 추세선", grade: "Rare" },
    { id: "sbg-wedge-down", name: "하락 쐐기", grade: "Rare" },
    { id: "sbg-volume-burst", name: "거래량 폭발", grade: "Rare" },
    { id: "sbg-neon-ticker", name: "네온 티커", grade: "Rare" },
    { id: "sbg-golden-cross", name: "골든 크로스", grade: "Rare" },
    { id: "sbg-dead-cross", name: "데드 크로스", grade: "Rare" },
    { id: "sbg-charging-bull", name: "질주하는 황소", grade: "Epic" },
    { id: "sbg-roaring-bear", name: "포효하는 곰", grade: "Epic" },
    { id: "sbg-circuit-break", name: "서킷 직전", grade: "Epic" },
    { id: "sbg-holo-room", name: "홀로그램 트레이딩룸", grade: "Epic" },
    { id: "sbg-goldrush", name: "골드러시 불장", grade: "Legendary" },
    { id: "sbg-black-monday", name: "블랙 먼데이", grade: "Legendary" },
    { id: "sbg-wallstreet-night", name: "월스트리트 야경", grade: "Legendary" },
    { id: "sbg-moon-rocket", name: "떡상 로켓 우주", grade: "Mythic" }
  ];
  const BG_BY_ID = Object.fromEntries(BG_ITEMS.map((i) => [i.id, i]));
  const BG_GRADE_COLOR = { Common: "#c7ccd6", Rare: "#6ea8ff", Epic: "#a06bff", Legendary: "#e8c87a", Mythic: "#ff5fa2" };
  const bgEquip = { inv: {}, equipped: null };

  function bgTryImage(id, cb) {
    const exts = ["webp", "jpg", "png"];
    let i = 0;
    const next = () => {
      if (i >= exts.length) { cb(null); return; }
      const url = BG_IMG_BASE + id + "." + exts[i++];
      const img = new Image();
      img.onload = () => cb(url);
      img.onerror = next;
      img.src = url;
    };
    next();
  }

  async function bgEquipRefresh() {
    const grid = $("bgEquipGrid");
    const msg = $("bgEquipMsg");
    if (!grid) return;
    if (!state.user) { grid.innerHTML = ""; if (msg) msg.textContent = "로그인하면 보유한 배경을 불러옵니다."; return; }
    const code = room();
    if (!code) { grid.innerHTML = ""; if (msg) msg.textContent = "방 코드를 입력하면 이 방에서 보유한 배경이 표시됩니다."; return; }
    if (!state.db) { if (msg) msg.textContent = "Firebase 연결 대기 중..."; return; }
    if (msg) msg.textContent = "보유 배경 불러오는 중...";
    try {
      const base = `rooms/${code}/players/${state.user.uid}`;
      const [invSnap, eqSnap] = await Promise.all([
        state.db.ref(base + "/gachaInventory").once("value"),
        state.db.ref(base + "/equippedBackground").once("value"),
      ]);
      bgEquip.inv = invSnap.val() || {};
      bgEquip.equipped = eqSnap.val() || null;
      renderBgEquip();
    } catch (e) {
      if (msg) msg.textContent = "배경 불러오기 실패: " + ((e && e.message) || e);
    }
  }

  function renderBgEquip() {
    const grid = $("bgEquipGrid");
    const msg = $("bgEquipMsg");
    if (!grid) return;
    const owned = BG_ITEMS.filter((it) => Number(bgEquip.inv[it.id] || 0) > 0);
    const eq = bgEquip.equipped;
    let html = `<button class="bg-tile bg-none ${!eq ? "active" : ""}" type="button" data-bg=""><div class="bg-thumb bg-thumb-none">기본</div><span class="bg-name">미착용 (기본 배경)</span></button>`;
    html += owned.map((it) => {
      const c = BG_GRADE_COLOR[it.grade] || "#c7ccd6";
      return `<button class="bg-tile ${eq === it.id ? "active" : ""}" type="button" data-bg="${it.id}" style="--gc:${c}">
        <div class="bg-thumb" data-bg-id="${it.id}"><span class="bg-grade">${it.grade}</span></div>
        <span class="bg-name">${escapeHtml(it.name)}</span></button>`;
    }).join("");
    grid.innerHTML = html;
    if (msg) msg.textContent = owned.length ? `보유 ${owned.length}종 · 타일을 누르면 착용/교체됩니다.` : "이 방에서 보유한 배경이 없습니다. Gacha에서 배경화면을 먼저 뽑아 주세요.";
    grid.querySelectorAll(".bg-thumb[data-bg-id]").forEach((el) => {
      bgTryImage(el.getAttribute("data-bg-id"), (url) => { if (url) el.style.backgroundImage = `url("${url}")`; });
    });
    grid.querySelectorAll(".bg-tile").forEach((btn) => btn.addEventListener("click", () => equipBg(btn.getAttribute("data-bg") || null)));
  }

  async function equipBg(id) {
    if (!requireLogin()) return;
    const code = room();
    const msg = $("bgEquipMsg");
    if (!code) { if (msg) msg.textContent = "방 코드를 먼저 입력하세요."; return; }
    if (!state.db) return;
    try {
      await state.db.ref(`rooms/${code}/players/${state.user.uid}/equippedBackground`).set(id || null);
      bgEquip.equipped = id || null;
      renderBgEquip();
      if (msg) msg.textContent = id ? `착용 완료: ${(BG_BY_ID[id] && BG_BY_ID[id].name) || id} · Battle 게임 화면에 적용됩니다.` : "미착용으로 변경했습니다. (기본 배경)";
    } catch (e) {
      if (msg) msg.textContent = "착용 실패: " + ((e && e.message) || e);
    }
  }

  // 공용 모달 (브라우저 prompt 대체 — Home UI 톤) → 입력값 객체 or null(취소) 반환
  function openStonkModal({ title, desc, icon, fields = [], confirm = "확인" }) {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "stonk-modal";
      ov.innerHTML = `
        <div class="stonk-modal-dim"></div>
        <div class="stonk-modal-card card" role="dialog" aria-modal="true">
          <div class="stonk-modal-head">${icon ? `<span class="stonk-modal-icon">${icon}</span>` : ""}<h3>${escapeHtml(title || "")}</h3></div>
          ${desc ? `<p class="stonk-modal-desc">${escapeHtml(desc)}</p>` : ""}
          <div class="stonk-modal-fields">
            ${fields.map((f, i) => `
              <label class="stonk-modal-label" for="sm-f${i}">${escapeHtml(f.label || "")}</label>
              <div class="stonk-modal-inwrap">
                <input id="sm-f${i}" class="stonk-modal-input" data-fi="${i}" type="${f.type || "text"}" inputmode="${f.type === "number" ? "numeric" : "text"}" placeholder="${escapeHtml(f.placeholder || "")}" value="${escapeHtml(f.value != null ? String(f.value) : "")}" autocomplete="off" />
                ${f.suffix ? `<span class="stonk-modal-suffix">${escapeHtml(f.suffix)}</span>` : ""}
              </div>`).join("")}
          </div>
          <div class="stonk-modal-actions">
            <button class="btn ghost" type="button" data-cancel>취소</button>
            <button class="btn primary" type="button" data-ok>${escapeHtml(confirm)}</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      document.body.classList.add("modal-open");
      const inputs = Array.from(ov.querySelectorAll(".stonk-modal-input"));
      setTimeout(() => { inputs[0] && inputs[0].focus(); inputs[0] && inputs[0].select && inputs[0].select(); }, 30);
      const done = (v) => { ov.remove(); document.body.classList.remove("modal-open"); resolve(v); };
      const submit = () => { const out = {}; fields.forEach((f, i) => { out[f.key || i] = inputs[i] ? inputs[i].value : ""; }); done(out); };
      ov.querySelector("[data-cancel]").addEventListener("click", () => done(null));
      ov.querySelector(".stonk-modal-dim").addEventListener("click", () => done(null));
      ov.querySelector("[data-ok]").addEventListener("click", submit);
      ov.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } else if (e.key === "Escape") done(null); });
    });
  }

  // 결과/완료 알림 팝업 (확인 버튼 1개)
  function stonkAlert({ title, desc, icon, confirm = "확인" }) {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "stonk-modal";
      ov.innerHTML = `
        <div class="stonk-modal-dim"></div>
        <div class="stonk-modal-card card" role="dialog" aria-modal="true">
          <div class="stonk-modal-head">${icon ? `<span class="stonk-modal-icon">${icon}</span>` : ""}<h3>${escapeHtml(title || "")}</h3></div>
          ${desc ? `<p class="stonk-modal-desc">${escapeHtml(desc)}</p>` : ""}
          <div class="stonk-modal-actions one"><button class="btn primary" type="button" data-ok>${escapeHtml(confirm)}</button></div>
        </div>`;
      document.body.appendChild(ov);
      document.body.classList.add("modal-open");
      const done = () => { ov.remove(); document.body.classList.remove("modal-open"); resolve(); };
      ov.querySelector("[data-ok]").addEventListener("click", done);
      ov.querySelector(".stonk-modal-dim").addEventListener("click", done);
      ov.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") done(); });
      setTimeout(() => { const b = ov.querySelector("[data-ok]"); b && b.focus(); }, 30);
    });
  }

  // ===== STONK 금고(영구 계좌) + 우편함 =====
  const bank = { balance: 0, mail: [] };
  let bankBalRef = null; // 잔액 상시 리스너(트랜잭션이 캐시를 잡도록 — 송금 '잔액 부족' 버그 방지)
  function deriveNick() { return state.nickname || (state.user && (state.user.displayName || (state.user.email || "").split("@")[0])) || "플레이어"; }
  async function bankRefresh() {
    const balEl = $("bankBalance"), mailEl = $("mailList"), cnt = $("mailCount");
    if (!state.user || !state.db) {
      if (balEl) balEl.textContent = "로그인 필요";
      if (mailEl) mailEl.innerHTML = `<div class="mail-empty">로그인하면 금고와 우편함이 표시됩니다.</div>`;
      if (cnt) cnt.textContent = "0";
      return;
    }
    try {
      const uid = state.user.uid;
      // 친구 송금 검색용으로 닉네임을 계좌에 기록
      state.db.ref("rooms/MAIN/bank/" + uid).update({ nickname: deriveNick(), updatedAt: Date.now() }).catch(() => {});
      // 잔액은 상시 구독(.on) → 노드가 캐시되어 트랜잭션이 정상 동작하고 실시간 갱신됨
      const newRef = state.db.ref("rooms/MAIN/bank/" + uid + "/balance");
      if (!bankBalRef || bankBalRef.toString() !== newRef.toString()) {
        if (bankBalRef) bankBalRef.off();
        bankBalRef = newRef;
        bankBalRef.on("value", (snap) => { bank.balance = Number(snap.val() || 0); renderBank(); });
      }
      const mailSnap = await state.db.ref("rooms/MAIN/mail/" + uid).once("value");
      const mv = mailSnap.val() || {};
      bank.mail = Object.entries(mv).map(([id, m]) => ({ id, ...m })).filter((m) => !m.claimed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      renderBank();
      // v2.0: 은행 자산 요약(요약 조회만 — Home 에서는 이자/수익 정산하지 않음)
      try {
        const [bankSnap, cashSnap, evSnap, coSnap] = await Promise.all([
          state.db.ref("rooms/MAIN/bank/" + uid).once("value"),
          state.db.ref("rooms/MAIN/players/" + uid + "/cash").once("value"),
          state.db.ref("rooms/MAIN/bankEvents/current").once("value"),
          state.db.ref("rooms/MAIN/companies/" + uid).once("value"),
        ]);
        renderBankSummary(bankSnap.val() || {}, Number(cashSnap.val() || 0), evSnap.val(), coSnap.val());
      } catch (_) {}
    } catch (e) {
      const msg = $("bankMsg"); if (msg) msg.textContent = "금고 불러오기 실패: " + ((e && e.message) || e);
    }
  }
  function bankGrade(s) { s = Math.max(0, Math.min(100, Math.round(isFinite(s) ? s : 60))); return s >= 90 ? "S" : s >= 75 ? "A" : s >= 55 ? "B" : s >= 35 ? "C" : s >= 15 ? "D" : "F"; }
  function wonK(n) { return Number(n || 0).toLocaleString("ko-KR") + "원"; }
  function renderBankSummary(b, cash, evRaw, co) {
    const used = !!(b && (b.balance != null || b.createdAt != null));
    const free = Number(b.balance || 0);
    const fixedSum = Object.values(b.fixed || {}).reduce((a, f) => a + Number((f && f.amount) || 0), 0);
    const vip = Number(b.vipVaultBalance || 0);
    const invVal = Object.values(b.investments || {}).reduce((a, v) => a + Number((v && v.principal) || 0), 0);
    const loanP = Number(b.loanPrincipal || 0), loanI = Number(b.loanInterest || 0);
    const net = cash + free + fixedSum + vip + invVal - loanP - loanI;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("bsGrade", used ? ("신용 " + bankGrade(b.creditScore)) : "미이용");
    set("bsCash", wonK(cash));
    set("bsFree", used ? wonK(free) : "은행 이용 전");
    set("bsFixed", used ? wonK(fixedSum) : "—");
    set("bsLoan", used ? wonK(loanP + loanI) : "—");
    set("bsNet", wonK(net));
    const loanEl = $("bsLoan"); if (loanEl) loanEl.classList.toggle("warn", (loanP + loanI) > 0);
    const netEl = $("bsNet"); if (netEl) netEl.classList.toggle("warn", net < 0);

    // v2.5: 보험/투자/VIP/알림 요약(개수만 계산 — Home 은 정산하지 않음)
    const now = Date.now();
    const activeIns = Object.values(b.insurances || {}).filter((i) => i && i.status === "active" && Number(i.expiresAt || 0) > now).length;
    const invs = Object.values(b.investments || {});
    const invActive = invs.filter((v) => v && v.status !== "settled").length;
    const invMatured = invs.filter((v) => v && v.status !== "settled" && now >= Number(v.maturesAt || 0)).length;
    const unread = Object.values(b.messages || {}).filter((m) => m && !m.read).length;
    const tier = used ? (b.vipTier || "NORMAL") : "NORMAL";
    const tierLabel = { NORMAL: "일반", SILVER: "실버", GOLD: "골드", PLATINUM: "플래티넘", BLACK: "블랙" }[tier] || "일반";
    const vipEl = $("bsVip");
    if (vipEl) { vipEl.textContent = "VIP " + tierLabel; vipEl.classList.toggle("black", tier === "BLACK"); }
    set("bsIns", `보험 ${activeIns}건`);
    set("bsInv", invMatured > 0 ? `투자 ${invActive}건 · 정산 ${invMatured}` : `투자 ${invActive}건`);
    const unreadEl = $("bsUnread");
    if (unreadEl) { unreadEl.hidden = unread <= 0; unreadEl.textContent = `알림 ${unread}`; unreadEl.classList.toggle("warn", unread > 0); }
    // 등급 배지에 BLACK 강조
    const gEl = $("bsGrade"); if (gEl) gEl.classList.toggle("black", tier === "BLACK");

    // v2.9: 카드 요약 칩
    const card = (b && b.card) || {};
    const cardEl = $("bsCard");
    if (cardEl) {
      if (card.enabled) {
        const owed = Math.max(Number(card.billingAmount || 0), Number(card.usedAmount || 0));
        const due = Number(card.dueAt || 0);
        const remain = Math.max(0, Number(card.cardLimit || 0) - Number(card.usedAmount || 0));
        let txt = `카드 ${card.cardTier || ""}`;
        if (card.suspended) txt += " · 정지";
        else if (card.overdue) txt += " · 미납";
        else if (owed > 0) txt += " · 청구 " + wonK(owed);
        else txt += " · 잔여 " + wonK(remain);
        if (due > 0 && !card.suspended) { const left = Math.max(0, due - Date.now()); txt += left > 0 ? ` · D-${Math.ceil(left / 3600000)}h` : " · 결제일"; }
        if (card.autoPayEnabled) txt += " · 자동납부ON";
        cardEl.hidden = false; cardEl.textContent = txt;
        cardEl.classList.toggle("warn", !!(card.overdue || card.suspended));
      } else { cardEl.hidden = true; }
    }

    // v3.0: Company 요약 칩
    const coEl = $("bsCompany");
    if (coEl) {
      if (co && co.name) {
        const STG = { STARTUP: "스타트업", SMALL_BIZ: "소기업", SCALE_UP: "성장기업", ENTERPRISE: "대기업", PRE_IPO: "상장 준비", LISTED: "상장기업" };
        coEl.textContent = `회사 ${co.name} · ${STG[co.stage] || ""} · IPO ${Math.round(Number(co.ipoReadiness || 0))}%`;
        coEl.classList.remove("warn");
      } else { coEl.textContent = "회사 미설립"; }
    }
    const bizEl = $("bsBiz");
    const owed = (b.businessLoan ? Number(b.businessLoan.principal || 0) + Number(b.businessLoan.interest || 0) : 0);
    if (bizEl) { bizEl.hidden = owed <= 0; bizEl.textContent = "사업대출 " + wonK(owed); bizEl.classList.add("warn"); }

    // v2.9: 오늘의 금융 이벤트
    const evEl = $("bsEvent");
    if (evEl) {
      const ev = resolveHomeEvent(evRaw);
      if (ev) { evEl.hidden = false; evEl.innerHTML = `📰 <b>오늘의 금융 이벤트</b> · ${escapeHtml(ev.title)} <span class="muted">(게임머니)</span>`; }
      else evEl.hidden = true;
    }
  }
  // Home은 표시만: manual(미만료) 우선, 없으면 날짜 seed 로 간단 계산
  var HOME_EVENTS = [
    { type: "lowrate", title: "저금리 데이" }, { type: "highrate", title: "고금리 데이" },
    { type: "boom", title: "투자 호황" }, { type: "bust", title: "투자 침체" },
    { type: "insurance", title: "보험 우대 기간" }, { type: "cashback", title: "카드 캐시백 이벤트" },
    { type: "vipweek", title: "VIP 우대 기간" }, { type: "caution", title: "금융 경계주의보" },
  ];
  function resolveHomeEvent(raw) {
    const now = Date.now();
    if (raw && raw.manual && (!raw.expiresAt || Number(raw.expiresAt) > now) && raw.title) return raw;
    const d = new Date(now + 9 * 3600000);
    const key = "bankevt:" + d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return HOME_EVENTS[(h >>> 0) % HOME_EVENTS.length];
  }
  function mailLabel(m) {
    if (m.type === "cash") return `💰 ${Number(m.amount || 0).toLocaleString("ko-KR")}원`;
    if (m.type === "coupon") return `🎟 쿠폰 ${escapeHtml(m.coupon || "")}`;
    if (m.type === "skin") return `🎨 스킨 ${escapeHtml(m.itemId || "")}`;
    return "📦 선물";
  }
  function renderBank() {
    const balEl = $("bankBalance"), mailEl = $("mailList"), cnt = $("mailCount");
    if (balEl) balEl.textContent = bank.balance.toLocaleString("ko-KR") + "원";
    if (cnt) cnt.textContent = String(bank.mail.length);
    if (!mailEl) return;
    mailEl.innerHTML = bank.mail.length
      ? bank.mail.map((m) => `<div class="mail-row"><div class="mail-info"><b>${mailLabel(m)}</b><span>${escapeHtml(m.from || "STONK")}${m.msg ? " · " + escapeHtml(m.msg) : ""}</span></div><button class="btn tiny" type="button" data-claim="${m.id}">받기</button></div>`).join("")
      : `<div class="mail-empty">받은 우편이 없습니다.</div>`;
  }
  async function claimMail(id) {
    const m = bank.mail.find((x) => x.id === id);
    if (!m || !state.user || !state.db) return;
    const uid = state.user.uid, msg = $("bankMsg");
    try {
      if (m.type === "cash") {
        await state.db.ref("rooms/MAIN/bank/" + uid + "/balance").transaction((b) => (Number(b) || 0) + Number(m.amount || 0));
      } else if (m.type === "skin" && m.itemId) {
        await state.db.ref("rooms/MAIN/players/" + uid + "/gachaInventory/" + m.itemId).transaction((v) => (Number(v) || 0) + 1);
      }
      // 쿠폰(가챠 무료뽑기 등)은 Gacha 연동 예정 — 지금은 수령 표시만.
      await state.db.ref("rooms/MAIN/mail/" + uid + "/" + id + "/claimed").set(true);
      if (msg) msg.textContent = `'${mailLabel(m)}' 수령 완료!`;
      bankRefresh();
    } catch (e) {
      if (msg) msg.textContent = "수령 실패: " + ((e && e.message) || e);
    }
  }
  async function sendMoney() {
    if (!requireLogin()) return;
    if (!state.db) return;
    const msg = $("bankMsg");
    if (msg) msg.textContent = ""; // 옛 텍스트 결과 제거 (이제 결과는 팝업으로)
    const vals = await openStonkModal({
      title: "친구에게 보내기",
      desc: `금고에서 친구 금고로 보냅니다. 보유 ${bank.balance.toLocaleString("ko-KR")}원`,
      icon: "💸",
      fields: [
        { key: "to", label: "받는 사람 닉네임", placeholder: "닉네임 입력", type: "text" },
        { key: "amt", label: "보낼 금액 (원)", placeholder: "0", type: "number", suffix: "원" },
      ],
      confirm: "보내기",
    });
    if (!vals) return;
    const toName = String(vals.to || "").trim();
    const amt = Math.floor(Number(vals.amt) || 0);
    if (!toName) { await stonkAlert({ title: "보내기 실패", desc: "받는 사람 닉네임을 입력하세요.", icon: "⚠️" }); return; }
    if (!amt || amt < 1) { await stonkAlert({ title: "보내기 실패", desc: "보낼 금액을 확인하세요.", icon: "⚠️" }); return; }
    try {
      // 닉네임 → uid: 플레이어 명단(닉네임 설정 위치)과 금고 양쪽에서 찾는다
      const [pSnap, bSnap] = await Promise.all([
        state.db.ref("rooms/MAIN/players").once("value"),
        state.db.ref("rooms/MAIN/bank").once("value"),
      ]);
      const nickMap = {};
      const collect = (obj) => { Object.entries(obj || {}).forEach(([uid, v]) => { const n = String((v && v.nickname) || "").trim(); if (n && !nickMap[n]) nickMap[n] = uid; }); };
      collect(pSnap.val()); collect(bSnap.val());
      const ruid = nickMap[toName];
      if (!ruid || ruid === state.user.uid) {
        await stonkAlert({ title: "보내기 실패", icon: "⚠️", desc: ruid ? "자기 자신에게는 보낼 수 없습니다." : `'${toName}' 닉네임을 찾을 수 없습니다. (상대가 한 번 이상 접속해 닉네임을 설정해야 합니다)` });
        return;
      }
      const res = await state.db.ref("rooms/MAIN/bank/" + state.user.uid + "/balance").transaction((b) => { b = Number(b) || 0; if (b < amt) return; return b - amt; });
      if (!res.committed) { await stonkAlert({ title: "보내기 실패", desc: "금고 잔액이 부족합니다.", icon: "⚠️" }); return; }
      const mid = state.db.ref("rooms/MAIN/mail/" + ruid).push().key;
      await state.db.ref("rooms/MAIN/mail/" + ruid + "/" + mid).set({ type: "cash", amount: amt, from: deriveNick(), msg: "송금", createdAt: Date.now(), claimed: false });
      bankRefresh();
      await stonkAlert({ title: "송금 완료 🎉", icon: "✅", desc: `${toName} 님에게 ${amt.toLocaleString("ko-KR")}원을 보냈습니다.\n상대가 우편함에서 받으면 금고에 들어갑니다.` });
    } catch (e) {
      await stonkAlert({ title: "송금 실패", desc: "오류: " + ((e && e.message) || e), icon: "⚠️" });
    }
  }
  $("btnSendMoney") && $("btnSendMoney").addEventListener("click", sendMoney);
  $("btnBankRefresh") && $("btnBankRefresh").addEventListener("click", bankRefresh);
  const mailListEl = $("mailList");
  if (mailListEl) mailListEl.addEventListener("click", (e) => { const b = e.target.closest("[data-claim]"); if (b) claimMail(b.getAttribute("data-claim")); });
  window.__bankRefresh = bankRefresh;

  // 외부(룸/로그인 변경)에서 호출할 수 있게 노출
  window.__bgEquipRefresh = bgEquipRefresh;

  startPulseInterval();
  bgEquipRefresh();
  bankRefresh();

  setAdminVisible(false);
  initRememberLogin();
  initRecent();
  initFirebase();
})();
