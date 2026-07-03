// ============ BEDLEK TARIM DEFTERİ ============
// Tek dosya çiftçi otomasyonu — Supabase ile senkron
// (c) 2026 — Skill prensiplerine göre tasarlandı

// ============ CONFIG ============
const SB_URL = 'https://rgposasyazoethintugo.supabase.co';
const SB_KEY = 'sb_publishable_JjvXp9W8tumdzbZ0TC6CAw_XNFTGGG7';
const SB_HEAD = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

// Google Drive otomatik yedek (Apps Script web app) — bağımsız 3. katman
const DRIVE_YEDEK_URL = 'https://script.google.com/macros/s/AKfycbwZg052KlMQYz999ElvC6bbuYAuPQwdF4EsX5yvg7jSiN74BYMkJYOu8sOVFML1W73C/exec';
const DRIVE_GIZLI = 'BEDLEK2026';   // Apps Script'teki GIZLI ile aynı olmalı

const KEYS = {
  firmalar: 'bt_firmalar',
  tarlalar: 'bt_tarlalar',
  kisiler: 'bt_kisiler',
  hareketler: 'bt_hareketler',
  kalemler: 'bt_kalemler'
};

// Varsayılan kalemler — kullanıcı silmediği sürece görünür
const VARSAYILAN_KALEMLER = {
  harcama: ['İşçilik', 'Tarla Kirası', 'Kepçe/İş Makinası', 'Servis Ücreti', 'Nakliye/Taşıma', 'Borç (Verilen)', 'Diğer'],
  hammadde: ['Tohum', 'Gübre', 'İlaç', 'Mazot', 'Diğer'],
  nakit_avans: ['Nakit Avans'],
  borc: ['Borç (Verilen)', 'Borç (Alınan)'],
  gelir: ['Hasılat', 'Satış', 'Diğer'],
  sanayi_odeme: ['İşçilik', 'Servis Ücreti', 'Nakliye/Taşıma', 'Diğer'],
  hasat: ['Hasat', 'Hasat & Satış', 'Stok / Depo']
};

const TUR_YON_DEFAULT = {
  harcama: 'gider',
  hammadde: 'gider',
  nakit_avans: 'gelir',
  borc: 'gider',
  gelir: 'gelir',
  sanayi_odeme: 'gider',
  hasat: 'gelir'
};

const TUR_AD = {
  harcama: 'Harcama',
  hammadde: 'Hammadde',
  nakit_avans: 'Nakit Avans',
  borc: 'Borç',
  gelir: 'Gelir',
  sanayi_odeme: 'Sanayi',
  hasat: 'Hasat'
};

// Tür → yön (gelir/gider) eşlemesi
const TUR_YON = TUR_YON_DEFAULT;

// ============ STATE ============
const state = {
  firmalar: [],
  tarlalar: [],
  kisiler: [],
  hareketler: [],
  kalemler: JSON.parse(JSON.stringify(VARSAYILAN_KALEMLER)),
  sezon: localStorage.getItem('bt_aktif_sezon') || '2026',
  gizli: localStorage.getItem('bt_gizli') === '1',
  online: navigator.onLine,
  view: 'ana',
  edit: { hareket: null, tarla: null, firma: null, kisi: null }
};

function toggleGizli() {
  state.gizli = !state.gizli;
  localStorage.setItem('bt_gizli', state.gizli ? '1' : '0');
  render();
}
window.toggleGizli = toggleGizli;

// ============ HELPERS ============
const $ = id => document.getElementById(id);
const _tl = n => Math.round(n || 0).toLocaleString('tr-TR') + ' ₺';
const _tl0 = n => Math.round(n || 0).toLocaleString('tr-TR');
const tl = n => state.gizli ? '••••• ₺' : _tl(n);
const tl0 = n => state.gizli ? '•••••' : _tl0(n);
const fd = s => { if (!s) return '—'; const p = s.split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : s; };
const uid = pre => pre + '_' + Date.now() + Math.floor(Math.random() * 1000);
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showLoading(on, msg) {
  const el = $('loading');
  el.classList.toggle('hide', !on);
  if (msg) el.querySelector('span').textContent = msg;
}

function setOnline(on) {
  state.online = on;
  $('sb-dot').classList.toggle('off', !on);
  $('sb-status-t').textContent = on ? 'Bağlı · Supabase' : 'Çevrimdışı';
}
window.addEventListener('online', async () => { setOnline(true); await flushDirty(); render(); });
window.addEventListener('offline', () => setOnline(false));

// ============ SUPABASE I/O ============
async function supaGet(key) {
  if (!navigator.onLine) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/store?key=eq.${key}&select=value`, { headers: SB_HEAD });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return data[0]?.value ?? null;
  } catch (e) {
    console.warn('supaGet hata', key, e);
    return null;
  }
}

async function supaSet(key, value) {
  if (!navigator.onLine) { toast('Çevrimdışı — sadece yerelde kaydedildi'); return false; }
  try {
    const r = await fetch(`${SB_URL}/rest/v1/store?on_conflict=key`, {
      method: 'POST',
      headers: { ...SB_HEAD, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, guncelleme: new Date().toISOString() })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (e) {
    console.error('supaSet hata', key, e);
    toast('Kayıt hatası: ' + e.message);
    return false;
  }
}

// localStorage cache
function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error('cacheSet kota', key, e); toast('⚠ Yerel depolama dolu — hemen yedek alın!'); }
}

// Hibrit load: cache'den önce göster, sonra supa'dan güncelle
async function loadAll() {
  showLoading(true, 'Veriler yükleniyor');
  // 1. Cache'den hızlı yükle
  state.firmalar = cacheGet(KEYS.firmalar) || [];
  state.tarlalar = cacheGet(KEYS.tarlalar) || [];
  state.kisiler = cacheGet(KEYS.kisiler) || [];
  state.hareketler = cacheGet(KEYS.hareketler) || [];
  const cachedKalem = cacheGet(KEYS.kalemler);
  if (cachedKalem) state.kalemler = mergeKalemler(cachedKalem);
  render();

  // 2. Supabase'den taze çek
  if (navigator.onLine) {
    // ÖNCE bekleyen yerel değişiklikleri buluta it — yoksa aşağıdaki çekiş onları ezer
    await flushDirty();
    try {
      const [f, t, k, h, kl] = await Promise.all([
        supaGet(KEYS.firmalar),
        supaGet(KEYS.tarlalar),
        supaGet(KEYS.kisiler),
        supaGet(KEYS.hareketler),
        supaGet(KEYS.kalemler)
      ]);
      // Kirli kalan (buluta gidememiş) koleksiyonu sunucudan ALMA — yoksa yerel veri kaybolur
      if (f  && !isDirty(KEYS.firmalar))   { state.firmalar = f;  cacheSet(KEYS.firmalar, f); }
      if (t  && !isDirty(KEYS.tarlalar))   { state.tarlalar = t;  cacheSet(KEYS.tarlalar, t); }
      if (k  && !isDirty(KEYS.kisiler))    { state.kisiler = k;   cacheSet(KEYS.kisiler, k); }
      if (h  && !isDirty(KEYS.hareketler)) { state.hareketler = h; cacheSet(KEYS.hareketler, h); }
      if (kl && !isDirty(KEYS.kalemler))   { state.kalemler = mergeKalemler(kl); cacheSet(KEYS.kalemler, state.kalemler); }
      // Sezonlar: sunucu + yerel BİRLEŞTİR (union — hiçbir sezon kaybolmaz)
      const ss = await supaGet('bt_sezonlar');
      if (Array.isArray(ss)) {
        let yerel = [];
        try { yerel = JSON.parse(localStorage.getItem('bt_sezonlar') || '[]'); } catch {}
        const birlesik = Array.from(new Set([...yerel.map(String), ...ss.map(String)]));
        localStorage.setItem('bt_sezonlar', JSON.stringify(birlesik));
      }
      setOnline(true);
    } catch (e) {
      setOnline(false);
    }
  } else {
    setOnline(false);
  }
  syncBanner();
  showLoading(false);
  render();
  if (navigator.onLine) driveYedekle();   // günde 1 kez otomatik Drive yedeği (3. katman)
}

// ---- Bekleyen (buluta gönderilememiş) yazma yönetimi ----
// Amaç: çevrimdışıyken/hatada girilen veri, bir sonraki açılışta sunucudaki
// ESKİ veriyle ezilmesin. Kirli işaretli koleksiyon önce buluta itilir; itilene
// kadar sunucudan ÇEKİLMEZ.
function dirtyKey(key) { return 'bt_dirty_' + key; }
function isDirty(key)  { return localStorage.getItem(dirtyKey(key)) === '1'; }
function setDirty(key, on) {
  if (on) localStorage.setItem(dirtyKey(key), '1');
  else localStorage.removeItem(dirtyKey(key));
}
function bekleyenSayisi() { return Object.values(KEYS).filter(isDirty).length; }

async function persist(key) {
  const prop = key.replace('bt_', '');
  cacheSet(key, state[prop]);            // önce yerel — veri her koşulda güvende
  const ok = await supaSet(key, state[prop]);
  setDirty(key, !ok);                     // buluta gidemezse "bekliyor" işaretle
  syncBanner();
  return ok;
}

// Bekleyen yerel değişiklikleri buluta gönder (açılışta + internet gelince)
async function flushDirty() {
  if (!navigator.onLine) return;
  for (const key of Object.values(KEYS)) {
    if (!isDirty(key)) continue;
    const ok = await supaSet(key, state[key.replace('bt_', '')]);
    if (ok) setDirty(key, false);
  }
  syncBanner();
}

// Senkronlanmamış veri varsa üstte kalıcı uyarı bandı göster
function syncBanner() {
  const n = bekleyenSayisi();
  let el = document.getElementById('sync-banner');
  if (!n) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:9px 12px;font-size:13px;line-height:1.35;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer';
    el.onclick = () => flushDirty().then(render);
    document.body.appendChild(el);
  }
  el.textContent = `⚠ ${n} değişiklik buluta gönderilmedi — internet gelince otomatik gönderilir (dokun: şimdi dene)`;
}

// Yüklenen kalem objesinde eksik tür varsa varsayılan ekle
function mergeKalemler(loaded) {
  const out = {};
  Object.keys(VARSAYILAN_KALEMLER).forEach(tur => {
    out[tur] = Array.isArray(loaded[tur]) ? loaded[tur] : VARSAYILAN_KALEMLER[tur].slice();
  });
  return out;
}

// ============ HESAPLAR ============
function harcamaToplam(h) { return (parseFloat(h.tutar) || 0); }

function tarlaMaliyeti(tarlaId) {
  return state.hareketler
    .filter(h => h.tarla_id === tarlaId && h.yon === 'gider' && h.sezon === state.sezon)
    .reduce((s, h) => s + harcamaToplam(h), 0);
}

function tarlaHasat(tarlaId) {
  // Hasat türündeki hareketleri topla — gelir ve miktar
  const hh = state.hareketler.filter(h => h.tur === 'hasat' && h.tarla_id === tarlaId && h.sezon === state.sezon);
  let gelir = 0, miktar = 0, birim = '';
  hh.forEach(h => {
    gelir += parseFloat(h.tutar) || 0;
    miktar += parseFloat(h.miktar) || 0;
    if (h.birim) birim = h.birim;
  });
  return { gelir, miktar, birim, sayi: hh.length };
}

function tarlaKarZarar(tarlaId) {
  const m = tarlaMaliyeti(tarlaId);
  const h = tarlaHasat(tarlaId);
  return { maliyet: m, gelir: h.gelir, net: h.gelir - m, hasat: h };
}

function firmaHesap(firmaId) {
  const hh = state.hareketler.filter(h => h.firma_id === firmaId && h.sezon === state.sezon);
  let avans = 0, harcanan = 0, gelir = 0, firmaMali = 0;
  hh.forEach(h => {
    const t = parseFloat(h.tutar) || 0;
    if (h.tur === 'nakit_avans') avans += t;
    else if (h.kaynak === 'firma') firmaMali += t;              // firmadan AYNİ gelen mal (ilaç, gübre vb.)
    else if (h.kaynak === 'avans') harcanan += t;
    else if (h.yon === 'gelir' && h.tur !== 'nakit_avans') gelir += t;
  });
  // Firmaya toplam borç = alınan nakit avans + ayni mal (ikisi de firmadan alındı, ödenecek)
  return { avans, harcanan, kalan: avans - harcanan, gelir, firmaMali, borc: avans + firmaMali };
}

function kisiBakiye(kisiId) {
  const hh = state.hareketler.filter(h => h.kisi_id === kisiId);
  let bakiye = 0;
  hh.forEach(h => {
    const t = parseFloat(h.tutar) || 0;
    if (h.tur === 'borc' && h.kalem === 'Borç (Verilen)') bakiye += t;       // bize borçlu
    else if (h.tur === 'borc' && h.kalem === 'Borç (Alınan)') bakiye -= t;   // biz borçluyuz
    else if (h.yon === 'gider') bakiye += t;                                  // ödenecek (alacaklı)
  });
  return bakiye;
}

// ============ FİRMA / KİŞİ DETAY ============
function statBlok(label, value, cls) {
  return `<div class="firma-stat"><div class="firma-stat-l">${label}</div><div class="firma-stat-v ${cls || ''}">${value}</div></div>`;
}

function closeDetay() {
  $('overlay-detay').classList.remove('open');
}
window.closeDetay = closeDetay;

function openFirmaDetay(id) {
  const f = state.firmalar.find(x => x.id === id);
  if (!f) return;
  const h = firmaHesap(f.id);
  const hareketler = state.hareketler
    .filter(x => x.firma_id === id && x.sezon === state.sezon)
    .sort((a, b) => (b.olusturma || '').localeCompare(a.olusturma || ''));

  $('detay-title').textContent = f.ad;
  $('detay-sub').textContent = (f.urun ? f.urun + ' · ' : '') + state.sezon + ' sezonu';
  $('detay-stats').innerHTML =
    statBlok('Avans Alındı', tl(h.avans), 'green') +
    statBlok('Harcanan', tl(h.harcanan), 'red') +
    statBlok('Kalan', tl(h.kalan), 'orange') +
    (h.firmaMali > 0 ? statBlok('Firma Malı (ayni)', tl(h.firmaMali), 'orange') : '');
  $('detay-tx').innerHTML = hareketler.length
    ? hareketler.map((hh, i) => txCard(hh, i)).join('')
    : emptyState('Hareket yok', 'Bu firma için bu sezon henüz kayıt eklenmemiş.');
  $('btn-detay-duzenle').onclick = () => { closeDetay(); duzenleFirma(id); };
  $('btn-detay-hareket').onclick = () => { closeDetay(); openHareket(); $('f-firma').value = id; };
  $('overlay-detay').classList.add('open');
}
window.openFirmaDetay = openFirmaDetay;

function openKisiDetay(id) {
  const k = state.kisiler.find(x => x.id === id);
  if (!k) return;
  const hareketler = state.hareketler
    .filter(x => x.kisi_id === id)
    .sort((a, b) => (b.olusturma || '').localeCompare(a.olusturma || ''));
  let verilen = 0, alinan = 0;
  hareketler.forEach(h => {
    const t = parseFloat(h.tutar) || 0;
    if (h.yon === 'gider') verilen += t; else alinan += t;
  });
  const bakiye = kisiBakiye(id);

  $('detay-title').textContent = k.ad;
  $('detay-sub').textContent = k.tur + (k.telefon ? ' · ' + k.telefon : '');
  $('detay-stats').innerHTML =
    statBlok('Verilen', tl(verilen), 'red') +
    statBlok('Alınan', tl(alinan), 'green') +
    statBlok(bakiye >= 0 ? 'Alacaklı' : 'Borçlu', (bakiye >= 0 ? '+' : '') + tl(bakiye), bakiye >= 0 ? 'green' : 'red');
  $('detay-tx').innerHTML = hareketler.length
    ? hareketler.map((hh, i) => txCard(hh, i)).join('')
    : emptyState('Hareket yok', 'Bu kişi için henüz kayıt eklenmemiş.');
  $('btn-detay-duzenle').onclick = () => { closeDetay(); duzenleKisi(id); };
  $('btn-detay-hareket').onclick = () => { closeDetay(); openHareket(); $('f-kisi').value = id; };
  $('overlay-detay').classList.add('open');
}
window.openKisiDetay = openKisiDetay;

// ============ RENDER: NAV BADGE ============
function renderBadges() {
  $('badge-hareketler').textContent = state.hareketler.filter(h => h.sezon === state.sezon).length;
  $('badge-tarlalar').textContent = state.tarlalar.length;
  $('badge-firmalar').textContent = state.firmalar.length;
  $('badge-kisiler').textContent = state.kisiler.length;
  $('brand-season').textContent = 'Sezon ' + state.sezon;
}

// ============ RENDER: ANA ============
function renderAna() {
  const hh = state.hareketler.filter(h => h.sezon === state.sezon);
  // Avans ve borç FİNANSMANDIR — gerçek gelir/gider ve kâr/zarara KATILMAZ. Yoksa
  // firmadan alınan avans "gelir" görünür ve çiftçi borçluyken "kâr" gösterir.
  const finansman = h => (h.tur === 'nakit_avans' || h.tur === 'borc');
  let gelir = 0, gider = 0, hasatGelir = 0, avansBorc = 0;
  hh.forEach(h => {
    const t = parseFloat(h.tutar) || 0;
    if (h.tur === 'hasat') hasatGelir += t;
    if (finansman(h)) { avansBorc += (h.yon === 'gelir' ? t : -t); return; }
    if (h.yon === 'gelir') gelir += t; else gider += t;
  });
  const net = gelir - gider;

  // En çok harcama yapılan kalem (finansman hariç)
  const giderler = hh.filter(h => h.yon === 'gider' && !finansman(h));
  const kalemMap = {};
  giderler.forEach(h => {
    kalemMap[h.kalem] = (kalemMap[h.kalem] || 0) + (parseFloat(h.tutar) || 0);
  });
  const enCokKalem = Object.entries(kalemMap).sort((a, b) => b[1] - a[1])[0];

  const stats = [
    { color: 'green', icon: ic.gelir, l: 'Toplam Gelir', v: tl(gelir), s: `${state.sezon} sezonu` },
    { color: 'red', icon: ic.gider, l: 'Toplam Gider', v: tl(gider), s: giderler.length + ' işlem' },
    { color: net >= 0 ? 'orange' : 'red', icon: ic.wallet, l: 'Net Durum', v: tl(net), s: (net >= 0 ? '✓ Kâr' : '⚠ Zarar') + (avansBorc ? ' · Avans/Borç ' + tl(avansBorc) : '') },
    { color: 'gold', icon: ic.wheat, l: 'Hasat Geliri', v: hasatGelir > 0 ? tl(hasatGelir) : '—', s: hh.filter(h => h.tur === 'hasat').length + ' hasat' }
  ];
  const gizliIcon = state.gizli
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  $('ana-stats').innerHTML = `
    <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;margin-bottom:-4px">
      <h3 style="font-family:var(--font-display);font-size:15px;font-weight:600;color:var(--muted)">Sezon Özeti</h3>
      <button class="btn btn-ghost btn-sm" onclick="toggleGizli()" title="${state.gizli ? 'Göster' : 'Gizle'}">${gizliIcon}<span>${state.gizli ? 'Göster' : 'Gizle'}</span></button>
    </div>
  ` + stats.map((s, i) => `
    <div class="stat ${s.color} fade-in" style="animation-delay:${i * .04 + .04}s">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-l">${s.l}</div>
      <div class="stat-v">${s.v}</div>
      <div class="stat-s">${s.s}</div>
    </div>`).join('');

  // Son hareketler
  const son = [...hh].sort((a, b) => (b.olusturma || '').localeCompare(a.olusturma || '')).slice(0, 8);
  $('ana-tx').innerHTML = son.length ? son.map((h, i) => txCard(h, i)).join('') : emptyState('Henüz hareket yok', 'Sağ alttaki + butonuna basarak ilk hareketini ekle.');
}

// ============ RENDER: HAREKETLER ============
function renderHareketler() {
  const q = ($('srch-tx')?.value || '').toLowerCase();
  const ft = $('flt-tur')?.value;
  const fy = $('flt-yon')?.value;

  let rows = state.hareketler.filter(h => h.sezon === state.sezon);
  if (ft) rows = rows.filter(h => h.tur === ft);
  if (fy) rows = rows.filter(h => h.yon === fy);
  if (q) rows = rows.filter(h => {
    const blob = [h.aciklama, h.kalem, kisiAd(h.kisi_id), firmaAd(h.firma_id), tarlaAd(h.tarla_id)].join(' ').toLowerCase();
    return blob.includes(q);
  });
  rows.sort((a, b) => (b.olusturma || '').localeCompare(a.olusturma || ''));
  $('tx-list').innerHTML = rows.length ? rows.map((h, i) => txCard(h, i)).join('') : emptyState('Sonuç yok', 'Filtreleri değiştirip tekrar dene.');
}

function txCard(h, i) {
  const meta = [];
  if (h.tarla_id) meta.push(`<span class="chip green">🌾 ${tarlaAd(h.tarla_id)}</span>`);
  if (h.firma_id) meta.push(`<span class="chip orange">🏢 ${firmaAd(h.firma_id)}</span>`);
  if (h.kisi_id) meta.push(`<span class="chip purple">👤 ${kisiAd(h.kisi_id)}</span>`);
  const sub = h.aciklama || '';
  const subPart = [meta.length ? meta.join('') : '', sub ? `<span class="tx-s">${escapeHtml(sub)}</span>` : ''].filter(Boolean).join(' ');
  const sub2 = h.miktar ? `${tl0(h.miktar)} ${h.birim || ''}` : '';
  const sign = h.yon === 'gider' ? '−' : '+';
  return `
    <div class="tx ${h.tur} fade-in" style="animation-delay:${Math.min(i, 8) * .03 + .04}s" onclick="duzenleHareket(${h.id})">
      <div class="tx-ico">${turIcon(h.tur)}</div>
      <div class="tx-main">
        <div class="tx-t">${escapeHtml(h.kalem)} ${subPart}</div>
        <div class="tx-s">${escapeHtml(sub)}</div>
      </div>
      <div>
        <div class="tx-amt ${h.yon}">${sign} ${tl(h.tutar)}</div>
        ${sub2 ? `<div class="tx-amt-sub">${sub2}</div>` : ''}
      </div>
      <div class="tx-date">${fd(h.tarih)}</div>
    </div>`;
}

// ============ RENDER: TARLALAR ============
function renderTarlalar() {
  const q = ($('srch-tarla')?.value || '').toLowerCase();
  let rows = state.tarlalar.slice();
  if (q) rows = rows.filter(t => (t.ad + ' ' + (t.urun || '') + ' ' + (t.sahip || '')).toLowerCase().includes(q));

  $('tarlalar-grid').innerHTML = rows.length ? rows.map((t, i) => {
    const kz = tarlaKarZarar(t.id);
    const dekarMaliyet = t.dekar > 0 ? kz.maliyet / t.dekar : 0;
    const firma = state.firmalar.find(f => f.id === t.firma_id);
    const hasHasat = kz.hasat.sayi > 0;
    const netColor = kz.net >= 0 ? 'var(--forest)' : 'var(--red)';
    return `
      <div class="tarla-card fade-in" style="animation-delay:${Math.min(i, 12) * .03 + .04}s" onclick="duzenleTarla('${t.id}')">
        <div class="tarla-h">
          <div>
            <div class="tarla-ad">${escapeHtml(t.ad)}</div>
            <div class="tarla-sahip">${escapeHtml(t.sahip || '—')}</div>
          </div>
          <div class="tarla-dekar">${tl0(t.dekar)} dk</div>
        </div>
        <div class="tarla-meta">
          ${t.urun ? `<span class="chip green">🌾 ${escapeHtml(t.urun)}</span>` : ''}
          <span class="chip ${t.modul === 'sozlesmeli' ? 'orange' : 'gold'}">${t.modul === 'sozlesmeli' ? 'Sözleşmeli' : 'Şahsi'}</span>
          ${firma ? `<span class="chip blue">🏢 ${escapeHtml(firma.ad)}</span>` : ''}
          ${hasHasat ? `<span class="chip green">🌾 ${tl0(kz.hasat.miktar)} ${kz.hasat.birim || ''}${t.dekar > 0 && kz.hasat.miktar > 0 ? ' · ' + tl0(kz.hasat.miktar / t.dekar) + '/dk verim' : ''}</span>` : ''}
        </div>
        <div class="tarla-cost">
          <div>
            <div class="tarla-cost-l">Maliyet</div>
            <div class="tarla-cost-v">${tl(kz.maliyet)}</div>
            <div class="tarla-dekar-cost">${tl(dekarMaliyet)}/dk</div>
          </div>
          <div style="text-align:right">
            <div class="tarla-cost-l">${kz.gelir > 0 ? (kz.net >= 0 ? 'Kâr' : 'Zarar') : 'Hasat'}</div>
            <div class="tarla-cost-v" style="color:${kz.gelir > 0 ? netColor : 'var(--muted)'}">${kz.gelir > 0 ? tl(kz.net) : '—'}</div>
            <div class="tarla-dekar-cost">${kz.gelir > 0 ? 'gelir ' + tl(kz.gelir) : 'henüz hasat yok'}</div>
          </div>
        </div>
      </div>`;
  }).join('') : emptyState('Tarla yok', '+ Tarla butonuna basarak ekle.');
}

// ============ RENDER: FIRMALAR ============
function renderFirmalar() {
  const rows = state.firmalar.slice();
  $('firmalar-grid').innerHTML = rows.length ? rows.map((f, i) => {
    const h = firmaHesap(f.id);
    return `
      <div class="firma-card fade-in" style="animation-delay:${i * .05 + .04}s" onclick="openFirmaDetay('${f.id}')">
        <div class="firma-h">
          <div class="firma-ad">${escapeHtml(f.ad)}</div>
          <div class="firma-urun">${escapeHtml(f.urun || '—')}</div>
        </div>
        <div class="firma-stats">
          <div class="firma-stat">
            <div class="firma-stat-l">Avans Alındı</div>
            <div class="firma-stat-v green">${tl(h.avans)}</div>
          </div>
          <div class="firma-stat">
            <div class="firma-stat-l">Harcanan</div>
            <div class="firma-stat-v red">${tl(h.harcanan)}</div>
          </div>
          <div class="firma-stat">
            <div class="firma-stat-l">Kalan</div>
            <div class="firma-stat-v orange">${tl(h.kalan)}</div>
          </div>
          ${h.firmaMali > 0 ? `<div class="firma-stat" style="grid-column:1/-1">
            <div class="firma-stat-l">Firma Malı (ayni)</div>
            <div class="firma-stat-v orange">${tl(h.firmaMali)}</div>
          </div>` : ''}
        </div>
      </div>`;
  }).join('') : emptyState('Firma yok', '+ Firma butonuna bas.');
}

// ============ RENDER: KISILER ============
function renderKisiler() {
  const q = ($('srch-kisi')?.value || '').toLowerCase();
  const ft = $('flt-kisi-tur')?.value;
  let rows = state.kisiler.slice();
  if (ft) rows = rows.filter(k => k.tur === ft);
  if (q) rows = rows.filter(k => k.ad.toLowerCase().includes(q));

  $('kisiler-grid').innerHTML = rows.length ? rows.map((k, i) => {
    const bakiye = kisiBakiye(k.id);
    const av = (k.ad || '?').trim()[0] || '?';
    return `
      <div class="kisi-card fade-in" style="animation-delay:${Math.min(i, 12) * .03 + .04}s" onclick="openKisiDetay('${k.id}')">
        <div class="kisi-av ${k.tur}">${av}</div>
        <div class="kisi-info">
          <div class="kisi-ad">${escapeHtml(k.ad)}</div>
          <div class="kisi-tur">${k.tur}</div>
        </div>
        ${bakiye !== 0 ? `<div class="kisi-bakiye ${bakiye > 0 ? 'alacak' : 'borc'}">${bakiye > 0 ? '+' : ''}${tl(bakiye)}</div>` : ''}
      </div>`;
  }).join('') : emptyState('Kişi yok', '+ Kişi butonuna bas.');
}

// ============ RENDER: RAPORLAR ============
function renderRaporlar() {
  const hh = state.hareketler.filter(h => h.sezon === state.sezon);

  // Genel özet — avans/borç finansmandır, gelir/gider ve kâr/zarara katılmaz
  const finansman = h => (h.tur === 'nakit_avans' || h.tur === 'borc');
  let totalGelir = 0, totalGider = 0, hasatGelir = 0;
  hh.forEach(h => {
    const t = parseFloat(h.tutar) || 0;
    if (h.tur === 'hasat') hasatGelir += t;
    if (finansman(h)) return;
    if (h.yon === 'gelir') totalGelir += t; else totalGider += t;
  });
  const totalNet = totalGelir - totalGider;
  const maxVal = Math.max(totalGelir, totalGider, 1);
  const gelirPct = Math.round(totalGelir / maxVal * 100);
  const giderPct = Math.round(totalGider / maxVal * 100);

  // 1. Kalem dağılımı (finansman hariç)
  const kalemMap = {};
  hh.filter(h => h.yon === 'gider' && !finansman(h)).forEach(h => {
    kalemMap[h.kalem] = (kalemMap[h.kalem] || 0) + (parseFloat(h.tutar) || 0);
  });
  const kalemArr = Object.entries(kalemMap).sort((a, b) => b[1] - a[1]);
  const kalemTop = kalemArr.reduce((s, [_, v]) => s + v, 0);

  // 2. Firma raporu
  const firmaR = state.firmalar.map(f => ({ f, ...firmaHesap(f.id) })).sort((a, b) => b.kalan - a.kalan);

  // 3. Tarla maliyeti
  const tarlaR = state.tarlalar.map(t => ({ t, maliyet: tarlaMaliyeti(t.id) })).filter(x => x.maliyet > 0).sort((a, b) => b.maliyet - a.maliyet);

  // 4. Kişi borç
  const kisiR = state.kisiler.map(k => ({ k, bakiye: kisiBakiye(k.id) })).filter(x => x.bakiye !== 0).sort((a, b) => Math.abs(b.bakiye) - Math.abs(a.bakiye));

  // 5. Ürün bazında toplam
  const urunMap = {};
  state.tarlalar.forEach(t => {
    const u = (t.urun || 'Belirsiz').trim() || 'Belirsiz';
    if (!urunMap[u]) urunMap[u] = { tarla: 0, dekar: 0, maliyet: 0 };
    urunMap[u].tarla++;
    urunMap[u].dekar += parseFloat(t.dekar) || 0;
    urunMap[u].maliyet += tarlaMaliyeti(t.id);
  });
  const urunArr = Object.entries(urunMap).sort((a, b) => b[1].maliyet - a[1].maliyet);

  // 6. Aylık gider (bu sezon, finansman hariç)
  const AY_AD = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const ayGider = {};
  hh.forEach(h => {
    if (h.yon !== 'gider' || finansman(h)) return;
    const ay = (h.tarih || '').slice(0, 7);
    if (ay) ayGider[ay] = (ayGider[ay] || 0) + (parseFloat(h.tutar) || 0);
  });
  const ayArr = Object.entries(ayGider).sort((a, b) => a[0].localeCompare(b[0]));
  const ayMax = Math.max(1, ...ayArr.map(([, v]) => v));

  // 7. Sezon karşılaştırma (tüm sezonlar, finansman hariç)
  const sezonlarSet = Array.from(new Set(state.hareketler.map(h => String(h.sezon)).filter(Boolean))).sort();
  const sezonR = sezonlarSet.map(sz => {
    let g = 0, gd = 0;
    state.hareketler.forEach(h => {
      if (String(h.sezon) !== sz || finansman(h)) return;
      const t = parseFloat(h.tutar) || 0;
      if (h.yon === 'gelir') g += t; else gd += t;
    });
    return { sezon: sz, gelir: g, gider: gd, net: g - gd };
  });

  $('reports').innerHTML = `
    <div class="report-card fade-in" style="grid-column:1/-1;background:linear-gradient(135deg,var(--paper) 0%,var(--paper-2) 100%);border:none;padding:24px">
      <div class="report-h">
        <h3 style="font-size:18px">📊 ${state.sezon} Sezonu — Genel Bilanço</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="yazdirRapor()">🖨️ Yazdır</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleGizli()">${state.gizli ? 'Göster' : 'Gizle'}</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:18px">
        <div style="background:var(--forest-l);padding:14px;border-radius:var(--r);border-left:4px solid var(--forest)">
          <div style="font-size:11px;color:var(--forest);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Gelir</div>
          <div style="font-family:var(--font-mono);font-weight:800;font-size:22px;color:var(--forest)">${tl(totalGelir)}</div>
          ${hasatGelir > 0 ? `<div style="font-size:11px;color:var(--forest);margin-top:4px;opacity:.8">↳ hasat ${tl(hasatGelir)}</div>` : ''}
        </div>
        <div style="background:var(--red-l);padding:14px;border-radius:var(--r);border-left:4px solid var(--red)">
          <div style="font-size:11px;color:var(--red);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">Gider</div>
          <div style="font-family:var(--font-mono);font-weight:800;font-size:22px;color:var(--red)">${tl(totalGider)}</div>
          <div style="font-size:11px;color:var(--red);margin-top:4px;opacity:.8">${hh.filter(h=>h.yon==='gider').length} işlem</div>
        </div>
        <div style="background:${totalNet>=0?'var(--gold-l)':'var(--red-l)'};padding:14px;border-radius:var(--r);border-left:4px solid ${totalNet>=0?'var(--orange)':'var(--red)'}">
          <div style="font-size:11px;color:${totalNet>=0?'var(--earth)':'var(--red)'};text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:4px">${totalNet>=0?'Net Kâr':'Net Zarar'}</div>
          <div style="font-family:var(--font-mono);font-weight:800;font-size:22px;color:${totalNet>=0?'var(--earth)':'var(--red)'}">${tl(totalNet)}</div>
          <div style="font-size:11px;color:${totalNet>=0?'var(--earth)':'var(--red)'};margin-top:4px;opacity:.8">${totalGelir>0?'%'+Math.round(totalNet/totalGelir*100)+' marj':'—'}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px"><span>GELİR</span><span style="font-family:var(--font-mono)">${tl(totalGelir)}</span></div>
          <div class="bar" style="height:10px"><div class="bar-fill" style="width:${gelirPct}%;background:var(--forest)"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px"><span>GİDER</span><span style="font-family:var(--font-mono)">${tl(totalGider)}</span></div>
          <div class="bar" style="height:10px"><div class="bar-fill" style="width:${giderPct}%;background:var(--red)"></div></div>
        </div>
      </div>
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>💸 Kalem Dağılımı</h3><span class="chip">${tl(kalemTop)}</span></div>
      ${kalemArr.length ? kalemArr.slice(0, 10).map(([k, v]) => `
        <div class="report-row">
          <span>${escapeHtml(k)}</span>
          <span><b>${tl(v)}</b> <span style="color:var(--muted);font-size:11px">· %${Math.round(v / kalemTop * 100)}</span></span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${Math.round(v / kalemTop * 100)}%"></div></div>
      `).join('') : '<div style="color:var(--muted);font-size:13px">Veri yok</div>'}
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>🏢 Firma Hesabı</h3></div>
      ${firmaR.length ? firmaR.map(({ f, avans, harcanan, kalan }) => `
        <div class="report-row" style="display:block">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600">${escapeHtml(f.ad)}</span>
            <b style="color:${kalan >= 0 ? 'var(--forest)' : 'var(--red)'}">${tl(kalan)}</b>
          </div>
          <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">
            avans ${tl(avans)} · harcanan ${tl(harcanan)}
          </div>
        </div>
      `).join('') : '<div style="color:var(--muted);font-size:13px">Veri yok</div>'}
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>🌾 Tarla Maliyeti</h3></div>
      ${tarlaR.length ? tarlaR.slice(0, 10).map(({ t, maliyet }) => `
        <div class="report-row">
          <span><b style="font-weight:600">${escapeHtml(t.ad)}</b><br><span style="color:var(--muted);font-size:11px">${tl0(t.dekar)} dk · ${escapeHtml(t.urun || '—')}</span></span>
          <span><b>${tl(maliyet)}</b><br><span style="color:var(--muted);font-size:11px">${tl(t.dekar > 0 ? maliyet / t.dekar : 0)}/dk</span></span>
        </div>
      `).join('') : '<div style="color:var(--muted);font-size:13px">Veri yok</div>'}
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>👥 Kişi Borç/Alacak</h3></div>
      ${kisiR.length ? kisiR.slice(0, 12).map(({ k, bakiye }) => `
        <div class="report-row">
          <span>${escapeHtml(k.ad)} <span class="chip" style="margin-left:6px">${k.tur}</span></span>
          <b style="color:${bakiye > 0 ? 'var(--forest)' : 'var(--red)'}">${bakiye > 0 ? '+' : ''}${tl(bakiye)}</b>
        </div>
      `).join('') : '<div style="color:var(--muted);font-size:13px">Veri yok</div>'}
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>📦 Ürün Bazında</h3></div>
      ${urunArr.length ? urunArr.map(([u, x]) => `
        <div class="report-row" style="display:block">
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600">${escapeHtml(u)}</span>
            <b>${tl(x.maliyet)}</b>
          </div>
          <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">
            ${x.tarla} tarla · ${tl0(x.dekar)} dekar · ${tl(x.dekar > 0 ? x.maliyet / x.dekar : 0)}/dk
          </div>
        </div>
      `).join('') : '<div style="color:var(--muted);font-size:13px">Veri yok</div>'}
    </div>

    <div class="report-card fade-in">
      <div class="report-h"><h3>📈 Aylık Gider</h3><span class="chip">${state.sezon}</span></div>
      ${ayArr.length ? `<div style="display:flex;align-items:flex-end;gap:5px;padding-top:8px;min-height:130px">
        ${ayArr.map(([ay, v]) => {
          const hpx = Math.max(6, Math.round(v / ayMax * 110));
          const ayNo = parseInt(ay.slice(5, 7), 10);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;min-width:0">
            <div style="width:100%;height:${hpx}px;border-radius:6px 6px 0 0;background:linear-gradient(180deg,var(--red) 0%,var(--orange) 100%)" title="${AY_AD[ayNo - 1] || ay}: ${tl(v)}"></div>
            <div style="font-size:10px;color:var(--muted)">${AY_AD[ayNo - 1] || ''}</div>
          </div>`;
        }).join('')}
      </div>` : '<div style="color:var(--muted);font-size:13px">Bu sezonda gider yok</div>'}
    </div>

    ${sezonR.length > 1 ? `<div class="report-card fade-in">
      <div class="report-h"><h3>📅 Sezon Karşılaştırma</h3></div>
      ${sezonR.map(s => `
        <div class="report-row" style="display:block">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:700${s.sezon === state.sezon ? ';color:var(--forest)' : ''}">${s.sezon}${s.sezon === state.sezon ? ' ●' : ''}</span>
            <b style="color:${s.net >= 0 ? 'var(--forest)' : 'var(--red)'}">${tl(s.net)}</b>
          </div>
          <div style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">gelir ${tl(s.gelir)} · gider ${tl(s.gider)}</div>
        </div>
      `).join('')}
    </div>` : ''}
  `;
}

// ============ HARDS / LOOKUPS ============
function firmaAd(id) { return state.firmalar.find(f => f.id === id)?.ad || ''; }
function tarlaAd(id) { return state.tarlalar.find(t => t.id === id)?.ad || ''; }
function kisiAd(id) { return state.kisiler.find(k => k.id === id)?.ad || ''; }

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emptyState(t, p) {
  return `<div class="empty fade-in">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
    <h3>${t}</h3><p>${p}</p>
  </div>`;
}

// ============ ICONS ============
const ic = {
  gelir: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  gider: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  wallet: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/></svg>',
  box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  wheat: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V8"/><path d="M5 12c0-3 2-6 7-6"/><path d="M19 12c0-3-2-6-7-6"/><path d="M5 18c0-2 2-4 5-4"/><path d="M19 18c0-2-2-4-5-4"/></svg>',
};

function turIcon(tur) {
  const i = {
    harcama: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 19V5"/><polyline points="19 12 12 19 5 12"/></svg>',
    hammadde: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>',
    nakit_avans: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="12"/><polyline points="12 12 16 14"/></svg>',
    borc: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
    gelir: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><polyline points="5 12 12 5 19 12"/></svg>',
    sanayi_odeme: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    hasat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V8"/><path d="M5 12c0-3 2-6 7-6"/><path d="M19 12c0-3-2-6-7-6"/><path d="M5 18c0-2 2-4 5-4"/><path d="M19 18c0-2-2-4-5-4"/></svg>'
  };
  return i[tur] || i.harcama;
}

// Tx ikon CSS sınıfları için hasat
const TX_CLASS = { harcama: 'gider', hammadde: 'hammadde', nakit_avans: 'gelir', borc: 'borc', gelir: 'gelir', sanayi_odeme: 'gider', hasat: 'gelir' };

// ============ NAV ============
function goView(v) {
  state.view = v;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === 'v-' + v));
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === v));
  document.querySelectorAll('.mob-tab[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === v));
  $('mob-daha')?.classList.toggle('active', ['tarlalar', 'firmalar', 'kisiler', 'ayarlar'].includes(v));
  const titles = { ana: ['Ana Sayfa', 'Sezon özeti'], hareketler: ['Hareketler', 'Tüm gelir/gider kayıtları'], tarlalar: ['Tarlalar', 'Tarla bazlı maliyet'], firmalar: ['Firmalar', 'Sözleşmeli üretim hesabı'], kisiler: ['Kişiler', 'Aile, hizmet, tedarikçi'], raporlar: ['Raporlar', state.sezon + ' sezonu analizi'], ayarlar: ['Ayarlar', 'Veri ve sezon'] };
  const [t, s] = titles[v] || ['', ''];
  $('page-title').textContent = t;
  $('page-sub').textContent = s;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.goView = goView;

function openDaha() { $('overlay-daha').classList.add('open'); }
window.openDaha = openDaha;
function closeDaha() { $('overlay-daha').classList.remove('open'); }
window.closeDaha = closeDaha;
function gitDaha(v) { closeDaha(); goView(v); }
window.gitDaha = gitDaha;

function render() {
  renderBadges();
  if (state.view === 'ana') renderAna();
  else if (state.view === 'hareketler') renderHareketler();
  else if (state.view === 'tarlalar') renderTarlalar();
  else if (state.view === 'firmalar') renderFirmalar();
  else if (state.view === 'kisiler') renderKisiler();
  else if (state.view === 'raporlar') renderRaporlar();
  else if (state.view === 'ayarlar') { renderSezonSelect(); renderKalemYonet(); }
}
window.renderHareketler = renderHareketler;
window.renderTarlalar = renderTarlalar;
window.renderKisiler = renderKisiler;

// ============ HAREKET MODAL ============
function openHareket() {
  state.edit.hareket = null;
  $('hareket-title').textContent = 'Yeni Hareket';
  $('btn-sil-h').style.display = 'none';
  $('t-harcama').checked = true;
  $('f-tutar').value = '';
  $('f-miktar').value = '';
  $('f-birim-fiyat').value = '';
  $('f-toplam-goster').textContent = '0 ₺';
  $('f-tarih').value = today();
  $('f-aciklama').value = '';
  $('f-firma').value = '';
  $('f-tarla').value = '';
  $('f-kisi').value = '';
  $('f-kaynak').value = 'cep';
  populateSelects();
  updateForm();
  $('overlay-hareket').classList.add('open');
}
window.openHareket = openHareket;
window.closeHareket = () => $('overlay-hareket').classList.remove('open');

const NEW_TOKEN = '__YENI__';

function populateSelects() {
  $('f-firma').innerHTML = '<option value="">— seçme —</option>' + state.firmalar.map(f => `<option value="${f.id}">${escapeHtml(f.ad)}</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni firma ekle…</option>`;
  $('f-tarla').innerHTML = '<option value="">— seçme —</option>' + state.tarlalar.map(t => `<option value="${t.id}">${escapeHtml(t.ad)}</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni tarla ekle…</option>`;
  $('f-kisi').innerHTML = '<option value="">— seçme —</option>' + state.kisiler.map(k => `<option value="${k.id}">${escapeHtml(k.ad)} (${k.tur})</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni kişi ekle…</option>`;
  $('t-firma').innerHTML = '<option value="">— yok —</option>' + state.firmalar.map(f => `<option value="${f.id}">${escapeHtml(f.ad)}</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni firma ekle…</option>`;
}

// Tüm "yeni ekle" select change handler'ı — uygun modal'i açar
// Kaydet sonrası state.pendingSelect üzerinden hareket formundaki select'e yeni id yazılır
function handleSelectNew(el, tip) {
  if (el.value !== NEW_TOKEN) return;
  el.value = '';
  state.pendingSelect = { el, tip };
  if (tip === 'firma') openFirma();
  else if (tip === 'tarla') openTarla();
  else if (tip === 'kisi') openKisi();
}
window.handleSelectNew = handleSelectNew;

function updateForm() {
  const tur = document.querySelector('input[name="h-tur"]:checked').value;
  const kalemSel = $('f-kalem');
  const kalemler = state.kalemler[tur] || [];
  kalemSel.innerHTML = kalemler.map(k => `<option value="${k}">${escapeHtml(k)}</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni kalem ekle…</option>`;

  // Alan görünürlüğü
  const isHammadde = tur === 'hammadde';
  const isHasat = tur === 'hasat';
  const isBorc = tur === 'borc';
  const isAvans = tur === 'nakit_avans';
  $('row-miktar').style.display = (isHammadde || isHasat) ? 'grid' : 'none';
  $('row-birimfiyat').style.display = isHammadde ? 'grid' : 'none';
  $('field-tutar').style.display = isHammadde ? 'none' : 'block';
  $('row-firma').style.display = (isAvans || tur === 'harcama' || isHammadde || isHasat) ? 'block' : 'none';
  $('row-tarla').style.display = (tur === 'harcama' || isHammadde || isHasat) ? 'block' : 'none';
  $('row-kisi').style.display = (tur !== 'nakit_avans') ? 'block' : 'none';
  $('row-kaynak').style.display = (tur === 'harcama' || isHammadde) ? 'block' : 'none';
  if (isHammadde) updateHammaddeToplam();
}
window.updateForm = updateForm;

// Hammadde: miktar × birim fiyat = tutar (otomatik hesap)
function updateHammaddeToplam() {
  const tur = document.querySelector('input[name="h-tur"]:checked')?.value;
  if (tur !== 'hammadde') return;
  const miktar = parseFloat($('f-miktar').value) || 0;
  const fiyat = parseFloat($('f-birim-fiyat').value) || 0;
  const toplam = miktar * fiyat;
  $('f-tutar').value = toplam ? toplam.toFixed(2) : '';
  $('f-toplam-goster').textContent = _tl(toplam);
}
window.updateHammaddeToplam = updateHammaddeToplam;

// Yeni kalem ekleme (Diğer dışı, kalıcı)
async function handleKalemNew(el) {
  if (el.value !== NEW_TOKEN) return;
  const tur = document.querySelector('input[name="h-tur"]:checked').value;
  const ad = (prompt(`Yeni "${TUR_AD[tur]}" kalemi adı:`) || '').trim();
  if (!ad) { el.value = state.kalemler[tur]?.[0] || ''; return; }
  if (!state.kalemler[tur]) state.kalemler[tur] = [];
  if (!state.kalemler[tur].includes(ad)) {
    state.kalemler[tur].push(ad);
    await persist(KEYS.kalemler);
  }
  // formu yenile, yeni kalemi seç
  const sel = $('f-kalem');
  sel.innerHTML = state.kalemler[tur].map(k => `<option value="${k}">${escapeHtml(k)}</option>`).join('') + `<option value="${NEW_TOKEN}">＋ Yeni kalem ekle…</option>`;
  sel.value = ad;
  toast('Kalem eklendi: ' + ad);
}
window.handleKalemNew = handleKalemNew;

function duzenleHareket(id) {
  const h = state.hareketler.find(x => x.id === id);
  if (!h) return;
  closeDetay();
  state.edit.hareket = id;
  $('hareket-title').textContent = 'Hareketi Düzenle';
  $('btn-sil-h').style.display = 'inline-flex';
  populateSelects();
  document.querySelector(`input[name="h-tur"][value="${h.tur}"]`).checked = true;
  $('f-kalem').value = h.kalem || '';
  $('f-tutar').value = h.tutar || '';
  $('f-tarih').value = h.tarih || today();
  $('f-miktar').value = h.miktar || '';
  $('f-birim').value = h.birim || 'kg';
  $('f-birim-fiyat').value = h.birim_fiyat || (h.miktar ? +(h.tutar / h.miktar).toFixed(2) : '');
  $('f-firma').value = h.firma_id || '';
  $('f-tarla').value = h.tarla_id || '';
  $('f-kisi').value = h.kisi_id || '';
  $('f-kaynak').value = h.kaynak || 'cep';
  $('f-aciklama').value = h.aciklama || '';
  updateForm();
  $('overlay-hareket').classList.add('open');
}
window.duzenleHareket = duzenleHareket;

async function kaydetHareket() {
  const tur = document.querySelector('input[name="h-tur"]:checked').value;
  const kalem = $('f-kalem').value;
  const tutar = parseFloat($('f-tutar').value) || 0;
  const tarih = $('f-tarih').value || today();
  if (!kalem) { toast('Kalem seç'); return; }
  // Tutar doğrulaması: 0/negatif kayıt engellenir. İstisna: sadece miktar girilen
  // hasat (stok/depoya giriş) tutarsız kaydedilebilir.
  const _miktarVar = (parseFloat($('f-miktar').value) || 0) > 0;
  if (tutar <= 0 && !(tur === 'hasat' && _miktarVar)) { toast('Geçerli bir tutar girin'); return; }
  // Firma malı (ayni) ise hangi firmadan geldiği belli olmalı
  if ($('f-kaynak').value === 'firma' && !$('f-firma').value) { toast('Firma malı için firma seçin'); return; }

  const yon = TUR_YON[tur];
  const data = {
    id: state.edit.hareket || Date.now(),
    tur, yon, kalem,
    sezon: state.sezon,
    tarih,
    tutar,
    aciklama: $('f-aciklama').value || '',
    firma_id: $('f-firma').value || '',
    tarla_id: $('f-tarla').value || '',
    kisi_id: $('f-kisi').value || '',
    kaynak: $('f-kaynak').value || 'cep',
    olusturma: new Date().toISOString()
  };
  // Hasat ve hammadde miktar/birim taşır; tutar=miktar×fiyat override'ı yalnızca hammaddede.
  if (tur === 'hammadde' || tur === 'hasat') {
    data.miktar = parseFloat($('f-miktar').value) || 0;
    data.birim = $('f-birim').value || 'kg';
  }
  if (tur === 'hammadde') {
    data.birim_fiyat = parseFloat($('f-birim-fiyat').value) || 0;
    data.tutar = +(data.miktar * data.birim_fiyat).toFixed(2);
  }

  if (state.edit.hareket) {
    state.hareketler = state.hareketler.map(h => h.id === state.edit.hareket ? { ...h, ...data } : h);
    toast('Güncellendi');
  } else {
    state.hareketler.push(data);
    toast('Eklendi');
  }
  await persist(KEYS.hareketler);
  closeHareket();
  render();
}
window.kaydetHareket = kaydetHareket;

async function silHareket() {
  if (!confirm('Bu hareketi silmek istiyor musun?')) return;
  state.hareketler = state.hareketler.filter(h => h.id !== state.edit.hareket);
  await persist(KEYS.hareketler);
  closeHareket();
  render();
  toast('Silindi');
}
window.silHareket = silHareket;

// ============ TARLA MODAL ============
function openTarla() {
  state.edit.tarla = null;
  $('tarla-title').textContent = 'Yeni Tarla';
  $('btn-sil-t').style.display = 'none';
  ['t-ad', 't-urun', 't-dekar', 't-sahip'].forEach(i => $(i).value = '');
  $('t-modul').value = 'sahsi';
  populateSelects();
  $('t-firma').value = '';
  $('overlay-tarla').classList.add('open');
}
window.openTarla = openTarla;
window.closeTarla = () => $('overlay-tarla').classList.remove('open');

function duzenleTarla(id) {
  const t = state.tarlalar.find(x => x.id === id);
  if (!t) return;
  state.edit.tarla = id;
  $('tarla-title').textContent = 'Tarla Düzenle';
  $('btn-sil-t').style.display = 'inline-flex';
  $('t-ad').value = t.ad || '';
  $('t-urun').value = t.urun || '';
  $('t-dekar').value = t.dekar || '';
  $('t-sahip').value = t.sahip || '';
  $('t-modul').value = t.modul || 'sahsi';
  populateSelects();
  $('t-firma').value = t.firma_id || '';
  $('overlay-tarla').classList.add('open');
}
window.duzenleTarla = duzenleTarla;

async function kaydetTarla() {
  const ad = $('t-ad').value.trim();
  if (!ad) { toast('Tarla adı gerekli'); return; }
  const data = {
    id: state.edit.tarla || uid('tarla'),
    ad,
    urun: $('t-urun').value || '',
    dekar: parseFloat($('t-dekar').value) || 0,
    sahip: $('t-sahip').value || '',
    modul: $('t-modul').value || 'sahsi',
    firma_id: $('t-firma').value || '',
    sezon: state.sezon
  };
  if (state.edit.tarla) {
    state.tarlalar = state.tarlalar.map(t => t.id === state.edit.tarla ? { ...t, ...data } : t);
    toast('Güncellendi');
  } else {
    state.tarlalar.push(data);
    toast('Eklendi');
  }
  await persist(KEYS.tarlalar);
  closeTarla();
  render();
}
window.kaydetTarla = kaydetTarla;

async function silTarla() {
  const bagli = state.hareketler.filter(h => h.tarla_id === state.edit.tarla).length;
  const uyari = bagli ? `Bu tarlaya bağlı ${bagli} hareket kaydı var; silinince bu kayıtların tarla bilgisi boş kalır. ` : '';
  if (!confirm(uyari + 'Bu tarlayı silmek istiyor musun?')) return;
  state.tarlalar = state.tarlalar.filter(t => t.id !== state.edit.tarla);
  await persist(KEYS.tarlalar);
  closeTarla();
  render();
  toast('Silindi');
}
window.silTarla = silTarla;

// ============ FIRMA MODAL ============
function openFirma() {
  state.edit.firma = null;
  $('firma-title').textContent = 'Yeni Firma';
  $('btn-sil-f').style.display = 'none';
  $('fi-ad').value = '';
  $('fi-urun').value = '';
  $('overlay-firma').classList.add('open');
}
window.openFirma = openFirma;
window.closeFirma = () => $('overlay-firma').classList.remove('open');

function duzenleFirma(id) {
  const f = state.firmalar.find(x => x.id === id);
  if (!f) return;
  state.edit.firma = id;
  $('firma-title').textContent = 'Firma Düzenle';
  $('btn-sil-f').style.display = 'inline-flex';
  $('fi-ad').value = f.ad || '';
  $('fi-urun').value = f.urun || '';
  $('overlay-firma').classList.add('open');
}
window.duzenleFirma = duzenleFirma;

async function kaydetFirma() {
  const ad = $('fi-ad').value.trim();
  if (!ad) { toast('Firma adı gerekli'); return; }
  const data = { id: state.edit.firma || uid('firma'), ad, urun: $('fi-urun').value || '', aktif: true };
  if (state.edit.firma) {
    state.firmalar = state.firmalar.map(f => f.id === state.edit.firma ? { ...f, ...data } : f);
    toast('Güncellendi');
  } else {
    state.firmalar.push(data);
    toast('Eklendi');
  }
  await persist(KEYS.firmalar);
  closeFirma();
  render();
}
window.kaydetFirma = kaydetFirma;

async function silFirma() {
  const bagli = state.hareketler.filter(h => h.firma_id === state.edit.firma).length;
  const uyari = bagli ? `Bu firmaya bağlı ${bagli} hareket kaydı var; silinince bu kayıtların firma bilgisi boş kalır. ` : '';
  if (!confirm(uyari + 'Bu firmayı silmek istiyor musun?')) return;
  state.firmalar = state.firmalar.filter(f => f.id !== state.edit.firma);
  await persist(KEYS.firmalar);
  closeFirma();
  render();
  toast('Silindi');
}
window.silFirma = silFirma;

// ============ KISI MODAL ============
function openKisi() {
  state.edit.kisi = null;
  $('kisi-title').textContent = 'Yeni Kişi';
  $('btn-sil-k').style.display = 'none';
  ['ki-ad', 'ki-tel', 'ki-not'].forEach(i => $(i).value = '');
  $('ki-tur').value = 'hizmet';
  $('overlay-kisi').classList.add('open');
}
window.openKisi = openKisi;
window.closeKisi = () => $('overlay-kisi').classList.remove('open');

function duzenleKisi(id) {
  const k = state.kisiler.find(x => x.id === id);
  if (!k) return;
  state.edit.kisi = id;
  $('kisi-title').textContent = 'Kişi Düzenle';
  $('btn-sil-k').style.display = 'inline-flex';
  $('ki-ad').value = k.ad || '';
  $('ki-tur').value = k.tur || 'hizmet';
  $('ki-tel').value = k.telefon || '';
  $('ki-not').value = k.not || '';
  $('overlay-kisi').classList.add('open');
}
window.duzenleKisi = duzenleKisi;

async function kaydetKisi() {
  const ad = $('ki-ad').value.trim();
  if (!ad) { toast('İsim gerekli'); return; }
  const data = {
    id: state.edit.kisi || uid('kisi'),
    ad,
    tur: $('ki-tur').value || 'hizmet',
    telefon: $('ki-tel').value || '',
    not: $('ki-not').value || '',
    aktif: true
  };
  if (state.edit.kisi) {
    state.kisiler = state.kisiler.map(k => k.id === state.edit.kisi ? { ...k, ...data } : k);
    toast('Güncellendi');
  } else {
    state.kisiler.push(data);
    toast('Eklendi');
  }
  await persist(KEYS.kisiler);
  closeKisi();
  render();
}
window.kaydetKisi = kaydetKisi;

async function silKisi() {
  const bagli = state.hareketler.filter(h => h.kisi_id === state.edit.kisi).length;
  const uyari = bagli ? `Bu kişiye bağlı ${bagli} hareket kaydı var; silinince bu kayıtların kişi bilgisi boş kalır. ` : '';
  if (!confirm(uyari + 'Bu kişiyi silmek istiyor musun?')) return;
  state.kisiler = state.kisiler.filter(k => k.id !== state.edit.kisi);
  await persist(KEYS.kisiler);
  closeKisi();
  render();
  toast('Silindi');
}
window.silKisi = silKisi;

// ============ EXPORT/IMPORT ============
function exportJSON() {
  let _sezonlar = [];
  try { _sezonlar = JSON.parse(localStorage.getItem('bt_sezonlar') || '[]'); } catch {}
  const out = {
    bt_firmalar: state.firmalar,
    bt_tarlalar: state.tarlalar,
    bt_kisiler: state.kisiler,
    bt_hareketler: state.hareketler,
    bt_kalemler: state.kalemler,          // kullanıcının özel kalemleri de yedekte
    bt_sezonlar: _sezonlar,               // eklenen sezonlar da yedekte
    _meta: { sezon: state.sezon, tarih: new Date().toISOString() }
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bedlek-yedek-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Yedek indirildi');
}
window.exportJSON = exportJSON;

// Google Drive'a otomatik yedek gönder (günde 1 kez; zorla=true ile elle).
// Apps Script CORS başlığı döndürmediği için no-cors + text/plain kullanılır
// (Apps Script tarafı e.postData.contents'i JSON.parse eder).
async function driveYedekle(zorla) {
  if (!DRIVE_YEDEK_URL) return;
  const son = parseInt(localStorage.getItem('bt_son_drive_yedek') || '0', 10);
  const birGun = 24 * 60 * 60 * 1000;
  if (!zorla && (Date.now() - son) < birGun) return;   // günde en fazla 1 otomatik yedek
  if (zorla) toast('Drive yedeği gönderiliyor…');
  try {
    let sezonlar = [];
    try { sezonlar = JSON.parse(localStorage.getItem('bt_sezonlar') || '[]'); } catch {}
    const payload = {
      _gizli: DRIVE_GIZLI,
      bt_firmalar: state.firmalar, bt_tarlalar: state.tarlalar,
      bt_kisiler: state.kisiler, bt_hareketler: state.hareketler,
      bt_kalemler: state.kalemler, bt_sezonlar: sezonlar,
      _meta: { sezon: state.sezon, tarih: new Date().toISOString() }
    };
    await fetch(DRIVE_YEDEK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    localStorage.setItem('bt_son_drive_yedek', String(Date.now()));
    if (zorla) toast('✓ Drive yedeği gönderildi');
    console.log('Drive yedek gönderildi');
  } catch (e) {
    console.warn('Drive yedek hata', e);
    if (zorla) toast('⚠ Drive yedeği gönderilemedi');
  }
}
window.driveYedekle = driveYedekle;

// Raporu yazdır / PDF olarak kaydet (tarayıcı yazdır → "PDF olarak kaydet")
function yazdirRapor() {
  goView('raporlar');
  setTimeout(() => window.print(), 250);
}
window.yazdirRapor = yazdirRapor;

// Önbelleği güvenle temizle: senkronlanmamış veri varsa engelle, yoksa önce yedek indir
function onbellekTemizle() {
  if (bekleyenSayisi() > 0) {
    toast('⚠ Buluta gönderilmemiş değişiklik var — önce internete bağlanın, sonra tekrar deneyin.');
    return;
  }
  if (!confirm('Yerel önbellek silinecek (bulut verisi korunur). Güvenlik için önce YEDEK İNDİRİLECEK. Devam?')) return;
  try { exportJSON(); } catch (e) {}
  // Yedek indirmesinin başlamasına fırsat ver, sonra temizle + yeniden yükle (bulut'tan gelir)
  setTimeout(() => { localStorage.clear(); location.reload(); }, 700);
}
window.onbellekTemizle = onbellekTemizle;

function importJSON(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async e => {
    try {
      const d = JSON.parse(e.target.result);
      if (!confirm('Mevcut veriler üzerine yazılacak. Devam?')) return;
      if (Array.isArray(d.bt_firmalar)) state.firmalar = d.bt_firmalar;
      if (Array.isArray(d.bt_tarlalar)) state.tarlalar = d.bt_tarlalar;
      if (Array.isArray(d.bt_kisiler)) state.kisiler = d.bt_kisiler;
      if (Array.isArray(d.bt_hareketler)) state.hareketler = d.bt_hareketler;
      if (d.bt_kalemler && typeof d.bt_kalemler === 'object') state.kalemler = mergeKalemler(d.bt_kalemler);
      if (Array.isArray(d.bt_sezonlar)) localStorage.setItem('bt_sezonlar', JSON.stringify(d.bt_sezonlar.map(String)));
      await Promise.all([persist(KEYS.firmalar), persist(KEYS.tarlalar), persist(KEYS.kisiler), persist(KEYS.hareketler), persist(KEYS.kalemler)]);
      renderSezonSelect();
      render();
      toast('Yüklendi');
    } catch (err) {
      toast('Dosya hatalı: ' + err.message);
    }
  };
  r.readAsText(f);
}
window.importJSON = importJSON;

function setSezon(s) {
  state.sezon = s;
  localStorage.setItem('bt_aktif_sezon', s);
  renderSezonSelect();
  render();
  toast('Sezon: ' + s);
}
window.setSezon = setSezon;

function getSezonlar() {
  // Mevcut hareketlerde olan + state.sezon + son 5 yıl
  const s = new Set();
  state.hareketler.forEach(h => { if (h.sezon) s.add(String(h.sezon)); });
  s.add(state.sezon);
  const yil = new Date().getFullYear();
  for (let y = yil - 2; y <= yil + 3; y++) s.add(String(y));
  // localStorage'a kullanıcı sezonları
  try {
    const ek = JSON.parse(localStorage.getItem('bt_sezonlar') || '[]');
    ek.forEach(y => s.add(String(y)));
  } catch {}
  return Array.from(s).sort();
}

function renderSezonSelect() {
  const sel = $('ayar-sezon');
  if (!sel) return;
  const sezonlar = getSezonlar();
  sel.innerHTML = sezonlar.map(y => `<option value="${y}" ${y === state.sezon ? 'selected' : ''}>${y}</option>`).join('');
}

function yeniSezonEkle() {
  const v = ($('yeni-sezon').value || '').trim();
  if (!v) { toast('Yıl gir'); return; }
  const y = String(parseInt(v));
  let ek = [];
  try { ek = JSON.parse(localStorage.getItem('bt_sezonlar') || '[]'); } catch {}
  if (!ek.includes(y)) ek.push(y);
  localStorage.setItem('bt_sezonlar', JSON.stringify(ek));
  supaSet('bt_sezonlar', ek);            // buluta da yaz (telefon değişince kaybolmasın)
  $('yeni-sezon').value = '';
  setSezon(y);
  renderKalemYonet();
  toast('Sezon eklendi: ' + y);
}
window.yeniSezonEkle = yeniSezonEkle;

// ============ KALEM YÖNETİMİ ============
function renderKalemYonet() {
  const el = $('kalem-yonet');
  if (!el) return;
  el.innerHTML = Object.keys(VARSAYILAN_KALEMLER).map(tur => {
    const kalemler = state.kalemler[tur] || [];
    return `
      <div style="margin-bottom:14px;padding:12px;background:var(--paper-2);border-radius:var(--r-sm);border:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong style="font-size:13px">${TUR_AD[tur]}</strong>
          <span style="font-size:11px;color:var(--muted)">${kalemler.length} kalem</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${kalemler.map(k => `
            <span style="display:inline-flex;align-items:center;gap:6px;background:var(--paper);padding:5px 8px 5px 11px;border-radius:99px;font-size:12px;border:1px solid var(--line)">
              ${escapeHtml(k)}
              <button onclick="kalemSil('${tur}','${escapeHtml(k).replace(/'/g, "\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;padding:0 2px;line-height:1" title="Sil">×</button>
            </span>
          `).join('')}
        </div>
        <div style="display:flex;gap:6px">
          <input class="input" id="yk-${tur}" placeholder="Yeni kalem..." style="flex:1;padding:7px 10px;font-size:12px">
          <button class="btn btn-ghost btn-sm" onclick="kalemEkle('${tur}')">+ Ekle</button>
        </div>
      </div>`;
  }).join('');
}

async function kalemEkle(tur) {
  const inp = $('yk-' + tur);
  const ad = (inp.value || '').trim();
  if (!ad) return;
  if (!state.kalemler[tur]) state.kalemler[tur] = [];
  if (state.kalemler[tur].includes(ad)) { toast('Zaten var'); return; }
  state.kalemler[tur].push(ad);
  await persist(KEYS.kalemler);
  inp.value = '';
  renderKalemYonet();
  toast('Eklendi');
}
window.kalemEkle = kalemEkle;

async function kalemSil(tur, ad) {
  if (!state.kalemler[tur]) return;
  if (!confirm(`"${ad}" kalemini sil?`)) return;
  state.kalemler[tur] = state.kalemler[tur].filter(k => k !== ad);
  await persist(KEYS.kalemler);
  renderKalemYonet();
  toast('Silindi');
}
window.kalemSil = kalemSil;

async function kalemVarsayilanlara() {
  if (!confirm('Tüm kalem listesi varsayılana dönecek. Eklediklerin silinir. Devam?')) return;
  state.kalemler = JSON.parse(JSON.stringify(VARSAYILAN_KALEMLER));
  await persist(KEYS.kalemler);
  renderKalemYonet();
  toast('Sıfırlandı');
}
window.kalemVarsayilanlara = kalemVarsayilanlara;

// ============ INIT ============
document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => goView(el.dataset.view));
});
document.querySelectorAll('.mob-tab[data-view]').forEach(el => {
  el.addEventListener('click', () => goView(el.dataset.view));
});
renderSezonSelect();
loadAll();
