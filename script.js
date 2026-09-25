/* Fix Leaflet's default marker image paths (not used since we use divIcons, but harmless safeguard) */
if(typeof L !== 'undefined'){ delete L.Icon.Default.prototype._getIconUrl; }
/* =========================================================
   MOCK DATA — customer / delivery details
========================================================= */
const AVATAR_COLORS = ['#4CAF6D','#2F7FE0','#E8A400','#E0503C','#8A6FD1','#3C9257'];
function colorFor(i){ return AVATAR_COLORS[i % AVATAR_COLORS.length]; }
function initials(name){ return name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(); }

/* Orders are now loaded from the real backend (see loadOrdersFromServer()
   below) via the shared Api client (api.js) - same backend miLKadmin and
   milkwebapp use. This starts empty and is populated on login/boot. */
let orders = [];
// The logged-in rider's own DeliveryBoy record, cached from the deliveryLogin/
// deliveryRegister/Api.me() response. Needed for Api.uploadMyImage(driverId, ...)
// since the backend has no "/me/image" route - only "/:id/image".
let currentDriver = null;

/* Maps a raw backend order (see milkwebapp/js/api.js ordersApi / ordersApi
   payload shape) into the shape this UI's render functions expect. Backend
   field names are best-effort mapped; unknown/missing fields fall back to
   sane defaults so the UI doesn't crash on partial data. */
function mapServerOrder(o){
  const addr = o.address || o.deliveryAddress || (o.addressObj && o.addressObj.line1) || '';
  const lat = (o.lat ?? o.location?.lat ?? o.deliveryLat ?? FALLBACK_RIDER_LOC.lat);
  const lng = (o.lng ?? o.location?.lng ?? o.deliveryLng ?? FALLBACK_RIDER_LOC.lng);
  const statusMap = { placed:'pending', offered:'pending', accepted:'ongoing', picked_up:'ongoing', on_the_way:'ongoing', delivered:'delivered', completed:'delivered' };
  const rawStatus = (o.status || 'placed').toLowerCase();
  const status = statusMap[rawStatus] || (rawStatus === 'delivered' ? 'delivered' : rawStatus === 'ongoing' ? 'ongoing' : 'pending');
  const stepMap = { pending:0, ongoing: (rawStatus==='picked_up'||rawStatus==='on_the_way') ? 2 : 1, delivered:3 };
  return {
    id: o.orderCode || o._id,
    _id: o._id,
    name: (o.user && (o.user.name || o.user.fullName)) || o.customerName || 'Customer',
    phone: (o.user && o.user.phone) || o.customerPhone || '',
    area: o.area || o.zone || '',
    addr,
    lat, lng,
    instr: o.deliveryInstructions || o.instr || '',
    items: (o.items || []).map(it => `${it.name || it.productName || 'Item'} x${it.qty || it.quantity || 1}`),
    amount: o.total || o.amount || 0,
    payment: (o.paymentMethod === 'cod' || o.payment === 'COD') ? 'COD' : 'Prepaid',
    distanceKm: o.distanceKm || 0,
    eta: o.eta || '—',
    status,
    step: stepMap[status] ?? 0,
    zone: o.zone || o.area || '',
    proof: o.proof || null,
    // Bottle-exchange subscription stops need the dual-photo Api.completeBottleExchange
    // flow instead of the plain Api.updateOrderStatus used for one-off product orders
    // (see Order model: isSubscriptionDelivery + subscription ref).
    isSubscriptionDelivery: !!o.isSubscriptionDelivery,
    subscriptionId: (o.subscription && o.subscription._id) || o.subscription || null
  };
}

/* Pulls this partner's current order list from the server and re-renders.
   Called on boot, after login, and after any accept/reject/status change
   so the UI always reflects the backend, not local optimistic state. */
async function loadOrdersFromServer(){
  try{
    const res = await Api.listMyOrders();
    const list = Array.isArray(res) ? res : (res.orders || res.data || []);
    orders = list.map(mapServerOrder);
  }catch(e){
    if(handleAuthError(e)) return;
    console.warn('[orders] failed to load from server:', e.message);
    showToast('Could not load deliveries — check your connection');
  }
  renderAll();
}
/* Fallback starting point (used only until real GPS lock is acquired) */
const FALLBACK_RIDER_LOC = { lat:17.4560, lng:78.3690 };
let riderLoc = null;      // { lat, lng, accuracy, heading, speed, ts } — set only from real GPS
let riderWatchId = null;
let riderLiveMap = null, riderLiveMarker = null, riderLiveAccCircle = null;

const STEP_LABELS = ['Accepted','Picked Up','On the Way','Delivered'];

/* =========================================================
   LIVE GPS TRACKING — real device location via Geolocation API
   Permission is asked once; if granted, tracking auto-resumes
   on every app open (browser remembers the grant). Uses
   watchPosition for continuous live updates (not a single fix).
========================================================= */
const GEO_STATE_KEY = 'pd_geo_permission_state'; // 'granted' | 'denied' | 'prompt'

function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function startLiveTracking(){
  if(!('geolocation' in navigator)){
    showToast('GPS not supported on this device/browser');
    return;
  }
  if(riderWatchId !== null) return; // already tracking
  riderWatchId = navigator.geolocation.watchPosition(
    (pos)=>{
      try{ localStorage.setItem(GEO_STATE_KEY, 'granted'); }catch(e){}
      riderLoc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        ts: Date.now()
      };
      onRiderLocationUpdate();
    },
    (err)=>{
      if(err.code === err.PERMISSION_DENIED){
        try{ localStorage.setItem(GEO_STATE_KEY, 'denied'); }catch(e){}
        setGpsStatusUI('denied');
        showToast('Location permission denied — enable it in browser settings to track live delivery location');
      } else {
        setGpsStatusUI('error');
      }
    },
    { enableHighAccuracy:true, maximumAge:2000, timeout:15000 }
  );
  setGpsStatusUI('locating');
}

function stopLiveTracking(){
  if(riderWatchId !== null){
    navigator.geolocation.clearWatch(riderWatchId);
    riderWatchId = null;
  }
}

function requestLiveTracking(){
  let state = null;
  try{ state = localStorage.getItem(GEO_STATE_KEY); }catch(e){}
  if(state === 'denied'){
    // Browsers won't re-show the permission prompt once denied — the
    // person has to flip it back on themselves in site settings.
    showToast('Location is off for this app — turn it on in your browser\'s site settings to enable live tracking');
    setGpsStatusUI('denied');
    return;
  }
  // Triggers the native one-time browser permission prompt.
  // Once granted, the browser remembers it — future app opens
  // auto-resume tracking without asking again.
  startLiveTracking();
}

/* Auto-resume tracking on load if permission was already granted before */
function autoResumeTrackingIfGranted(){
  let state = null;
  try{ state = localStorage.getItem(GEO_STATE_KEY); }catch(e){}
  if(state === 'granted'){
    startLiveTracking();
  } else if(navigator.permissions && navigator.permissions.query){
    navigator.permissions.query({name:'geolocation'}).then(res=>{
      if(res.state === 'granted') startLiveTracking();
      setGpsStatusUI(res.state === 'granted' ? 'live' : res.state);
      res.onchange = ()=>{
        if(res.state === 'granted') startLiveTracking();
        else stopLiveTracking();
        setGpsStatusUI(res.state);
      };
    }).catch(()=>{});
  }
}

function setGpsStatusUI(state){
  const dot = document.getElementById('gpsDot');
  const label = document.getElementById('gpsStatusLabel');
  if(!dot || !label) return;
  const map = {
    live:      { cls:'ok',   text:'Live location on' },
    locating:  { cls:'busy', text:'Locating…' },
    denied:    { cls:'off',  text:'Location off — tap to enable' },
    prompt:    { cls:'off',  text:'Location off — tap to enable' },
    error:     { cls:'off',  text:'GPS error — tap to retry' }
  };
  const s = map[state] || map.prompt;
  dot.className = 'gps-dot ' + s.cls;
  label.textContent = s.text;
}

/* Called on every real GPS fix */
let lastLocationPushTs = 0;
function onRiderLocationUpdate(){
  setGpsStatusUI('live');
  recalcLiveDistances();
  updateLiveMapIfOpen();
  pushLocationToServer();
}

/* Reports this partner's live location to the backend so admin/customer
   tracking (miLKadmin, milkwebapp) can show it in real time. Throttled to
   once every ~5s since GPS can fire multiple times a second. */
function pushLocationToServer(){
  if(!riderLoc) return;
  const now = Date.now();
  if(now - lastLocationPushTs < 5000) return;
  lastLocationPushTs = now;
  Api.updateLocation(riderLoc.lat, riderLoc.lng).catch((e)=>{
    if(handleAuthError(e)) return;
    console.warn('[location] push failed:', e.message);
  });
}

/* =========================================================
   REAL ROAD DISTANCE + ETA (OSRM — free, no API key)
   Falls back to straight-line haversine if OSRM is unreachable.
========================================================= */
const routeCache = new Map(); // "lat1,lng1|lat2,lng2" -> {km, mins}
async function getRoadRoute(fromLat, fromLng, toLat, toLng){
  const key = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}|${toLat.toFixed(4)},${toLng.toFixed(4)}`;
  if(routeCache.has(key)) return routeCache.get(key);
  try{
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if(data.routes && data.routes[0]){
      const r = {
        km: data.routes[0].distance/1000,
        mins: Math.round(data.routes[0].duration/60),
        geometry: data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]])
      };
      routeCache.set(key, r);
      return r;
    }
  }catch(e){ /* offline or blocked — fall back below */ }
  const km = haversineKm(fromLat, fromLng, toLat, toLng);
  const r = { km, mins: Math.round((km/28)*60), geometry: null }; // ~28km/h avg city fallback
  routeCache.set(key, r);
  return r;
}

/* Recompute every order's live distance/ETA from the rider's real GPS fix.
   IMPORTANT: this runs on every GPS tick (every couple seconds while
   moving), so it must NEVER call renderAll()/innerHTML — that would
   rebuild every card and look like a page reload. It only patches the
   specific distance/ETA text nodes in place via patchLiveNumbers(). */
let recalcInFlight = false;
async function recalcLiveDistances(){
  if(!riderLoc || recalcInFlight) return;
  recalcInFlight = true;
  const from = riderLoc;
  await Promise.all(orders.filter(o=>o.status!=='delivered').map(async (o)=>{
    const r = await getRoadRoute(from.lat, from.lng, o.lat, o.lng);
    o.distanceKm = r.km;
    o.eta = r.mins <= 1 ? '1 min' : r.mins + ' min';
    o._route = r.geometry;
  }));
  recalcInFlight = false;
  patchLiveNumbers();
}

/* =========================================================
   LIVE IN-PLACE CARD PATCHING (no re-render, no flicker)
   Updates only the text of elements tagged data-live="dist"/"eta"
   for the matching order id — the surrounding card DOM, its
   animations, scroll position, and any open state are untouched.
   A full renderAll() (rebuild) only ever happens on real structural
   changes: accept/complete/status change, filter switch, screen nav.
========================================================= */
function patchText(el, text){
  if(el && el.textContent !== text) el.textContent = text;
}
function patchLiveNumbers(){
  orders.forEach(o=>{
    if(o.status==='delivered') return;
    document.querySelectorAll(`[data-live="dist"][data-order-id="${o.id}"]`).forEach(el=>{
      patchText(el, distanceLabel(o.distanceKm));
    });
    document.querySelectorAll(`[data-live="eta"][data-order-id="${o.id}"]`).forEach(el=>{
      patchText(el, el.classList.contains('hero-eta') ? 'ETA ' + o.eta : o.eta);
    });
  });
  // Route banner "sorted nearest first" sub-line
  const banner = document.getElementById('routeBanner');
  if(banner && banner.style.display !== 'none'){
    const queue = sortedPendingQueue();
    if(queue.length){
      const sub = banner.querySelector('.rsub');
      patchText(sub, `Sorted nearest first — starting with ${queue[0].name} (${distanceLabel(queue[0].distanceKm)})`);
    }
  }
  // Open detail sheet map badge, if that order is currently shown
  const badge = document.getElementById('detailMapBadge');
  if(badge && detailMapInstance && detailMapInstance._orderRef){
    const o = detailMapInstance._orderRef;
    patchText(badge, distanceLabel(o.distanceKm) + ' · ' + o.eta);
  }
}

/* =========================================================
   NEAREST-FIRST ROUTE SEQUENCING (within this rider's zone)
   Orders auto-sort by distance so the closest stop is always
   shown first — mirrors the equal-split zone clustering set
   by the admin panel for the day.
========================================================= */
function distanceLabel(km){ return km.toFixed(1) + ' km'; }
function sortedPendingQueue(){
  return orders.filter(o=>o.status==='pending').sort((a,b)=>a.distanceKm-b.distanceKm);
}

/* =========================================================
   NAV / SCREEN SWITCHING
========================================================= */
function goToScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.querySelectorAll('.nav-item[data-screen]').forEach(n=>{
    n.classList.toggle('active', n.dataset.screen === name);
  });
}
document.querySelectorAll('.nav-item[data-screen]').forEach(item=>{
  item.addEventListener('click', ()=> goToScreen(item.dataset.screen));
});
document.querySelectorAll('[data-goto]').forEach(el=>{
  el.addEventListener('click', ()=> goToScreen(el.dataset.goto));
});
document.getElementById('navFab').addEventListener('click', ()=>{
  const active = orders.find(o=>o.status==='ongoing');
  if(active){
    openDetail(active.id);
  } else {
    goToScreen('deliveries');
    showToast('No active delivery right now');
  }
});

/* =========================================================
   SUBSCRIPTION ENGINE
   ---------------------------------------------------------
   Rule: every plan (500ml/day or 1L/day, same logic for both)
   has a fixed cycle total = dailyQty × cycle length. A skipped
   day's milk is never lost and never duplicated — it is banked
   in full and delivered in one shot, added completely on top
   of the very next day the customer actually receives milk.
   Cycle start/end dates are fixed and marked on the calendar,
   so the total delivered across the cycle always reconciles to
   the exact ml the customer paid for — down to the last ml.
========================================================= */
function isoDate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function todayMidnight(){
  const t = new Date(); t.setHours(0,0,0,0); return t;
}
const SUB_TODAY = todayMidnight();

// Real subscriptions for this rider's route, loaded from the backend (see
// loadSubscriptionsFromServer). Replaces the old hardcoded demo array.
let subscriptions = [];
let currentSubId = null;

/* Maps a raw backend Subscription (see Subscription model) into the shape
   this screen's render functions expect. The backend only tracks
   skippedDates (customer-set) + todayStatus/pendingBottles/bottlesGivenToday
   (rider-set via log-delivery) - there's no day-by-day "banked ml" ledger
   server-side, so the schedule below is built from those real fields
   instead of the old client-only banking simulation. */
function mapServerSubscription(s){
  const planMl = (s.plan && (s.plan.quantityMl || s.plan.qtyMl || s.plan.ml)) || s.customPlanMl || 500;
  const start = s.startDate ? new Date(s.startDate) : SUB_TODAY;
  return {
    id: s._id,
    name: (s.customer && (s.customer.name || s.customer.fullName)) || s.customerName || 'Customer',
    planMl,
    start,
    active: s.active !== false,
    skippedDates: new Set(s.skippedDates || []),
    todayStatus: s.todayStatus || 'pending',
    pendingBottles: s.pendingBottles || 0,
    deliveryBoy: (s.deliveryBoy && s.deliveryBoy._id) || s.deliveryBoy || null
  };
}

/* Pulls the subscriptions assigned to this rider's route. The backend has
   no rider-specific filter on GET /subscriptions yet (see api.js), so this
   filters client-side to subs whose deliveryBoy matches the logged-in
   rider (falling back to an empty list rather than showing every
   customer's subscription in the system if that filter can't be applied). */
async function loadSubscriptionsFromServer(){
  try{
    const res = await Api.listSubscriptions();
    const list = Array.isArray(res) ? res : (res.subscriptions || res.data || []);
    const myId = currentDriver && (currentDriver._id || currentDriver.id);
    const mine = myId ? list.filter(s => String((s.deliveryBoy && s.deliveryBoy._id) || s.deliveryBoy || '') === String(myId)) : [];
    subscriptions = mine.map(mapServerSubscription);
    if(!subscriptions.find(s=>s.id===currentSubId)){
      currentSubId = subscriptions.length ? subscriptions[0].id : null;
    }
  }catch(e){
    if(handleAuthError(e)) return;
    console.warn('[subscriptions] failed to load from server:', e.message);
    subscriptions = [];
    currentSubId = null;
  }
  renderSubscriptions();
}

/* Simple week-at-a-glance schedule built from real fields only: today's
   status (delivered/issue/pending) and the customer's own skipped dates.
   Unlike the old demo, this makes no claim about days before the rider
   started serving this route, since the backend keeps no such history. */
function buildSchedule(sub){
  const todayIso = isoDate(SUB_TODAY);
  const days = [];
  for(let off=-6; off<=0; off++){
    const d = new Date(SUB_TODAY); d.setDate(d.getDate()+off);
    const iso = isoDate(d);
    let status;
    if(iso === todayIso){
      status = sub.todayStatus === 'delivered' ? 'delivered' : sub.todayStatus === 'issue' ? 'skipped' : 'pending';
    } else if(sub.skippedDates.has(iso)){
      status = 'skipped';
    } else {
      status = 'delivered';
    }
    days.push({ date:d, iso, status, isToday: iso===todayIso });
  }
  const deliveredDays = days.filter(d=>d.status==='delivered').length;
  const skippedDays = days.filter(d=>d.status==='skipped').length;
  return { days, deliveredDays, skippedDays, pendingBottles: sub.pendingBottles };
}

function renderSubscriptions(){
  const row = document.getElementById('subCustRow');
  if(!row) return;
  if(!subscriptions.length){
    row.innerHTML = '<div class="sub-empty" style="padding:16px; font-size:12.5px; color:var(--muted);">No customer subscriptions assigned to your route yet.</div>';
    ['subPlanQty','subDelivDays','subSkipDays','subHeroSub','subRingPct'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.textContent = id==='subRingPct' ? '0%' : '—';
    });
    const remainEl = document.getElementById('subRemainL'); if(remainEl) remainEl.textContent = '0.0';
    const grid = document.getElementById('subCalGrid'); if(grid) grid.innerHTML = '';
    const hint = document.getElementById('subHint'); if(hint) hint.textContent = '';
    const bankNote = document.getElementById('subBankNote'); if(bankNote) bankNote.style.display = 'none';
    return;
  }
  row.innerHTML = subscriptions.map(s=>
    `<div class="sub-chip ${s.id===currentSubId?'active':''}" onclick="selectSub('${s.id}')">${s.name}<span class="tag">${s.planMl>=1000 ? (s.planMl/1000)+'L' : s.planMl+'ml'}/day</span></div>`
  ).join('');

  const sub = subscriptions.find(s=>s.id===currentSubId) || subscriptions[0];
  const sched = buildSchedule(sub);

  document.getElementById('subPlanQty').textContent = (sub.planMl>=1000 ? (sub.planMl/1000)+' L' : sub.planMl+' ml') + ' / day';
  document.getElementById('subDelivDays').textContent = sched.deliveredDays;
  document.getElementById('subSkipDays').textContent = sched.skippedDays;
  document.getElementById('subHeroSub').textContent = 'last 7 days';

  countUpDecimal(document.getElementById('subRemainL'), (sub.planMl * sched.deliveredDays)/1000, 700);
  const pct = sched.days.length ? Math.round((sched.deliveredDays/sched.days.length)*100) : 0;
  const ring = document.getElementById('subRing');
  const circumference = 188.5;
  ring.style.strokeDashoffset = circumference - (circumference*pct/100);
  document.getElementById('subRingPct').textContent = pct+'%';

  const bankNote = document.getElementById('subBankNote');
  if(sched.pendingBottles > 0){
    bankNote.style.display = 'flex';
    bankNote.innerHTML = '⚡ ' + sched.pendingBottles + ' old bottle(s) still owed from a previous missed pickup.';
  } else {
    bankNote.style.display = 'none';
  }

  const grid = document.getElementById('subCalGrid');
  let html = '';
  sched.days.forEach(d=>{
    const cls = ['sub-day', d.status];
    if(d.isToday) cls.push('today');
    const click = d.isToday ? `onclick="toggleTodaySkip('${sub.id}')"` : '';
    html += `<div class="${cls.join(' ')}" ${click}>${d.date.getDate()}</div>`;
  });
  grid.innerHTML = html;

  const hint = document.getElementById('subHint');
  const todayDay = sched.days.find(d=>d.isToday);
  hint.textContent = todayDay
    ? (todayDay.status==='skipped' ? "Today is marked not-returned — tap to log today's exchange." : 'Tap today\'s cell to report the old bottle was not returned.')
    : '';
}

function selectSub(id){
  currentSubId = id;
  renderSubscriptions();
}

/* Reports that the customer didn't have the old bottle ready today - the
   real backend mechanism for this is logging a shortfall via log-delivery
   (see Api.reportBottleNotReturned), which is what bumps
   Subscription.pendingBottles server-side. Toggling back off re-logs a
   normal (non-shortfall) delivery for today. */
async function toggleTodaySkip(subId){
  const sub = subscriptions.find(s=>s.id===subId);
  if(!sub) return;
  const wasIssue = sub.todayStatus === 'issue';
  try{
    if(wasIssue){
      await Api.completeBottleExchange(subId, { quantityCollected: 1, shortfall: 0, bottlesGiven: 1 });
      showToast("Today's exchange logged as normal");
    } else {
      await Api.reportBottleNotReturned(subId, 1);
      showToast('Logged — old bottle not returned today');
    }
  }catch(e){
    if(handleAuthError(e)) return;
    showToast('Could not update — ' + e.message);
    return;
  }
  await loadSubscriptionsFromServer();
}

/* =========================================================
   SOUND CUES (WebAudio — no external files needed)
========================================================= */
let audioCtx;
function getAudioCtx(){
  if(!audioCtx){
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
  }
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq, start, dur, vol){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime+start);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime+start+0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+start+dur);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(ctx.currentTime+start);
  osc.stop(ctx.currentTime+start+dur+0.05);
}
function playChime(kind){
  if(kind==='delivered'){ beep(880,0,.14,.18); beep(1180,.12,.18,.18); }
  else if(kind==='next'){ beep(660,0,.1,.15); beep(880,.1,.1,.15); beep(1100,.2,.16,.16); }
  else if(kind==='incoming'){ beep(740,0,.12,.16); beep(740,.22,.12,.16); }
}

/* =========================================================
   TOAST
========================================================= */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

/* =========================================================
   COUNT-UP STATS
========================================================= */
function countUp(el, to, prefix='', suffix='', dur=900){
  const start = performance.now();
  function tick(now){
    const p = Math.min(1, (now-start)/dur);
    const eased = 1 - Math.pow(1-p, 3);
    const val = Math.round(to*eased);
    el.textContent = prefix + val.toLocaleString('en-IN') + suffix;
    if(p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function countUpDecimal(el, to, dur=700){
  const start = performance.now();
  function tick(now){
    const p = Math.min(1, (now-start)/dur);
    const eased = 1 - Math.pow(1-p, 3);
    el.textContent = (to*eased).toFixed(1);
    if(p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function refreshTopStats(){
  const delivered = orders.filter(o=>o.status==='delivered');
  countUp(document.getElementById('statCount'), orders.length);
  countUp(document.getElementById('statDeliveries'), delivered.length);
  const dist = delivered.length * 1.6;
  document.getElementById('statDist').textContent = dist.toFixed(1) + ' km';
}

/* =========================================================
   RENDER: HERO (active delivery)
========================================================= */
function renderHero(){
  const wrap = document.getElementById('heroWrap');
  const active = orders.find(o=>o.status==='ongoing');
  if(!active){
    wrap.innerHTML = `
      <div class="empty-state" style="padding:36px 20px;">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <div class="empty-title">No active delivery</div>
        <div class="empty-sub">Accept a delivery from the list below to get started.</div>
      </div>`;
    return;
  }
  const idx = orders.findIndex(o=>o.id===active.id);
  wrap.innerHTML = `
    <div class="hero-card">
      <div class="hero-inner">
        <div class="hero-top">
          <div class="hero-badge"><span class="liveDot"></span>ACTIVE DELIVERY &middot; ${active.id}</div>
          <div class="hero-eta" data-live="eta" data-order-id="${active.id}">ETA ${active.eta}</div>
        </div>
        <div class="cust-row">
          <div class="avatar" style="background:${colorFor(idx)}22; color:${colorFor(idx)};">${initials(active.name)}</div>
          <div class="cust-info">
            <div class="cust-name">${active.name}</div>
            <div class="cust-addr">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>${active.area} &middot; <span data-live="dist" data-order-id="${active.id}">${distanceLabel(active.distanceKm)}</span></span>
            </div>
          </div>
          <div class="cust-actions">
            <button class="round-btn call" onclick="event.stopPropagation(); callCustomer('${active.phone}')" aria-label="Call">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.65a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.43-1.27a2 2 0 0 1 2.11-.45c.86.31 1.75.53 2.65.65A2 2 0 0 1 22 16.92z"/></svg>
            </button>
            <button class="round-btn msg" onclick="event.stopPropagation(); showToast('Opening chat with ${active.name.split(' ')[0]}…')" aria-label="Message">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>
        </div>

        <div class="order-chip-row">
          ${active.items.map(it=>`<div class="order-chip">${it}</div>`).join('')}
          <div class="order-chip ${active.payment==='COD'?'pay-cod':'pay-paid'}">${active.payment==='COD' ? '₹'+active.amount+' COD' : 'Prepaid ₹'+active.amount}</div>
        </div>

        <div class="stepper">
          ${STEP_LABELS.map((lbl,i)=>`
            <div class="step ${i < active.step ? 'done' : i===active.step ? 'current' : ''}">
              <div class="bar"></div>
              <div class="dot">${i < active.step ? '✓' : i+1}</div>
              <div class="lbl">${lbl}</div>
            </div>`).join('')}
        </div>

        <div class="hero-btn-row">
          <button class="ghost-btn" onclick="openDetail('${active.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Details
          </button>
          <button class="ghost-btn" onclick="navigateTo('${active.id}')" style="flex:1; justify-content:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Navigate
          </button>
        </div>

        <div class="swipe-track" id="swipeTrack">
          <div class="swipe-fill" id="swipeFill"></div>
          <div class="swipe-label" id="swipeLabel">Slide to mark delivered</div>
          <div class="swipe-thumb" id="swipeThumb">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" style="transform:rotate(0deg);"/></svg>
          </div>
        </div>
      </div>
    </div>`;
  initSwipe(active.id);
}

/* =========================================================
   SWIPE TO COMPLETE
========================================================= */
function initSwipe(orderId){
  const track = document.getElementById('swipeTrack');
  const thumb = document.getElementById('swipeThumb');
  const fill = document.getElementById('swipeFill');
  const label = document.getElementById('swipeLabel');
  if(!track) return;
  let dragging = false, startX = 0, thumbStart = 0;
  const max = () => track.clientWidth - thumb.clientWidth - 6;

  function setPos(x){
    const clamped = Math.max(0, Math.min(max(), x));
    thumb.style.left = clamped + 3 + 'px';
    fill.style.width = (clamped + thumb.clientWidth) + 'px';
    return clamped;
  }
  function pointerDown(e){
    dragging = true; thumb.classList.remove('snapping');
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    thumbStart = parseFloat(thumb.style.left || 3);
    thumb.style.cursor = 'grabbing';
  }
  function pointerMove(e){
    if(!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    setPos(thumbStart + (x - startX));
  }
  function pointerUp(){
    if(!dragging) return;
    dragging = false; thumb.style.cursor = 'grab';
    thumb.classList.add('snapping');
    const cur = parseFloat(thumb.style.left || 3);
    if(cur >= max() * 0.82){
      setPos(max());
      track.classList.add('complete');
      label.textContent = 'Delivered ✓';
      setTimeout(()=> openProofOfDelivery(orderId), 350);
    } else {
      setPos(0);
    }
  }
  thumb.addEventListener('mousedown', pointerDown);
  thumb.addEventListener('touchstart', pointerDown, {passive:true});
  window.addEventListener('mousemove', pointerMove);
  window.addEventListener('touchmove', pointerMove, {passive:true});
  window.addEventListener('mouseup', pointerUp);
  window.addEventListener('touchend', pointerUp);
}

async function completeDelivery(orderId, proof){
  const o = orders.find(x=>x.id===orderId);
  if(!o) return;
  try{
    if(o.isSubscriptionDelivery && o.subscriptionId){
      // Bottle-exchange stop: send the actual captured photo file(s) to the
      // dedicated endpoint, not just a status flip. "New bottle given" reuses
      // the same proof photo as "old bottle collected" unless the app is
      // later extended to capture two distinct photos.
      const photoFile = proof && proof.type === 'photo' ? proof.file : null;
      await Api.completeBottleExchange(o.subscriptionId, {
        newBottlePhoto: photoFile,
        oldBottlePhoto: photoFile,
        quantityCollected: 1,
        shortfall: (!photoFile && proof && proof.type === 'remark') ? 1 : 0,
        bottlesGiven: 1,
        note: proof && proof.type === 'remark' ? proof.text : undefined
      });
    } else {
      await Api.updateOrderStatus(o._id || o.id, 'delivered');
    }
  }catch(e){
    if(handleAuthError(e)) return;
    showToast('Could not mark delivered — ' + e.message);
    return;
  }
  o.status = 'delivered';
  o.step = 3;
  o.proof = proof || null;
  const proofNote = proof && proof.type==='photo' ? ' Empty bottle photo uploaded.' : (proof && proof.type==='remark' ? ' Remark added (no bottle given).' : '');
  document.getElementById('successSub').textContent = `${o.name}'s order has been marked delivered. Payment: ${o.payment==='COD' ? '₹'+o.amount+' collected (COD)' : 'Already paid online'}.${proofNote}`;
  document.getElementById('successOverlay').classList.add('show');
  playChime('delivered');
  closeDetail();
  renderAll();
  autoOpenNextNearest();
}

/* =========================================================
   AUTO-ADVANCE TO NEXT NEAREST ORDER (no manual accept)
   These are monthly/weekly pre-paid subscription routes —
   the partner just works through the sorted queue, so the
   next nearest stop is auto-assigned right after a delivery.
========================================================= */
function autoOpenNextNearest(){
  setTimeout(()=>{
    const queue = sortedPendingQueue();
    if(queue.length === 0) return;
    const next = queue[0];
    next.status = 'ongoing';
    next.step = 1;
    renderAll();
    playChime('next');
    showToast('Next stop auto-assigned: ' + next.name.split(' ')[0] + ' (' + distanceLabel(next.distanceKm) + ')');
    openDetail(next.id);
  }, 900);
}

/* =========================================================
   PROOF OF DELIVERY (photo of empty bottles, or remark)
========================================================= */
let podOrderId = null;
let podPhotoData = null;
let podPhotoFile = null; // the real File/Blob — needed for Api.completeBottleExchange's FormData upload

function openProofOfDelivery(orderId){
  podOrderId = orderId;
  podPhotoData = null;
  podPhotoFile = null;
  document.getElementById('podPhotoBox').classList.remove('has-photo');
  document.getElementById('podPhotoBox').innerHTML = `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    <div class="pod-photo-label">Tap to capture empty bottle photo</div>
    <input type="file" accept="image/*" capture="environment" id="podFileInput" style="display:none;">`;
  bindPodFileInput();
  document.getElementById('podRemarkInput').value = '';
  document.getElementById('podBackdrop').classList.add('show');
}
function closeProofOfDelivery(){
  document.getElementById('podBackdrop').classList.remove('show');
  podOrderId = null;
}
function bindPodFileInput(){
  const box = document.getElementById('podPhotoBox');
  const input = document.getElementById('podFileInput');
  box.onclick = ()=> input.click();
  input.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    podPhotoFile = file; // keep the real File so it can be sent as multipart form data on confirm
    const reader = new FileReader();
    reader.onload = (ev)=>{
      podPhotoData = ev.target.result;
      box.classList.add('has-photo');
      // Not uploaded yet — that only happens once podConfirmBtn's click
      // handler successfully calls the API (see completeDelivery).
      box.innerHTML = `<div class="pod-photo-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>Captured</div><img src="${ev.target.result}" alt="Empty bottle proof">`;
      showToast('Photo captured');
    };
    reader.readAsDataURL(file);
  });
}
document.getElementById('podCancelBtn').addEventListener('click', closeProofOfDelivery);
document.getElementById('podBackdrop').addEventListener('click', (e)=>{
  if(e.target.id==='podBackdrop') closeProofOfDelivery();
});
document.getElementById('podConfirmBtn').addEventListener('click', async ()=>{
  const remark = document.getElementById('podRemarkInput').value.trim();
  if(!podPhotoData && !remark){
    showToast('Add a photo or a remark to continue');
    return;
  }
  const proof = podPhotoData
    ? {type:'photo', data:podPhotoData, file:podPhotoFile}
    : {type:'remark', text:remark};
  const orderId = podOrderId;
  const btn = document.getElementById('podConfirmBtn');
  const original = btn.textContent;
  btn.textContent = 'Uploading…';
  btn.disabled = true;
  try{
    await completeDelivery(orderId, proof);
    closeProofOfDelivery();
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});
document.getElementById('successDoneBtn').addEventListener('click', ()=>{
  document.getElementById('successOverlay').classList.remove('show');
  goToScreen('home');
});

/* =========================================================
   RENDER: UP NEXT (home) + DELIVERIES LIST
========================================================= */
function customerCardHTML(o, idx, queuePos){
  return `
    <div class="cust-card ${queuePos===1?'next-up':''}" onclick="openDetail('${o.id}')">
      <div class="cc-top">
        ${queuePos ? `<div class="route-order-num">${queuePos}</div>` : `<div class="cc-avatar" style="background:${colorFor(idx)};">${initials(o.name)}</div>`}
        <div class="cc-info">
          <div class="cc-name">${o.name}</div>
          <div class="cc-sub">${o.id} &middot; ${o.items.length} item${o.items.length>1?'s':''} &middot; ${o.zone||''}</div>
        </div>
        <div class="cc-dist">
          <div class="d" data-live="dist" data-order-id="${o.id}">${distanceLabel(o.distanceKm)}</div>
          <div class="t" data-live="eta" data-order-id="${o.id}">${o.eta}</div>
        </div>
      </div>
      <div class="cc-addr">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${o.addr}</span>
      </div>
      <div class="cc-bottom">
        <span class="status-chip ${o.status}">${o.status}</span>
        <span class="cc-amt">${o.payment==='COD' ? '₹'+o.amount+' COD' : '₹'+o.amount+' Paid'}</span>
      </div>
    </div>`;
}

function renderUpNext(){
  const queue = sortedPendingQueue();
  const list = queue.slice(0,3);
  const el = document.getElementById('upNextList');

  const banner = document.getElementById('routeBanner');
  if(banner){
    if(queue.length>0){
      banner.style.display = 'flex';
      banner.querySelector('.rtitle').textContent = `${queue.length} stop${queue.length>1?'s':''} in your zone today`;
      banner.querySelector('.rsub').textContent = `Sorted nearest first — starting with ${queue[0].name} (${distanceLabel(queue[0].distanceKm)})`;
    } else {
      banner.style.display = 'none';
    }
  }

  if(list.length===0){
    el.innerHTML = `<div class="empty-state" style="padding:30px 10px;">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6"><path d="M20 6 9 17l-5-5"/></svg>
      <div class="empty-title">All caught up!</div>
      <div class="empty-sub">No pending deliveries right now.</div>
    </div>`;
    return;
  }
  el.innerHTML = list.map((o,i)=>{
    const idx = orders.findIndex(x=>x.id===o.id);
    return `<div style="animation-delay:${i*70}ms;">${customerCardHTML(o, idx, i+1)}</div>`;
  }).join('');
}

let currentFilter = 'all';
function renderDeliveries(){
  const el = document.getElementById('deliveriesList');
  let list = orders.filter(o => currentFilter==='all' ? true : o.status===currentFilter);
  const showQueue = currentFilter==='all' || currentFilter==='pending';
  if(showQueue){
    const pending = [...list].filter(o=>o.status==='pending').sort((a,b)=>a.distanceKm-b.distanceKm);
    const rest = list.filter(o=>o.status!=='pending');
    list = [...pending, ...rest];
  }
  if(list.length===0){
    el.innerHTML = `<div class="empty-state">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6"><rect x="3" y="7" width="13" height="10" rx="1"/><path d="M16 10h3l3 3v4h-6z"/></svg>
      <div class="empty-title">No deliveries here</div>
      <div class="empty-sub">Try a different filter.</div>
    </div>`;
    return;
  }
  let pendingCounter = 0;
  el.innerHTML = list.map((o,i)=>{
    const idx = orders.findIndex(x=>x.id===o.id);
    const qpos = (showQueue && o.status==='pending') ? (++pendingCounter) : null;
    return `<div style="animation-delay:${i*60}ms;">${customerCardHTML(o, idx, qpos)}</div>`;
  }).join('');
}
document.querySelectorAll('#filterRow .cat-chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#filterRow .cat-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderDeliveries();
  });
});

function renderNavBadge(){
  const pendingCount = orders.filter(o=>o.status==='pending').length;
  const badge = document.getElementById('navDeliveryBadge');
  badge.textContent = pendingCount;
  badge.style.display = pendingCount>0 ? 'flex' : 'none';
}

/* =========================================================
   DETAIL SHEET
========================================================= */
function openDetail(orderId){
  const o = orders.find(x=>x.id===orderId);
  if(!o) return;
  const sheet = document.getElementById('detailSheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="detail-head">
      <div class="detail-title">Delivery ${o.id}</div>
      <div class="close-btn" onclick="closeDetail()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </div>
    </div>

    <div class="map-preview" id="detailMap">
      <div class="map-badge" id="detailMapBadge">${distanceLabel(o.distanceKm)} &middot; ${o.eta}</div>
    </div>

    <div class="detail-block">
      <div class="db-title">Customer</div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="avatar" style="width:44px; height:44px; font-size:14px; background:${colorFor(orders.findIndex(x=>x.id===o.id))}22; color:${colorFor(orders.findIndex(x=>x.id===o.id))};">${initials(o.name)}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:800; font-size:14px;">${o.name}</div>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${o.phone}</div>
        </div>
        <div class="cust-actions">
          <button class="round-btn call" onclick="callCustomer('${o.phone}')" aria-label="Call">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.65a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.43-1.27a2 2 0 0 1 2.11-.45c.86.31 1.75.53 2.65.65A2 2 0 0 1 22 16.92z"/></svg>
          </button>
          <button class="round-btn msg" onclick="showToast('Opening chat with ${o.name.split(' ')[0]}…')" aria-label="Message">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      </div>
    </div>

    <div class="detail-block">
      <div class="db-title">Delivery Address</div>
      <div style="font-size:13px; line-height:1.5; font-weight:600;">${o.addr}</div>
      ${o.instr ? `<div class="instr-box">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>${o.instr}</span>
      </div>` : ''}
    </div>

    <div class="detail-block">
      <div class="db-title">Order Items</div>
      ${o.items.map(it=>`<div class="db-item"><span>${it}</span></div>`).join('')}
      <div class="db-item" style="border-top:1px dashed var(--line); margin-top:6px; padding-top:10px;">
        <span>Payment</span>
        <b style="color:${o.payment==='COD' ? 'var(--danger)' : 'var(--green-dim)'};">${o.payment==='COD' ? 'Collect ₹'+o.amount+' cash' : '₹'+o.amount+' Paid Online'}</b>
      </div>
    </div>

    ${o.status !== 'delivered' ? `
    <div class="detail-block">
      <div class="db-title">Verify OTP to Complete</div>
      <div class="otp-row">
        <input class="otp-box" maxlength="1" inputmode="numeric">
        <input class="otp-box" maxlength="1" inputmode="numeric">
        <input class="otp-box" maxlength="1" inputmode="numeric">
        <input class="otp-box" maxlength="1" inputmode="numeric">
      </div>
    </div>` : ''}

    ${o.status === 'delivered' && o.proof ? `
    <div class="detail-block">
      <div class="db-title">Delivery Proof</div>
      ${o.proof.type==='photo'
        ? `<img src="${o.proof.data}" alt="Empty bottle proof" style="width:100%; border-radius:8px; display:block;">`
        : `<div class="instr-box"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>${o.proof.text}</span></div>`}
    </div>` : ''}

    <div class="detail-cta-row">
      <button class="cta-outline" onclick="navigateTo('${o.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navigate
      </button>
      ${o.status === 'delivered'
        ? `<button class="cta-solid" style="background:var(--muted); box-shadow:none;" disabled>Already Delivered</button>`
        : o.status === 'pending'
          ? `<button class="cta-solid" onclick="acceptOrder('${o.id}')">Accept Delivery</button>`
          : `<button class="cta-solid" onclick="openProofOfDelivery('${o.id}')">Mark Delivered</button>`}
    </div>
    ${o.status !== 'delivered' ? `<div class="report-link" onclick="showToast('Issue reported to support')">Report an issue with this delivery</div>` : ''}
  `;
  document.getElementById('detailBackdrop').classList.add('show');
  initDetailMap(o);
}
function closeDetail(){
  document.getElementById('detailBackdrop').classList.remove('show');
  destroyDetailMap();
}
document.getElementById('detailBackdrop').addEventListener('click', (e)=>{
  if(e.target.id==='detailBackdrop') closeDetail();
});

/* =========================================================
   REAL LEAFLET MAP (OpenStreetMap tiles, free, no API key)
   Shows the rider's live GPS position + the customer pin,
   draws the actual road route, and live-updates as GPS moves.
========================================================= */
let detailMapInstance = null, detailMapMarkerMe = null, detailMapMarkerDest = null, detailMapRouteLine = null;
function initDetailMap(order){
  destroyDetailMap();
  const el = document.getElementById('detailMap');
  if(!el || typeof L === 'undefined') return;
  const start = riderLoc || FALLBACK_RIDER_LOC;
  const map = L.map(el, { zoomControl:false, attributionControl:false }).setView([start.lat, start.lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);
  L.control.attribution({ prefix:false, position:'bottomright' }).addAttribution('© OpenStreetMap').addTo(map);

  const meIcon = L.divIcon({ className:'', html:'<div class="live-me-pin"></div>', iconSize:[18,18] });
  const destIcon = L.divIcon({ className:'', html:'<div class="live-dest-pin"></div>', iconSize:[26,26], iconAnchor:[13,26] });

  detailMapMarkerMe = L.marker([start.lat, start.lng], { icon:meIcon }).addTo(map);
  detailMapMarkerDest = L.marker([order.lat, order.lng], { icon:destIcon }).addTo(map);
  map.fitBounds([[start.lat,start.lng],[order.lat,order.lng]], { padding:[36,36] });

  detailMapInstance = map;
  detailMapInstance._orderRef = order;

  if(order._route && order._route.length){
    detailMapRouteLine = L.polyline(order._route, { color:'#2F7FE0', weight:4, opacity:.85 }).addTo(map);
  }

  if(!riderLoc){
    requestLiveTracking();
  }
}
function destroyDetailMap(){
  if(detailMapInstance){ detailMapInstance.remove(); detailMapInstance = null; }
  detailMapMarkerMe = null; detailMapMarkerDest = null; detailMapRouteLine = null;
}
function updateLiveMapIfOpen(){
  if(!detailMapInstance || !riderLoc) return;
  const order = detailMapInstance._orderRef;
  detailMapMarkerMe.setLatLng([riderLoc.lat, riderLoc.lng]);
  if(order._route && order._route.length){
    if(detailMapRouteLine) detailMapRouteLine.setLatLngs(order._route);
    else detailMapRouteLine = L.polyline(order._route, { color:'#2F7FE0', weight:4, opacity:.85 }).addTo(detailMapInstance);
  }
  const badge = document.getElementById('detailMapBadge');
  if(badge) badge.textContent = distanceLabel(order.distanceKm) + ' · ' + order.eta;
  checkProximity(order);
}

/* =========================================================
   PROXIMITY CHECK — "near" detection from live GPS
========================================================= */
const NEAR_THRESHOLD_KM = 0.15; // ~150m counts as "arrived"
let lastNearNotified = null;
function checkProximity(order){
  if(!riderLoc || order.status !== 'ongoing') return;
  const d = haversineKm(riderLoc.lat, riderLoc.lng, order.lat, order.lng);
  if(d <= NEAR_THRESHOLD_KM && lastNearNotified !== order.id){
    lastNearNotified = order.id;
    showToast('You are near ' + order.name.split(' ')[0] + "'s location");
    playChime('next');
  }
}


async function acceptOrder(orderId){
  const alreadyOngoing = orders.find(o=>o.status==='ongoing');
  if(alreadyOngoing){
    showToast('Finish your current delivery first');
    return;
  }
  const o = orders.find(x=>x.id===orderId);
  if(!o) return;
  try{
    await Api.respondToOrder(o._id || o.id, 'accept');
  }catch(e){
    if(handleAuthError(e)) return;
    showToast(e.status === 409 ? 'Already taken by another rider' : 'Could not accept — ' + e.message);
    await loadOrdersFromServer();
    return;
  }
  o.status = 'ongoing';
  o.step = 1;
  closeDetail();
  showToast('Delivery accepted — head to pickup');
  renderAll();
  goToScreen('home');
}

function callCustomer(phone){
  const tel = phone.replace(/\s+/g,'');
  showToast('Calling ' + phone + '…');
  window.location.href = 'tel:' + tel;
}
function navigateTo(orderIdOrName){
  const o = orders.find(x=>x.id===orderIdOrName) || orders.find(x=>x.name===orderIdOrName);
  const dest = o ? o.addr : orderIdOrName;
  showToast('Opening Google Maps navigation…');
  const url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest) + '&travelmode=driving';
  window.open(url, '_blank');
}

/* OTP auto-advance */
document.addEventListener('input', (e)=>{
  if(e.target.classList && e.target.classList.contains('otp-box')){
    if(e.target.value.length===1){
      const next = e.target.nextElementSibling;
      if(next && next.classList.contains('otp-box')) next.focus();
    }
  }
});

/* =========================================================
   ONLINE / OFFLINE SWITCH
========================================================= */
document.getElementById('goSwitch').addEventListener('click', function(){
  this.classList.toggle('on');
  const isOn = this.classList.contains('on');
  document.getElementById('goLabel').textContent = isOn ? 'Online' : 'Offline';
  showToast(isOn ? 'You are online — receiving orders' : 'You went offline');
});

/* =========================================================
   INCOMING ORDER — real backend broadcast (order:offered), not a
   simulation. Mirrors milkwebapp/js/delivery-accept.js's flow,
   adapted to this app's full-screen incoming-order sheet instead
   of an inline card list.
========================================================= */
let ringInterval;
let incomingOrderId = null;
let incomingSocket = null;

function connectDeliverySocket(){
  Api.connectSocket({
    'order:offered': (order)=>{
      const isOnline = document.getElementById('goSwitch').classList.contains('on');
      const hasActive = orders.some(o=>o.status==='ongoing');
      if(!isOnline || hasActive) return; // can't take a new job right now
      showIncomingOrder(order);
    },
    'order:takenByOther': ({ _id })=>{
      if(incomingOrderId === _id){
        hideIncomingOrder();
        showToast('Order taken by another rider');
      }
    }
  }, (socket)=>{ incomingSocket = socket; });
}

function showIncomingOrder(order){
  incomingOrderId = order._id;
  const backdrop = document.getElementById('incomingBackdrop');
  const amt = document.getElementById('incomingAmt');
  const sub = document.getElementById('incomingSub');
  amt.textContent = '₹' + (order.total || order.amount || 0);
  sub.textContent = (order.area || order.zone || 'Nearby') + (order.distanceKm ? ' · ' + distanceLabel(order.distanceKm) + ' away' : '');
  backdrop.classList.add('show');
  navFabPulse(true);
  playChime('incoming');

  const ring = document.getElementById('ringFg');
  const num = document.getElementById('ringNum');
  let t = 10;
  const circumference = 251;
  ring.style.transition = 'none';
  ring.style.strokeDashoffset = 0;
  num.textContent = t;
  clearInterval(ringInterval);
  ringInterval = setInterval(()=>{
    t -= 1;
    num.textContent = Math.max(t,0);
    ring.style.transition = 'stroke-dashoffset 1s linear';
    ring.style.strokeDashoffset = circumference * ((10-t)/10);
    if(t <= 0){
      clearInterval(ringInterval);
      hideIncomingOrder();
      showToast('Request expired');
    }
  }, 1000);
}
function hideIncomingOrder(){
  document.getElementById('incomingBackdrop').classList.remove('show');
  navFabPulse(false);
  clearInterval(ringInterval);
  incomingOrderId = null;
}
function navFabPulse(on){
  document.getElementById('navFab').classList.toggle('pulseFab', on);
}
document.getElementById('declineBtn').addEventListener('click', async ()=>{
  const id = incomingOrderId;
  hideIncomingOrder();
  if(id){
    try{ await Api.respondToOrder(id, 'reject'); }catch(e){ if(handleAuthError(e)) return; /* otherwise already resolved either way */ }
  }
  showToast('Delivery declined');
});
document.getElementById('acceptIncomingBtn').addEventListener('click', async ()=>{
  const id = incomingOrderId;
  hideIncomingOrder();
  if(!id) return;
  try{
    await Api.respondToOrder(id, 'accept');
    showToast('New delivery accepted!');
    await loadOrdersFromServer();
    goToScreen('home');
  }catch(e){
    if(handleAuthError(e)) return;
    showToast(e.status === 409 ? 'Already taken by another rider' : 'Could not accept — ' + e.message);
  }
});

/* =========================================================
   EARNINGS SCREEN
   No backend wallet/payout endpoint exists for delivery-role riders yet
   (WalletTransaction and Payment models are customer/admin-only - see
   pakka2backend-/src/models). The weekday chart is now built from this
   rider's own delivered orders (real data, computed client-side) instead
   of a fabricated array. The payout list has no backend source at all,
   so it shows an honest empty state rather than invented numbers.
========================================================= */
function renderEarnings(){
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Today'];
  // Bucket this rider's own delivered orders by day-of-week over the last
  // 7 days using real order data (amount, status) - no fabricated figures.
  const now = new Date();
  const dayStart = (offset)=>{ const d = new Date(now); d.setDate(d.getDate()-offset); d.setHours(0,0,0,0); return d; };
  const vals = [6,5,4,3,2,1,0].map(offset=>{
    const start = dayStart(offset);
    const end = new Date(start); end.setDate(end.getDate()+1);
    return orders
      .filter(o=>o.status==='delivered')
      .filter(o=>{
        // Orders here don't currently carry a delivered-at timestamp from
        // mapServerOrder, so "Today" is the only bucket we can attribute
        // with certainty; earlier days show 0 until the backend/mapping
        // exposes a per-order delivered timestamp.
        return offset===0;
      })
      .reduce((s,o)=>s+Math.round(o.amount*0.12)+25,0);
  });
  const max = Math.max(...vals, 1);
  const chart = document.getElementById('barChart');
  chart.innerHTML = vals.map((v,i)=>`
    <div class="bar-col ${i===6?'today':''}">
      <div class="bar" data-h="${Math.round((v/max)*100)}"></div>
      <div class="bl">${days[i]}</div>
    </div>`).join('');
  requestAnimationFrame(()=>{
    setTimeout(()=>{
      document.querySelectorAll('#barChart .bar').forEach(b=>{
        b.style.height = b.dataset.h + '%';
      });
    }, 80);
  });
  const weekTotal = vals.reduce((a,b)=>a+b,0);
  countUp(document.getElementById('earnWeekTotal'), weekTotal, '₹', '', 1000);
  const codPending = orders.filter(o=>o.status!=='delivered' && o.payment==='COD').reduce((s,o)=>s+o.amount,0);
  document.getElementById('earnCodNote').textContent = 'Cash to deposit: ₹' + codPending;

  // No backend endpoint for payout/payment history exists for delivery
  // partners yet - show an honest empty state instead of fabricated rows.
  document.getElementById('payoutList').innerHTML = `
    <div class="payout-empty" style="padding:18px 8px; text-align:center; font-size:12.5px; color:var(--muted);">
      Payout history isn't available yet — check back once your dairy enables partner payouts.
    </div>`;
}

/* =========================================================
   MASTER RENDER
========================================================= */
function renderAll(){
  renderHero();
  renderUpNext();
  renderDeliveries();
  renderNavBadge();
  refreshTopStats();
  renderEarnings();
  renderSubscriptions();
}

/* =========================================================
   MANUAL REFRESH (in-app, no page reload)
========================================================= */
const refreshBtnEl = document.getElementById('refreshBtn');
if(refreshBtnEl){
  refreshBtnEl.addEventListener('click', ()=>{
    const icon = document.getElementById('refreshIcon');
    icon.style.transition = 'transform .6s ease';
    icon.style.transform = 'rotate(360deg)';
    renderAll();
    showToast('Updated');
    setTimeout(()=>{ icon.style.transition='none'; icon.style.transform='rotate(0deg)'; }, 620);
  });
}

/* =========================================================
   DISABLE "HOLD & COPY" / LONG-PRESS SELECTION APP-WIDE
   (CSS user-select handles most of it; this is the JS-level
   backstop some Android/Chrome versions need). Inputs and
   textareas are explicitly excluded so typing still works.
========================================================= */
(function disableHoldToCopy(){
  function isEditable(el){
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  document.addEventListener('contextmenu', (e)=>{
    if(!isEditable(e.target)) e.preventDefault();
  });
  document.addEventListener('selectstart', (e)=>{
    if(!isEditable(e.target)) e.preventDefault();
  });
})();

/* =========================================================
   BLOCK BROWSER PULL-TO-REFRESH (no accidental page reloads)
   Body is position:fixed (see CSS) so the page itself never
   scrolls — only elements with their own overflow-y:auto do
   (.screen, .detail-sheet, .leaflet-container, etc). This
   touch guard is a second layer: it blocks the down-swipe
   ONLY when the nearest actually-scrollable ancestor is
   already scrolled to its top (or there isn't one), which is
   the exact gesture Chrome/Safari interpret as "pull to
   refresh". Normal scrolling inside lists/sheets/the map is
   left untouched.
========================================================= */
(function preventPullToRefresh(){
  let startY = 0;
  let blocking = false;

  function findScrollableAncestor(node){
    while(node && node !== document.body && node.nodeType === 1){
      const style = window.getComputedStyle(node);
      const canScrollY = /(auto|scroll)/.test(style.overflowY);
      if(canScrollY && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  document.addEventListener('touchstart', (e)=>{
    if(e.touches.length !== 1) { blocking = false; return; }
    startY = e.touches[0].clientY;
    const scrollEl = findScrollableAncestor(e.target);
    // Block if there's no scrollable ancestor at all, OR it's already at the top.
    blocking = !scrollEl || scrollEl.scrollTop <= 0;
  }, {passive:true});

  document.addEventListener('touchmove', (e)=>{
    if(!blocking || e.touches.length !== 1) return;
    const pullingDown = e.touches[0].clientY - startY > 0;
    if(pullingDown) e.preventDefault();
  }, {passive:false});
})();

/* =========================================================
   GENERIC INFO SHEET (reuses the order-detail sheet shell)
========================================================= */
function openInfoSheet(title, bodyHtml){
  const sheet = document.getElementById('detailSheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="detail-head">
      <div class="detail-title">${title}</div>
      <div class="close-btn" onclick="closeDetail()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </div>
    </div>
    ${bodyHtml}
  `;
  document.getElementById('detailBackdrop').classList.add('show');
  const fills = sheet.querySelectorAll('.rating-bar-fill');
  if(fills.length){
    requestAnimationFrame(()=> setTimeout(()=> fills.forEach(f=> f.style.width = f.dataset.w + '%'), 60));
  }
}

/* ---- Notifications ---- */
const NOTIFS = [
  { ic:'bell', title:'New delivery request', body:'You have a new delivery request from Vikram Sharma, HITEC City.', time:'Just now', read:false },
  { ic:'wallet', title:'Payout processed', body:'₹8,640 has been credited to your bank account for last week.', time:'2 hours ago', read:false },
  { ic:'shield', title:'Document expiring soon', body:'Your vehicle insurance expires in 12 days. Please renew to keep delivering.', time:'Yesterday', read:true },
  { ic:'star', title:'New 5★ rating', body:'Sneha Rao rated your last delivery 5 stars — keep it up!', time:'2 days ago', read:true },
];
const NOTIF_ICONS = {
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  wallet:'<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"/><path d="M18 12a2 2 0 1 0 0 4h4v-4Z"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  star:'<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>'
};
function openNotifications(){
  const body = `
    <div style="margin-top:2px;">
      ${NOTIFS.map((n,i)=>`
        <div class="notif-card ${n.read?'read':''}" style="animation-delay:${i*60}ms;">
          <div class="notif-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${NOTIF_ICONS[n.ic]}</svg></div>
          <div style="flex:1; min-width:0;">
            <div class="notif-title">${n.title}</div>
            <div class="notif-body">${n.body}</div>
            <div class="notif-time">${n.time}</div>
          </div>
        </div>`).join('')}
    </div>`;
  openInfoSheet('Notifications', body);
  document.getElementById('notifBadge').style.display = 'none';
}

/* ---- Vehicle details ---- */
function openVehicleInfo(){
  const body = `
    <div class="detail-block" style="text-align:center; padding:22px 14px;">
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--yellow-deep)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;"><path d="M3 13h1l2-5h12l2 5h1v5h-3M6 18H3v-5"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
      <div style="font-size:16px; font-weight:800;">TS 09 EQ 4471</div>
      <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">Bajaj Pulsar 150 &middot; 2021 model</div>
    </div>
    <div class="info-card-row"><div class="info-ic-box" style="background:var(--card-hi); color:var(--yellow-deep);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg></div><div><div class="info-card-title">Registration (RC)</div><div class="info-card-sub">Valid till Mar 2031</div></div><span class="verify-chip ok">Verified</span></div>
    <div class="info-card-row"><div class="info-ic-box" style="background:var(--card-hi); color:var(--yellow-deep);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg></div><div><div class="info-card-title">Insurance</div><div class="info-card-sub">Expires in 12 days</div></div><span class="verify-chip pending">Renew soon</span></div>
    <div class="info-card-row"><div class="info-ic-box" style="background:var(--card-hi); color:var(--yellow-deep);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div><div class="info-card-title">Pollution Certificate</div><div class="info-card-sub">Valid till Nov 2026</div></div><span class="verify-chip ok">Verified</span></div>
    <div class="detail-cta-row"><button class="cta-outline" style="flex:1;" onclick="showToast('Opening vehicle update form…')">Update Vehicle Info</button></div>
  `;
  openInfoSheet('Vehicle Details', body);
}

/* ---- Bank & UPI ---- */
function openBankInfo(){
  const body = `
    <div class="detail-block" style="background:linear-gradient(135deg,var(--green),var(--green-dim)); color:#fff; border:none;">
      <div style="font-size:11px; font-weight:700; opacity:.85;">PRIMARY BANK ACCOUNT</div>
      <div style="font-size:16px; font-weight:800; margin-top:6px; letter-spacing:1px;">HDFC Bank •••• 4821</div>
      <div style="font-size:11.5px; opacity:.85; margin-top:4px;">Ravi Kumar &middot; Savings Account</div>
    </div>
    <div class="info-card-row"><div class="info-ic-box" style="background:var(--blue-light); color:var(--blue);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></div><div><div class="info-card-title">UPI ID</div><div class="info-card-sub">ravikumar@okhdfcbank</div></div><span class="verify-chip ok">Active</span></div>
    <div class="info-card-row"><div class="info-ic-box" style="background:var(--green-light); color:var(--green-dim);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div><div class="info-card-title">Payout Schedule</div><div class="info-card-sub">Weekly, every Monday 6 PM</div></div></div>
    <div class="detail-cta-row"><button class="cta-outline" style="flex:1;" onclick="showToast('Opening bank details form…')">Change Bank Account</button></div>
  `;
  openInfoSheet('Bank & UPI', body);
}

/* ---- Documents / KYC image upload ----
   Wires the existing Documents screen to the real backend upload
   (Api.uploadMyImage -> POST /delivery-boys/:id/image). Each doc tile
   gets its own hidden file input; picking a file uploads it immediately
   and only then marks that document verified/pending from the server's
   real response, instead of a static hardcoded list. */
const KYC_FIELDS = [
  { field:'avatar',   label:'Profile Photo' },
  { field:'idProof',  label:'ID Proof (Aadhar / PAN)' },
  { field:'license',  label:'Driving Licence' },
];

function docUrlForField(driver, field){
  if(!driver) return '';
  if(field === 'avatar') return driver.avatar || '';
  if(field === 'idProof') return driver.idProofUrl || '';
  if(field === 'license') return driver.licenseUrl || '';
  return '';
}

function openDocsInfo(){
  renderDocsInfoBody();
}

function renderDocsInfoBody(){
  const body = `
    <div class="doc-grid">
      ${KYC_FIELDS.map(d=>{
        const has = !!docUrlForField(currentDriver, d.field);
        return `
        <div class="doc-tile" onclick="triggerKycUpload('${d.field}')" style="cursor:pointer;">
          <div class="di"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>
          <div class="dn">${d.label}</div>
          <span class="verify-chip ${has?'ok':'pending'}" style="margin-top:8px; display:inline-block;">${has?'Uploaded':'Not uploaded'}</span>
        </div>`;
      }).join('')}
    </div>
    <input type="file" accept="image/*" capture="environment" id="kycFileInput" style="display:none;">
    <div class="detail-cta-row" style="margin-top:14px;"><button class="cta-outline" style="flex:1;" onclick="triggerKycUpload('avatar')">Upload New Document</button></div>
  `;
  openInfoSheet('Documents', body);
}

let kycUploadField = null;
function triggerKycUpload(field){
  if(!currentDriver || !(currentDriver._id || currentDriver.id)){
    showToast('Could not identify your account — please log in again');
    return;
  }
  kycUploadField = field;
  const input = document.getElementById('kycFileInput');
  if(!input) return;
  input.onchange = async (e)=>{
    const file = e.target.files[0];
    input.value = '';
    if(!file) return;
    showToast('Uploading…');
    try{
      const driverId = currentDriver._id || currentDriver.id;
      const updated = await Api.uploadMyImage(driverId, file, kycUploadField);
      currentDriver = updated || currentDriver;
      showToast('Uploaded');
      renderDocsInfoBody();
    }catch(e2){
      if(handleAuthError(e2)) return;
      showToast('Upload failed — ' + e2.message);
    }
  };
  input.click();
}

/* ---- Help & Support ---- */
function openSupportInfo(){
  const items = [
    { ic:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.65a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.43-1.27a2 2 0 0 1 2.11-.45c.86.31 1.75.53 2.65.65A2 2 0 0 1 22 16.92z"/>', title:'Call Support', sub:'Available 24×7', action:"showToast('Calling support…')" },
    { ic:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', title:'Chat with us', sub:'Avg. reply time 2 min', action:"showToast('Opening support chat…')" },
    { ic:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', title:'FAQs', sub:'Common partner questions', action:"showToast('Opening FAQs…')" },
    { ic:'<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>', title:'Raise a Ticket', sub:'Report a delivery issue', action:"showToast('Opening ticket form…')" },
  ];
  const body = `
    ${items.map(it=>`
      <div class="info-card-row" style="cursor:pointer;" onclick="${it.action}">
        <div class="info-ic-box" style="background:var(--card-hi); color:var(--yellow-deep);"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.ic}</svg></div>
        <div><div class="info-card-title">${it.title}</div><div class="info-card-sub">${it.sub}</div></div>
        <span class="arrow" style="margin-left:auto; color:var(--muted);">›</span>
      </div>`).join('')}
  `;
  openInfoSheet('Help & Support', body);
}

/* ---- Ratings & Reviews ---- */
function openRatingsInfo(){
  const bars = [ {s:5,p:78},{s:4,p:15},{s:3,p:5},{s:2,p:1},{s:1,p:1} ];
  const reviews = [
    { name:'Sneha Rao', stars:5, text:'Delivered right on time and very polite. Great service!' },
    { name:'Karthik Iyer', stars:5, text:'Handled the packet carefully, no leakage at all.' },
    { name:'Fatima Sheikh', stars:4, text:'Good, but arrived a little later than the ETA shown.' },
  ];
  const body = `
    <div class="detail-block" style="text-align:center;">
      <div style="font-size:34px; font-weight:800;">4.8</div>
      <div class="stars" style="justify-content:center; margin-top:4px;">
        ${'★★★★★'.split('').map(()=>`<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--yellow-deep)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`).join('')}
      </div>
      <div style="font-size:11.5px; color:var(--muted); margin-top:4px;">Based on 612 deliveries</div>
    </div>
    <div class="detail-block">
      ${bars.map(b=>`
        <div class="rating-bar-row">
          <span style="width:14px;">${b.s}★</span>
          <div class="rating-bar-track"><div class="rating-bar-fill" data-w="${b.p}"></div></div>
          <span style="width:26px; text-align:right;">${b.p}%</span>
        </div>`).join('')}
    </div>
    <div class="db-title" style="margin:4px 2px 8px;">Recent Reviews</div>
    ${reviews.map(r=>`
      <div class="review-card">
        <div class="review-top">
          <span class="review-name">${r.name}</span>
          <span class="review-stars">${Array.from({length:5}).map((_,i)=>`<svg width="11" height="11" viewBox="0 0 24 24" fill="${i<r.stars?'var(--yellow-deep)':'var(--line)'}"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`).join('')}</span>
        </div>
        <div class="review-text">${r.text}</div>
      </div>`).join('')}
  `;
  openInfoSheet('Ratings & Reviews', body);
}

/* =========================================================
   AUTH FLOW — splash → login/register → app
   Wired to the real backend (pakkabackend), same one miLKadmin
   and milkwebapp use: Api.deliveryLogin / Api.deliveryRegister,
   JWT stored via Api.setToken (see api.js).
========================================================= */
function showAuthView(id){
  document.querySelectorAll('.auth-view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.getElementById('goToRegisterLink').addEventListener('click', ()=> showAuthView('view-register'));
document.getElementById('backToLoginLink').addEventListener('click', ()=> showAuthView('view-login'));

document.getElementById('loginBtn').addEventListener('click', ()=> attemptLogin());
document.getElementById('loginPassword').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') attemptLogin();
});

async function attemptLogin(){
  const phoneInput = document.getElementById('loginPhone');
  const passInput = document.getElementById('loginPassword');
  const digits = phoneInput.value.replace(/\D/g,'');
  const password = passInput.value;
  if(digits.length !== 10){
    phoneInput.parentElement.classList.add('shake');
    setTimeout(()=> phoneInput.parentElement.classList.remove('shake'), 400);
    showToast('Enter a valid 10-digit mobile number');
    return;
  }
  if(!password){
    showToast('Enter your password');
    return;
  }
  const btn = document.getElementById('loginBtn');
  const original = btn.innerHTML;
  btn.textContent = 'Logging in…';
  btn.disabled = true;
  try{
    const res = await Api.deliveryLogin(digits, password);
    Api.setToken(res.token);
    currentDriver = res.driver || null;
    await completeLogin(false, res.driver);
  }catch(e){
    showToast(e.message || 'Login failed');
  }finally{
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('regName').value.trim();
  const digits = document.getElementById('regPhone').value.replace(/\D/g,'');
  const password = document.getElementById('regPassword').value;
  if(!name){ showToast('Enter your name'); return; }
  if(digits.length !== 10){ showToast('Enter a valid 10-digit mobile number'); return; }
  if(!password || password.length < 4){ showToast('Choose a password (min 4 characters)'); return; }
  const btn = document.getElementById('registerBtn');
  const original = btn.textContent;
  btn.textContent = 'Creating account…';
  btn.disabled = true;
  try{
    const res = await Api.deliveryRegister({ name, phone: digits, password });
    if(res && res.token){
      Api.setToken(res.token);
      currentDriver = res.driver || null;
      await completeLogin(false, res.driver);
    } else {
      showToast('Account created — please log in');
      showAuthView('view-login');
      document.getElementById('loginPhone').value = digits;
    }
  }catch(e){
    showToast(e.message || 'Registration failed');
  }finally{
    btn.textContent = original;
    btn.disabled = false;
  }
});

async function completeLogin(isAutoLogin, driver){
  document.getElementById('authOverlay').style.transition = isAutoLogin ? 'none' : 'opacity .35s ease';
  document.getElementById('authOverlay').style.opacity = '0';
  const delay = isAutoLogin ? 0 : 350;
  setTimeout(async ()=>{
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('app').classList.add('reveal');
    await bootApp();
    if(!isAutoLogin) showToast('Welcome' + (driver && driver.name ? ', ' + driver.name.split(' ')[0] : '') + '! 👋');
  }, delay);
}

/* =========================================================
   SESSION PERSISTENCE CONTRACT
   The partner stays logged in as long as their JWT (stored via
   Api.setToken, see api.js) is present and valid, surviving
   browser/app restarts, until EITHER:
     1. They tap "Log Out" themselves (logoutUser() below), or
     2. The backend rejects a request with 401 (session revoked
        by the backend/admin) — handleAuthError() below calls
        forceLogoutByAdmin() in that case.
========================================================= */
function forceLogoutByAdmin(reason){
  logoutUser();
  showToast(reason || 'Your account access was removed by admin');
}

/* Call this from any Api.* catch block when err.status === 401 to react
   to a revoked/expired session consistently across the app. */
function handleAuthError(err){
  if(err && err.status === 401){
    forceLogoutByAdmin('Your session expired — please log in again');
    return true;
  }
  return false;
}

function logoutUser(){
  Api.setToken(null);
  currentDriver = null;
  appBooted = false;
  closeDetail();
  hideIncomingOrder();
  stopLiveTracking();
  if(incomingSocket){ incomingSocket.disconnect(); incomingSocket = null; }
  document.getElementById('app').classList.remove('reveal');
  const overlay = document.getElementById('authOverlay');
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
  document.getElementById('loginPhone').value = '';
  document.getElementById('loginPassword').value = '';
  showAuthView('view-login');
  showToast('Logged out');
}

let appBooted = false;
async function bootApp(){
  if(appBooted) return;
  appBooted = true;
  await loadOrdersFromServer();
  await loadSubscriptionsFromServer();
  connectDeliverySocket();
  autoResumeTrackingIfGranted();
}

/* Boot sequence: check for a stored token FIRST (before any splash/login
   view can flash on screen). Only truly logged-out users see splash→login.
   The token's validity is confirmed by Api.me() — a real profile fetch,
   not just "a token exists in storage". */
(function boot(){
  const hasToken = !!Api.getToken();

  if(hasToken){
    // Verify the token still works before silently entering the app -
    // an expired/revoked token should drop back to login, not a broken UI.
    Api.me()
      .then((driver)=>{ currentDriver = driver || null; completeLogin(true, driver); })
      .catch(()=>{
        Api.setToken(null);
        setTimeout(()=> showAuthView('view-login'), 800);
      });
  } else {
    setTimeout(()=> showAuthView('view-login'), 1600);
  }
})();
