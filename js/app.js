import { INITIAL_FLEET, INITIAL_ALERTS, AI_INSIGHTS, RISK_ZONES, CONFIG_DEFAULTS } from './data.js';

// ── State ────────────────────────────────────────────────────
let fleet   = INITIAL_FLEET.map(u => ({ ...u }));
let alerts  = INITIAL_ALERTS.map(a => ({ ...a }));
let config  = { ...CONFIG_DEFAULTS };
let selected = null;   // equipoId seleccionado en flota
let activeTab = 'fleet';
let tickCount = 0;

// ── Helpers ──────────────────────────────────────────────────
function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.round(rnd(min, max)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function riskColor(score) {
  if (score >= config.ai_riesgo_alto) return 'var(--red)';
  if (score >= 35) return 'var(--amber)';
  return 'var(--green)';
}
function riskClass(score) {
  if (score >= config.ai_riesgo_alto) return 'hi';
  if (score >= 35) return 'med';
  return 'ok';
}
function batDotClass(u) {
  if (u.sinSenal) return 'gray';
  if (u.bat <= config.bat_critica_v || u.batCritica) return 'red';
  if (u.bat <= config.bat_baja_v) return 'orange';
  return 'green';
}
function eventoTag(ev) {
  const map = { RPT: 'tipo-RPT', DTN: 'tipo-DTN', CDS: 'tipo-CDS', 'PTA+DTN': 'tipo-PTADTN' };
  return map[ev] || 'na';
}
function fmt(d) {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function fmtFull(d) {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + fmt(d);
}
function relTime(d) {
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  return `hace ${h}h ${mins % 60}min`;
}
function alertIcon(tipo) {
  const map = {
    sin_senal: '📡', bateria_critica: '🔋', bateria_baja: '🔋',
    inactividad: '⏸', detencion: '⏱', velocidad: '⚡', apertura: '🔓',
  };
  return map[tipo] || '⚠️';
}
function nivelClass(n) {
  if (n === 'critica') return 'hi';
  if (n === 'advertencia') return 'med';
  return 'ok';
}
function activeAlerts() { return alerts.filter(a => !a.resuelta); }

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('es-AR');
}

// ── Simulation tick (each 8s) ─────────────────────────────────
function simulateTick() {
  tickCount++;
  fleet = fleet.map(u => {
    const next = { ...u };

    // Drain / fluctuate battery
    if (!u.batCritica) {
      next.bat = clamp(u.bat + rnd(-0.03, 0.01), 10.5, 12.9);
    }

    // Move vehicles in transit
    if (u.vel > 0) {
      const delta = rnd(-8, 8);
      next.vel = clamp(u.vel + delta, 0, 140);
      next.kmRecorridos = Math.min(u.kmRecorridos + Math.round(u.vel / 450), u.kmTotales);
      next.lat = u.lat + rnd(-0.02, 0.02);
      next.lng = u.lng + rnd(-0.02, 0.02);
    }

    // Occasionally flip a stopped unit to moving (realism)
    if (u.vel === 0 && !u.batCritica && !u.sinSenal && !u.diasSinMovimiento
        && Math.random() < 0.04) {
      next.vel = rndInt(20, 80);
      next.evento = 'RPT';
    }
    if (u.vel > 0 && Math.random() < 0.06) {
      next.vel = 0;
      next.evento = 'DTN';
    }

    // Update GPS signal timer
    if (u.sinSenal) {
      next.minutesSinSenal = (u.minutesSinSenal || 0) + 1;
    }

    return next;
  });

  // Auto-generate occasional new alert
  if (tickCount % 15 === 0) {
    const candidates = fleet.filter(u => u.bat <= config.bat_baja_v && !u.batCritica);
    if (candidates.length && Math.random() < 0.5) {
      const u = candidates[Math.floor(Math.random() * candidates.length)];
      const exists = alerts.find(a => a.equipoId === u.id && a.tipo === 'bateria_baja' && !a.resuelta);
      if (!exists) {
        alerts = [{
          id: 'A' + Date.now(),
          ts: new Date(),
          tipo: 'bateria_baja',
          nivel: 'advertencia',
          equipoId: u.id,
          titulo: 'Batería baja',
          desc: `Batería en ${u.bat.toFixed(2)}V — por debajo del umbral configurado.`,
          resuelta: false,
        }, ...alerts];
      }
    }
  }

  renderAll();
}

// ── Render helpers ────────────────────────────────────────────
function renderAll() {
  updateBadges();
  if (activeTab === 'fleet')  { renderFleetKPI(); renderFleetTable(); if (selected) renderDetail(); }
  if (activeTab === 'alerts') { renderAlertsKPI(); renderAlertsTable(); renderAlertFeed(); }
  if (activeTab === 'ai')     { renderAIKPI(); renderAITable(); renderZones(); }
}

function updateBadges() {
  const act = activeAlerts().length;
  const crit = activeAlerts().filter(a => a.nivel === 'critica').length;
  const b = document.getElementById('badge-alerts');
  if (b) {
    b.textContent = act;
    b.className = 'badge ' + (crit > 0 ? 'red' : act > 0 ? 'amber' : 'green');
    b.style.display = act === 0 ? 'none' : '';
  }
}

// ── FLEET TAB ─────────────────────────────────────────────────
function renderFleetKPI() {
  const moving   = fleet.filter(u => u.vel > 0).length;
  const withAlert = fleet.filter(u => activeAlerts().some(a => a.equipoId === u.id)).length;
  const noSig    = fleet.filter(u => u.sinSenal).length;
  const batCrit  = fleet.filter(u => u.bat <= config.bat_critica_v).length;
  set('kpi-fleet-moving',  moving);
  set('kpi-fleet-alert',   withAlert);
  set('kpi-fleet-nosig',   noSig);
  set('kpi-fleet-bat',     batCrit);
}

function renderFleetTable() {
  const tbody = document.getElementById('fleet-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  fleet.forEach(u => {
    const ins = AI_INSIGHTS[u.id] || {};
    const score = ins.score || 0;
    const hasAlert = activeAlerts().some(a => a.equipoId === u.id);
    const tr = document.createElement('tr');
    if (hasAlert) tr.classList.add('alert-row');
    if (selected === u.id) tr.classList.add('selected');
    const prog = u.kmTotales > 0
      ? Math.round((u.kmRecorridos / u.kmTotales) * 100) : 0;
    tr.innerHTML = `
      <td><span class="dot ${batDotClass(u)}"></span></td>
      <td style="font-weight:600">${u.id}<div class="mini-prog">${u.alias}</div></td>
      <td style="font-variant-numeric:tabular-nums">${u.bat.toFixed(2)}V</td>
      <td><span class="tag ${eventoTag(u.evento)}">${u.evento}</span></td>
      <td style="font-variant-numeric:tabular-nums">${u.vel} km/h</td>
      <td>
        <span class="tag ${riskClass(score)}">${score}%</span>
      </td>
      <td style="max-width:180px">
        <div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)">${u.ruta}</div>
        <div class="progress-track" style="margin-top:4px"><div class="progress-fill" style="width:${prog}%"></div></div>
        <div class="mini-prog">${u.kmRecorridos} / ${u.kmTotales} km</div>
      </td>
    `;
    tr.onclick = () => selectUnit(u.id);
    tbody.appendChild(tr);
  });
}

function selectUnit(id) {
  selected = id;
  renderFleetTable();
  renderDetail();
}

function renderDetail() {
  const u = fleet.find(f => f.id === selected);
  if (!u) return;
  const ins = AI_INSIGHTS[u.id] || { score: 0, factors: [], rec: '—' };
  const score = ins.score || 0;
  const ph = document.getElementById('detail-placeholder');
  const dc = document.getElementById('detail-content');
  if (ph) ph.style.display = 'none';
  if (dc) dc.style.display = '';

  set('d-equipo', u.id + ' · ' + u.alias);
  set('d-origen', u.origen || '—');
  set('d-destino', u.destino || '—');
  set('d-bat', u.bat.toFixed(2) + 'V');
  set('d-vel', u.vel + ' km/h');
  set('d-evento', u.evento);
  set('d-curso', u.curso);
  set('d-ruta', u.ruta);
  const prog = u.kmTotales > 0 ? Math.round((u.kmRecorridos / u.kmTotales) * 100) : 0;
  const progEl = document.getElementById('d-progress');
  if (progEl) {
    progEl.style.width = prog + '%';
  }
  set('d-km', `${u.kmRecorridos} / ${u.kmTotales} km (${prog}%)`);
  set('d-eta', u.etaHoras != null ? `~${u.etaHoras.toFixed(1)}h` : 'Sin datos');

  // Risk bar
  const rv = document.getElementById('d-risk-val');
  const rb = document.getElementById('d-risk-bar');
  if (rv) { rv.textContent = score + '%'; rv.style.color = riskColor(score); }
  if (rb) { rb.style.width = score + '%'; rb.style.background = riskColor(score); }

  // Factors
  const fc = document.getElementById('d-factors');
  if (fc) {
    fc.innerHTML = ins.factors.map(f => {
      const neg = /baja|sin |pérdida|crítica|descenso|inminente|excede|atípic/i.test(f);
      const warn= /monitorear|lento|fuera/i.test(f);
      const col = neg ? 'var(--red)' : warn ? 'var(--amber)' : 'var(--green)';
      return `<div class="factor"><span class="factor-dot" style="background:${col}"></span>${f}</div>`;
    }).join('');
    if (ins.rec) {
      fc.innerHTML += `<div style="margin-top:8px;padding:8px 10px;background:var(--surface2);border-radius:6px;font-size:11px;color:var(--muted)">
        <strong style="color:var(--text)">Recomendación:</strong> ${ins.rec}
      </div>`;
    }
  }

  // Active alerts for this unit
  const myAlerts = activeAlerts().filter(a => a.equipoId === u.id);
  const alertBox = document.getElementById('d-alerts');
  if (alertBox) {
    if (myAlerts.length > 0) {
      alertBox.style.display = '';
      alertBox.innerHTML = myAlerts.map(a =>
        `<div style="padding:3px 0;font-size:11px;color:var(--red)">${alertIcon(a.tipo)} ${a.titulo}</div>`
      ).join('');
    } else {
      alertBox.style.display = 'none';
    }
  }
}

// ── ALERTS TAB ────────────────────────────────────────────────
function renderAlertsKPI() {
  const today = alerts.filter(a => {
    const h = (Date.now() - a.ts) / 3600000;
    return h < 24;
  });
  set('kpi-al-total', today.length);
  set('kpi-al-crit',  today.filter(a => a.nivel === 'critica' && !a.resuelta).length);
  set('kpi-al-res',   today.filter(a => a.resuelta).length);
  const act = today.filter(a => !a.resuelta);
  const avgMin = act.length
    ? Math.round(act.reduce((s, a) => s + (Date.now() - a.ts) / 60000, 0) / act.length)
    : 0;
  set('kpi-al-resp', avgMin > 60 ? `${Math.round(avgMin/60)}h` : `${avgMin} min`);
}

function renderAlertsTable() {
  const tbody = document.getElementById('alert-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  alerts.forEach(a => {
    const tr = document.createElement('tr');
    if (!a.resuelta && a.nivel === 'critica') tr.classList.add('alert-row');
    tr.innerHTML = `
      <td>${alertIcon(a.tipo)} <span class="tag ${nivelClass(a.nivel)}">${a.nivel}</span></td>
      <td style="font-weight:600">${a.equipoId}</td>
      <td style="font-size:11px">${a.titulo}</td>
      <td style="font-size:11px;color:var(--muted);max-width:200px">${a.desc}</td>
      <td style="font-size:10px;color:var(--faint)">${relTime(a.ts)}</td>
      <td>
        ${a.resuelta
          ? '<span class="tag ok">Resuelta</span>'
          : `<button onclick="resolveAlert('${a.id}')" style="font-size:10px;padding:3px 8px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;background:transparent;font-family:var(--font)">Resolver</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAlertFeed() {
  const feed = document.getElementById('alert-feed');
  if (!feed) return;
  const act = activeAlerts().sort((a, b) => b.ts - a.ts).slice(0, 8);
  feed.innerHTML = act.length === 0
    ? '<div class="empty-state"><div class="icon">✅</div>Sin alertas activas</div>'
    : act.map(a => `
      <div class="alert-item">
        <span class="alert-icon">${alertIcon(a.tipo)}</span>
        <div>
          <div class="alert-title">${a.titulo}</div>
          <div class="alert-sub">${a.equipoId} — ${a.desc}</div>
          <div class="alert-meta">${relTime(a.ts)}</div>
        </div>
      </div>`).join('');
}

window.resolveAlert = function(id) {
  alerts = alerts.map(a => a.id === id ? { ...a, resuelta: true } : a);
  renderAll();
  toast('Alerta marcada como resuelta');
};

// ── AI TAB ────────────────────────────────────────────────────
function renderAIKPI() {
  const scores = fleet.map(u => (AI_INSIGHTS[u.id] || {}).score || 0);
  const avg    = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const hi     = scores.filter(s => s >= config.ai_riesgo_alto).length;
  const med    = scores.filter(s => s >= 35 && s < config.ai_riesgo_alto).length;
  set('kpi-ai-total',  fleet.length);
  set('kpi-ai-hi',     hi);
  set('kpi-ai-med',    med);
  set('kpi-ai-avg',    avg + '%');
}

function renderAITable() {
  const tbody = document.getElementById('ai-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const sorted = [...fleet].sort((a, b) => {
    const sa = (AI_INSIGHTS[a.id] || {}).score || 0;
    const sb = (AI_INSIGHTS[b.id] || {}).score || 0;
    return sb - sa;
  });
  sorted.forEach(u => {
    const ins = AI_INSIGHTS[u.id] || { score: 0, factors: [], rec: '—' };
    const tr = document.createElement('tr');
    if (ins.score >= config.ai_riesgo_alto) tr.classList.add('alert-row');
    const mainFactor = ins.factors[0] || '—';
    tr.innerHTML = `
      <td style="font-weight:600">${u.id}<div class="mini-prog">${u.alias}</div></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;max-width:80px;height:6px;border-radius:3px;background:var(--border)">
            <div style="height:100%;border-radius:3px;width:${ins.score}%;background:${riskColor(ins.score)}"></div>
          </div>
          <span class="tag ${riskClass(ins.score)}">${ins.score}%</span>
        </div>
      </td>
      <td style="font-size:11px">${mainFactor}</td>
      <td style="font-size:11px;color:var(--muted);max-width:180px">${ins.rec}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderZones() {
  const el = document.getElementById('risk-zones');
  if (!el) return;
  el.innerHTML = RISK_ZONES.map(z => `
    <div class="zone-item">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="zone-name">${z.zona}</div>
        <span class="tag ${z.nivel}">${z.nivel === 'hi' ? 'Alto' : z.nivel === 'med' ? 'Medio' : 'Bajo'}</span>
      </div>
      <div class="zone-desc">${z.desc}</div>
      <div class="zone-meta">${z.incidencias} incidencia${z.incidencias !== 1 ? 's' : ''} registrada${z.incidencias !== 1 ? 's' : ''}</div>
    </div>`).join('');
}

// ── CONFIG TAB ────────────────────────────────────────────────
window.saveConfig = function() {
  config.bat_critica_v  = parseFloat(document.getElementById('cfg-bat-critica').value)  || config.bat_critica_v;
  config.bat_baja_v     = parseFloat(document.getElementById('cfg-bat-baja').value)      || config.bat_baja_v;
  config.detencion_min  = parseInt(document.getElementById('cfg-det-min').value)         || config.detencion_min;
  config.vel_max_kmh    = parseInt(document.getElementById('cfg-vel-max').value)         || config.vel_max_kmh;
  config.gps_perdida_min= parseInt(document.getElementById('cfg-gps-min').value)         || config.gps_perdida_min;
  config.ai_riesgo_alto = parseInt(document.getElementById('cfg-ai-score').value)        || config.ai_riesgo_alto;
  config.notif_whatsapp = document.getElementById('cfg-wsp').value;
  config.notif_email    = document.getElementById('cfg-email').value;
  config.notif_sms      = document.getElementById('cfg-sms').value;
  toast('✅ Configuración guardada');
  renderAll();
};

window.sendNotif = function(canal) {
  const dest = canal === 'WhatsApp' ? config.notif_whatsapp
    : canal === 'Email' ? config.notif_email : config.notif_sms;
  if (!dest) { toast(`⚠ Configurá el canal ${canal} primero`); return; }
  toast(`${canal} enviado a ${dest} (demo)`);
};

// ── Toast ─────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Tab switching ─────────────────────────────────────────────
window.setTab = function(id) {
  activeTab = id;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === 'tab-' + id));
  renderAll();
};

// ── Utility ───────────────────────────────────────────────────
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
  renderAll();
  setInterval(simulateTick, 8000);
});
