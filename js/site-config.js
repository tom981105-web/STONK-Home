// js/site-config.js — STONK Home 공통 사이트/Firebase 연결 설정
// 배포 주소를 바꾸려면 SITE_URLS만 수정하세요.
(function () {
  const SITE_URLS = {
    home:   "https://tom981105-web.github.io/STONK-Home/",
    battle: "https://tom981105-web.github.io/STONK-Battle/",
    arcade: "https://tom981105-web.github.io/STONK-Arcade/",
    board:  "https://tom981105-web.github.io/STONK-Board/",
    wiki:   "https://tom981105-web.github.io/STONK-Wiki/",
    admin:  "https://tom981105-web.github.io/STONK-Admin/market-admin.html",
  };

  // Home도 GitHub Pages에 배포하므로 로컬 파일 경로로 우회하지 않고
  // 항상 아래 배포 주소로 이동합니다.

  // 서버/API가 생기면 여기에 Market Pulse 엔드포인트를 넣으면 됩니다.
  // 예: "https://example.com/api/stonk/pulse"
  // 응답 예시: [{ "label":"종목명", "change":"+3.2%", "text":"호재 뉴스" }]
  const PULSE_ENDPOINT = "";

  // Battle/Admin과 같은 Firebase 프로젝트를 사용합니다.
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyARFa-vzKVmIdxP5xDRXVzasL2ui94eZ-w",
    authDomain: "market-6e66a.firebaseapp.com",
    databaseURL: "https://market-6e66a-default-rtdb.firebaseio.com",
    projectId: "market-6e66a",
    storageBucket: "market-6e66a.firebasestorage.app",
    messagingSenderId: "402312269082",
    appId: "1:402312269082:web:cf304afc54057ea162b0a3",
  };

  // 프론트 UI 노출용입니다. 실제 보호는 Firebase Rules와 /admins/{uid}=true가 담당해야 합니다.
  const ADMIN_UIDS = ["yaV8N60yIiUggaWNpNF2VhkCwxb2"];
  const ADMIN_EMAILS = ["tomem@naver.com", "tom0044@naver.com"];

  const LAST_ROOM_KEY = "stonk:lastRoomCode";
  // Battle/Board/Wiki가 과거에 쓰던 키까지 같이 맞춰서
  // Home에서 이동한 방 코드가 다른 사이트에서도 우선 적용되게 합니다.
  const LEGACY_ROOM_KEYS = ["mb_roomCode", "mb-board-room", "wiki-room"];

  function normalizeRoomCode(code) {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function getUrlRoomCode() {
    try {
      const p = new URLSearchParams(location.search);
      return normalizeRoomCode(p.get("room") || p.get("roomCode") || p.get("roomId") || "");
    } catch (e) {
      return "";
    }
  }

  function setLastRoomCode(code) {
    const c = normalizeRoomCode(code);
    if (!c) return;
    try {
      localStorage.setItem(LAST_ROOM_KEY, c);
      localStorage.setItem("mb_roomCode", c);
      localStorage.setItem("mb-board-room", c);
      localStorage.setItem("wiki-room", c);
    } catch (e) {}
  }

  function getLastRoomCode() {
    try {
      const main = normalizeRoomCode(localStorage.getItem(LAST_ROOM_KEY));
      if (main) return main;
      for (const key of LEGACY_ROOM_KEYS) {
        const v = normalizeRoomCode(localStorage.getItem(key));
        if (v) return v;
      }
    } catch (e) {}
    return "";
  }

  function getCurrentRoomCode() {
    return getUrlRoomCode() || getLastRoomCode();
  }

  function baseUrl(site) {
    return SITE_URLS[site] || "#";
  }

  function buildSiteUrl(site, params) {
    const url = baseUrl(site);
    const qs = [];
    const room = normalizeRoomCode(params && params.room);
    if (room) qs.push("room=" + encodeURIComponent(room));
    if (!qs.length) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");
  }

  window.SiteConfig = {
    VERSION: "home-1.17.0",
    LAST_ROOM_KEY,
    FIREBASE_CONFIG,
    ADMIN_UIDS,
    ADMIN_EMAILS,
    getSiteConfig: () => ({ urls: { ...SITE_URLS }, local: false }),
    normalizeRoomCode,
    getUrlRoomCode,
    setLastRoomCode,
    getLastRoomCode,
    getCurrentRoomCode,
    buildSiteUrl,
    buildBattleUrl: (room) => buildSiteUrl("battle", { room }),
    buildArcadeUrl: (room) => buildSiteUrl("arcade", { room }),
    buildBoardUrl: (room) => buildSiteUrl("board", { room }),
    buildWikiUrl: (room) => buildSiteUrl("wiki", { room }),
    buildAdminUrl: (room) => buildSiteUrl("admin", { room }),
    PULSE_ENDPOINT,
  };
})();
