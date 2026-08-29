/* ===================== САКИ ПАРК — интерактив ===================== */
const SVGNS = 'http://www.w3.org/2000/svg';
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const levelColor = { 'Лёгкая':'#6f9a58', 'Умеренная':'#d99a2c', 'Средняя':'#e0653f' };
const CENTER = { x:PLANMAP.cx, y:PLANMAP.cy };
const ENTRANCE = POI.vhod.at; // [x,y] — все маршруты стартуют у одного и того же реального входа

/* «подшиваем» трассу из PDF точно к координате входа: ближайшую вершину
   заменяем на ENTRANCE, чтобы вход был математически идентичен на всех
   маршрутах, а не просто «близко» (трасса в PDF обрывается чуть раньше входа). */
(function snapLoopToEntrance(){
  let bi=0, bd=Infinity;
  PLANMAP.loop.forEach(([x,y],i)=>{
    const d=(x-ENTRANCE[0])**2+(y-ENTRANCE[1])**2;
    if(d<bd){ bd=d; bi=i; }
  });
  PLANMAP.loop[bi] = [ENTRANCE[0], ENTRANCE[1]];
})();

/* Предвычисленный трек: плотный массив точек кривой + накопленная длина
   вдоль неё. Строится ОДИН раз при загрузке страницы. Вся геометрия
   маршрутов (расстояния, ближайшая точка, точка на заданной длине) считается
   по этому массиву чистой математикой — без обращений к SVG DOM
   (path.getPointAtLength в цикле по тысяче раз на клик — вот что раньше
   тормозило открытие карточек маршрутов). */
function catmullPts(loop, samp){
  const m = loop.length, out = [];
  for(let i=0;i<m;i++){
    const p0=loop[(i-1+m)%m], p1=loop[i], p2=loop[(i+1)%m], p3=loop[(i+2)%m];
    for(let t=0;t<samp;t++){
      const tt = t/samp;
      const cr = (a,b,c,e) => 0.5*((2*b)+(-a+c)*tt+(2*a-5*b+4*c-e)*tt*tt+(-a+3*b-3*c+e)*tt*tt*tt);
      out.push([cr(p0[0],p1[0],p2[0],p3[0]), cr(p0[1],p1[1],p2[1],p3[1])]);
    }
  }
  out.push(out[0]);
  return out;
}
const TRAIL = (function(){
  const pts = catmullPts(PLANMAP.loop, 24);
  const cum = [0];
  for(let i=1;i<pts.length;i++) cum.push(cum[i-1] + Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]));
  return { pts, cum, L: cum[cum.length-1] };
})();

/* ближайшая длина вдоль трека к точке p (линейный поиск по кэшу — быстро) */
function nearestLen(p){
  let best = 0, bestD = Infinity;
  for(let i=0;i<TRAIL.pts.length;i++){
    const dx = TRAIL.pts[i][0]-p[0], dy = TRAIL.pts[i][1]-p[1];
    const d = dx*dx+dy*dy;
    if(d < bestD){ bestD = d; best = TRAIL.cum[i]; }
  }
  return best;
}
/* точка на треке на заданной длине (по модулю L), бинарный поиск по кэшу */
function pointAtLength(len){
  const L = TRAIL.L;
  len = ((len % L) + L) % L;
  let lo=0, hi=TRAIL.cum.length-1;
  while(lo<hi){ const mid=(lo+hi)>>1; if(TRAIL.cum[mid]<len) lo=mid+1; else hi=mid; }
  const k = Math.max(1, lo);
  const a = TRAIL.pts[k-1], b = TRAIL.pts[k];
  const segLen = (TRAIL.cum[k]-TRAIL.cum[k-1]) || 1;
  const f = (len - TRAIL.cum[k-1]) / segLen;
  return { x: a[0]+(b[0]-a[0])*f, y: a[1]+(b[1]-a[1])*f };
}

/* замкнутый сглаженный путь (Catmull-Rom → cubic bezier) — только для
   отрисовки (мини-карты маршрутов), геометрию по нему больше не считаем */
function closedSmoothPath(pts){
  const n = pts.length; if(n<3) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for(let i=0;i<n;i++){
    const p0=pts[(i-1+n)%n], p1=pts[i], p2=pts[(i+1)%n], p3=pts[(i+2)%n];
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d+' Z';
}
const FULL_LOOP_D = closedSmoothPath(PLANMAP.loop); // не меняется — считаем один раз
function routeTrackD(){ return FULL_LOOP_D; }

let activeRoute = null;
let state = { filter:'all', sort:'n' };

/* ---------- мини-карта в карточке (thumb) ---------- */
function thumbSVG(route){
  // мини-карта: реальный план + трек маршрута
  const vb = `${PLANMAP.w*0.06} ${PLANMAP.h*0.16} ${PLANMAP.w*0.66} ${PLANMAP.h*0.66}`;
  return `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid slice">
    <image href="plan.png" x="0" y="0" width="${PLANMAP.w}" height="${PLANMAP.h}"/>
    <path d="${routeTrackD(route)}" fill="none" stroke="${route.color}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ---------- карточки маршрутов ---------- */
function renderList(){
  let list = ROUTES.filter(r => state.filter==='all' || r.tags.includes(state.filter));
  const sorters = {
    n:(a,b)=>a.n-b.n,
    time:(a,b)=>a.durationMin-b.durationMin,
    dist:(a,b)=>a.distanceKm-b.distanceKm,
    load:(a,b)=>a.n-b.n,
  };
  list.sort(sorters[state.sort]);

  const wrap = $('#routeList');
  wrap.innerHTML = list.map(r => `
    <div class="route-card ${activeRoute===r.id?'is-active':''}" data-id="${r.id}" role="button" tabindex="0">
      <div class="rc-thumb">${thumbSVG(r)}</div>
      <div class="rc-body">
        <div class="rc-title">${r.name}</div>
        <div class="rc-meta">${r.distance} · ${r.duration.replace('около ','')}</div>
        <div class="rc-level"><i style="background:${levelColor[r.level]}"></i>${r.level} нагрузка</div>
        <div class="rc-points">${r.pois.length} точек · ${r.terrenkur}</div>
      </div>
      <div class="rc-arrow">›</div>
    </div>`).join('');

  $$('.route-card', wrap).forEach(c=>{
    c.addEventListener('click', ()=>selectRoute(c.dataset.id));
    c.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();selectRoute(c.dataset.id);} });
  });
}

/* ---------- деталь маршрута ---------- */
function renderDetail(route){
  const d = $('#routeDetail');
  d.hidden = false;
  d.innerHTML = `
    <div class="rd-top">
      <div>
        <div class="rd-terrenkur">${route.terrenkur}</div>
        <div class="rd-title">${route.name}</div>
        <div class="rd-subtitle">${route.subtitle}</div>
      </div>
      <button class="rd-fav" title="В избранное">♡</button>
    </div>
    <div class="rd-stats">
      <div class="rd-stat"><b>${route.distance}</b><span>протяжённость</span></div>
      <div class="rd-stat"><b>${route.duration.replace('около ','~')}</b><span>время</span></div>
      <div class="rd-stat"><b>${route.pois.length}</b><span>точек интереса</span></div>
    </div>
    <div class="rd-tags">${route.audience.map(t=>`<span>${t}</span>`).join('')}</div>
    <div class="rd-block">
      <h5>Медицинские показания</h5>
      <p>${route.indications}</p>
    </div>
    <div class="rd-block">
      <h5>Режим нагрузки</h5>
      <p>${route.load}</p>
    </div>
    <div class="rd-note">
      <span>⚠️</span>
      <div><b>При плохом самочувствии</b> остановитесь и обратитесь за помощью. Рекомендации по нагрузке не заменяют консультацию врача.</div>
    </div>
    <div class="stations">
      <h5>Станции маршрута</h5>
      ${route.pois.map((pid,i)=>{
        const p = POI[pid];
        return `<div class="station" data-i="${i}">
          <div class="st-num" style="background:${route.color}">${i+1}</div>
          <div><div class="st-name">${p.name}</div>${p.sub?`<div class="st-sub">${p.sub}</div>`:''}</div>
          <div class="st-cat">${p.cat}</div>
        </div>`;
      }).join('')}
    </div>`;

  $$('.station', d).forEach(st=>{
    st.addEventListener('click', ()=>{
      const i = +st.dataset.i;
      openPOI(route, i, true);
    });
    st.addEventListener('mouseenter', ()=>highlightMarker(+st.dataset.i, true));
    st.addEventListener('mouseleave', ()=>highlightMarker(+st.dataset.i, false));
  });
}

/* ---------- мобильный мини-слайдер станций ---------- */
/* На узких экранах длинный список станций заменяется компактным слайдером:
   одна станция за раз — крупный номер, название, описание, стрелки/точки/свайп.
   На десктопе элемент скрыт CSS-медиазапросом, но данные считаются всегда. */
let sliderRoute = null, sliderIndex = 0;
function renderStationSlider(route){
  sliderRoute = route;
  sliderIndex = 0;
  $('#stationSlider').hidden = false;
  $('#ssDots').innerHTML = route.pois.map((_,i)=>`<i data-i="${i}"></i>`).join('');
  updateSlider();
}
function updateSlider(){
  if(!sliderRoute) return;
  const route = sliderRoute, i = sliderIndex;
  const p = POI[route.pois[i]];
  $('#ssCount').textContent = `${i+1} / ${route.pois.length}`;
  $('#ssNum').textContent = i+1;
  $('#ssNum').style.background = route.color;
  $('#ssCat').textContent = p.cat;
  $('#ssName').textContent = p.name;
  $('#ssSub').textContent = p.sub || '';
  $('#ssSub').style.display = p.sub ? '' : 'none';
  $('#ssDesc').textContent = p.desc;
  $$('#ssDots i').forEach((dot,k)=>dot.classList.toggle('is-on', k===i));
  $('#ssPrev').disabled = i===0;
  $('#ssNext').disabled = i===route.pois.length-1;
  $$('#routeLayer .rt-marker').forEach(g=>highlightMarker(+g.dataset.i, +g.dataset.i===i));
}
function sliderStep(delta){
  if(!sliderRoute) return;
  sliderIndex = Math.max(0, Math.min(sliderRoute.pois.length-1, sliderIndex+delta));
  updateSlider();
}
$('#ssPrev').addEventListener('click', ()=>sliderStep(-1));
$('#ssNext').addEventListener('click', ()=>sliderStep(1));
$('#ssDots').addEventListener('click', e=>{
  const dot = e.target.closest('i'); if(!dot) return;
  sliderIndex = +dot.dataset.i; updateSlider();
});
(function initSliderSwipe(){
  const card = $('#ssCard');
  let startX = 0, dx = 0, dragging = false;
  card.addEventListener('touchstart', e=>{ startX = e.touches[0].clientX; dragging = true; dx = 0; }, {passive:true});
  card.addEventListener('touchmove', e=>{ if(dragging) dx = e.touches[0].clientX - startX; }, {passive:true});
  card.addEventListener('touchend', ()=>{
    if(dragging && Math.abs(dx) > 40) sliderStep(dx < 0 ? 1 : -1);
    dragging = false; dx = 0;
  });
})();

/* ---------- рисуем маршрут на карте ---------- */
function drawRoute(route){
  const layer = $('#routeLayer');
  layer.innerHTML = '';

  const L = TRAIL.L;
  const n = route.pois.length;
  const R = 27, IC = 22, OFF = 60;

  // реальная позиция каждой станции: якоря по координатам POI.at + интерполяция между ними
  const arcs = stationArcs(route);

  // видимая линия маршрута: идёт СТРОГО по порядку 1→2→3→...→N вдоль реальных
  // дорожек (не общий контур парка целиком, а только те его куски, которые
  // реально пройдены в этой последовательности — включая повторные проходы,
  // если маршрут возвращается через уже пройденное место)
  const line = document.createElementNS(SVGNS,'path');
  line.setAttribute('d', buildSequenceLine(arcs));
  line.setAttribute('class','rt-line');
  line.setAttribute('stroke', route.color);
  line.setAttribute('stroke-width','13');
  line.setAttribute('opacity','0.95');
  layer.appendChild(line);

  const span = arcs[n-1] - arcs[0];
  const at = f => arcs[0] + f*span;

  // вспомогательные (отдых / пульс) — расставлены по длине ПРОЙДЕННОГО маршрута,
  // а не всего кольца, чтобы всегда лежать на видимой линии
  const icons = [
    {t:0.16, type:'rest'}, {t:0.46, type:'pulse'}, {t:0.74, type:'rest'}, {t:0.90, type:'rest'}
  ].slice(0, route.rest>=6?4:3);
  icons.forEach(ic=>{
    const P = normalPoint(at(ic.t), OFF);
    const g = document.createElementNS(SVGNS,'g');
    g.setAttribute('class','rt-icon '+(ic.type==='pulse'?'pulse':''));
    g.innerHTML = `<circle cx="${P.x}" cy="${P.y}" r="${IC}"/>`;
    const sym = ic.type==='pulse'
      ? `<path d="M${P.x-11},${P.y} h6 l3,-8 l3,15 l3,-7 h6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M${P.x-9},${P.y+6} v-9 M${P.x+9},${P.y+6} v-9 M${P.x-11},${P.y-3} h22 M${P.x-11},${P.y+1} h22" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
    g.innerHTML += sym;
    layer.appendChild(g);
  });

  // пронумерованные точки: сплошные — координата подтверждена планом,
  // пунктирные — точной привязки нет, положение оценено по соседним станциям.
  // Если станция физически совпадает с уже показанной (например, вход = старт
  // и финиш одного и того же маршрута), её сдвигаем в сторону, чтобы обе метки
  // было видно — иначе одна полностью перекрывает другую.
  //
  // Некоторые подтверждённые точки (Леся, Ротонда, Чёрное море, Спортгородок)
  // стоят заметно В СТОРОНЕ от единственной прочерченной трассы — это значит,
  // к ним ведёт отдельная дорожка-ответвление, которой нет в исходных данных.
  // Вместо того чтобы врать и притягивать такую точку прямо на трассу, рисуем
  // короткое боковое ответвление (spur) от трассы к её настоящей координате.
  const SPUR_MIN = 55; // px — от такого расстояния считаем, что точка не на трассе
  const placed = [];
  for(let i=0;i<n;i++){
    const trailPt = pointAtLength(arcs[i]);
    const pid = route.pois[i];
    const poi = POI[pid];
    const confirmed = !!poi.at;
    let pt = trailPt;
    let spurFrom = null;

    if(confirmed){
      const dOff = Math.hypot(poi.at[0]-trailPt.x, poi.at[1]-trailPt.y);
      if(dOff > SPUR_MIN){ pt = { x:poi.at[0], y:poi.at[1] }; spurFrom = trailPt; }
    }
    let tries = 0;
    while(placed.some(q => Math.hypot(q.x-pt.x, q.y-pt.y) < R*1.7) && tries<6){
      const nb = normalPoint(arcs[i], R*1.8*(tries+1));
      pt = spurFrom ? { x: pt.x + (nb.x-trailPt.x)*0.4, y: pt.y + (nb.y-trailPt.y)*0.4 } : { x: nb.x, y: nb.y };
      tries++;
    }
    placed.push(pt);

    if(spurFrom){
      const spur = document.createElementNS(SVGNS,'path');
      spur.setAttribute('d', `M${spurFrom.x.toFixed(1)},${spurFrom.y.toFixed(1)} L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
      spur.setAttribute('class','rt-spur');
      spur.setAttribute('stroke', route.color);
      layer.appendChild(spur);
    }

    const g = document.createElementNS(SVGNS,'g');
    g.setAttribute('class','rt-marker'+(confirmed?'':' rt-marker-est'));
    g.setAttribute('data-i', i);
    g.innerHTML =
      `<circle class="bg" cx="${pt.x}" cy="${pt.y}" r="${R}" stroke="${route.color}" stroke-width="5"
         stroke-dasharray="${confirmed?'none':'5,4'}" fill-opacity="${confirmed?1:0.75}"></circle>
       <text x="${pt.x}" y="${pt.y}" style="font-size:28px">${i+1}</text>`;
    g.addEventListener('click', ()=>openPOI(route, i, true));
    g.addEventListener('mouseenter', ()=>{ highlightStationRow(i,true); });
    g.addEventListener('mouseleave', ()=>{ highlightStationRow(i,false); });
    layer.appendChild(g);
  }

  // «вы здесь»
  const here = pointAtLength(at(0.22));
  const hg = document.createElementNS(SVGNS,'g');
  hg.setAttribute('class','rt-here');
  hg.innerHTML = `<circle class="pulsering" cx="${here.x}" cy="${here.y}" r="20" style="transform-origin:${here.x}px ${here.y}px"/>
                  <circle class="pulsecore" cx="${here.x}" cy="${here.y}" r="13" stroke="#fff" stroke-width="4"/>`;
  layer.appendChild(hg);
}

/* Строит путь, который проходит РЕАЛЬНЫЕ дорожки между станциями строго по
   порядку 1→2→3→...→N (а не общий контур парка целиком) — берём отрезки
   трека между соседними станциями, сэмплируя его через каждые ~40px. */
function buildSequenceLine(arcs){
  const pts = [];
  for(let i=0;i<arcs.length-1;i++){
    const a = arcs[i], b = arcs[i+1];
    const dist = Math.max(0, b-a);
    const steps = Math.max(1, Math.round(dist/40));
    for(let s=0;s<steps;s++) pts.push(pointAtLength(a + dist*(s/steps)));
  }
  pts.push(pointAtLength(arcs[arcs.length-1]));
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for(let k=1;k<pts.length;k++) d += ` L${pts[k].x.toFixed(1)},${pts[k].y.toFixed(1)}`;
  return d;
}

/* Позиции станций вдоль трека: станции с известной реальной координатой (POI.at)
   ставятся ровно на неё (одна и та же точка — всегда в одном и том же месте
   на любом маршруте), остальные — равномерно интерполируются между соседними
   станциями-«якорями» по порядку следования, а не по доле всего кольца. */
function stationArcs(route){
  const L = TRAIL.L;
  const n = route.pois.length;
  const arcs = new Array(n).fill(null);
  const BACK_TOL = 0.08*L; // маленький локальный откат назад (напр. мостик у пруда,
                            // порядок в таблице обратный геометрии) — это нормально,
                            // не значит «обойти весь парк ещё раз»

  const anchoredIdx = [];
  for(let i=0;i<n;i++){
    const p = POI[route.pois[i]];
    if(!p.at) continue;
    const raw = nearestLen(p.at);
    if(anchoredIdx.length===0){
      arcs[i] = raw;
    } else {
      const prevArc = arcs[anchoredIdx[anchoredIdx.length-1]];
      const prevMod = ((prevArc % L)+L) % L;
      const fwd  = ((raw - prevMod) % L + L) % L;
      const back = ((prevMod - raw) % L + L) % L;
      arcs[i] = back <= BACK_TOL ? prevArc + 0.15*BACK_TOL : prevArc + fwd;
    }
    anchoredIdx.push(i);
  }
  if(anchoredIdx.length===0){
    for(let i=0;i<n;i++) arcs[i] = (i/n)*L;
    return arcs;
  }

  const first = anchoredIdx[0], last = anchoredIdx[anchoredIdx.length-1];
  // хвосты: от начала маршрута до первого якоря и от последнего якоря до конца —
  // интерполируем через «шов» кольца (последний якорь → +L → первый якорь)
  if(first>0 || last<n-1){
    const startArc = arcs[last], endArc = arcs[first] + L;
    const steps = (n-1-last) + first + 1;
    let k=1;
    for(let i=last+1;i<n;i++){ arcs[i] = startArc + (endArc-startArc)*(k/steps); k++; }
    for(let i=0;i<first;i++){ arcs[i] = startArc + (endArc-startArc)*(k/steps); k++; }
  }
  // интерполяция между соседними якорями
  for(let k=0;k<anchoredIdx.length-1;k++){
    const iA = anchoredIdx[k], iB = anchoredIdx[k+1];
    const gap = iB - iA;
    for(let i=iA+1;i<iB;i++) arcs[i] = arcs[iA] + (arcs[iB]-arcs[iA]) * ((i-iA)/gap);
  }

  // ВАЖНО: значения НЕ заворачиваем по модулю L здесь — для длинных маршрутов
  // (напр. «Полный круг») путь проходит больше одного круга, и разница между
  // соседними станциями (arcs[i+1]-arcs[i]) должна оставаться настоящим
  // пройденным расстоянием, а не запутываться в «где именно на кольце».
  // Модуль берём только там, где нужна точка на кривой (getPointAtLength).
  return arcs;
}

/* точка со смещением по нормали (для боковых иконок), считается по TRAIL-кэшу */
function normalPoint(len, off){
  const L = TRAIL.L;
  len = ((len % L) + L) % L;
  const a = pointAtLength(len-1);
  const b = pointAtLength(len+1);
  let nx = -(b.y-a.y), ny = (b.x-a.x);
  const m = Math.hypot(nx,ny)||1; nx/=m; ny/=m;
  const p = pointAtLength(len);
  // наружу от центра
  if((p.x-CENTER.x)*nx + (p.y-CENTER.y)*ny < 0){ nx=-nx; ny=-ny; }
  return { x:p.x+nx*off, y:p.y+ny*off };
}

/* ---------- подсветка ---------- */
function highlightMarker(i,on){
  const m = $(`#routeLayer .rt-marker[data-i="${i}"] circle.bg`);
  if(m) m.setAttribute('r', on?'40':'30');
}
function highlightStationRow(i,on){
  const row = $(`.station[data-i="${i}"]`);
  if(row) row.classList.toggle('is-hi', on);
  highlightMarker(i,on);
}

/* ---------- POI popup ---------- */
let popupRoute = null, popupIndex = 0;
function openPOI(route, i, scroll){
  popupRoute = route; popupIndex = i;
  const p = POI[route.pois[i]];
  $('#poiBadge').textContent = p.cat;
  $('#poiStation').textContent = `Станция ${i+1} из ${route.pois.length}`;
  $('#poiName').textContent = p.name;
  $('#poiSub').textContent = p.sub || '';
  $('#poiSub').style.display = p.sub ? '' : 'none';
  $('#poiDesc').textContent = p.desc;
  const estEl = $('#poiEstimate');
  estEl.hidden = !!p.at;
  $('#poiPopup').hidden = false;
  $('#poiPrev').disabled = i===0;
  $('#poiNext').disabled = i===route.pois.length-1;
  // подсветка выбранной точки
  $$('#routeLayer .rt-marker circle.bg').forEach(c=>c.setAttribute('r','30'));
  highlightMarker(i,true);
  // синхронизируем мобильный слайдер станций, если открыт этот же маршрут
  if(sliderRoute===route){ sliderIndex=i; updateSlider(); }
}
$('#poiClose').addEventListener('click', ()=>{ $('#poiPopup').hidden = true; });
$('#poiPrev').addEventListener('click', ()=>{ if(popupRoute && popupIndex>0) openPOI(popupRoute, popupIndex-1, false); });
$('#poiNext').addEventListener('click', ()=>{ if(popupRoute && popupIndex<popupRoute.pois.length-1) openPOI(popupRoute, popupIndex+1, false); });

/* ---------- выбор маршрута ---------- */
function selectRoute(id){
  activeRoute = id;
  const route = ROUTES.find(r=>r.id===id);
  renderList();
  renderDetail(route);
  drawRoute(route);
  renderStationSlider(route);
  $('#poiPopup').hidden = true;
  $('#mapEmpty').style.display = 'none';
  $('#mapTitle').textContent = route.name;
  $('#mapSub').textContent = `${route.terrenkur} · ${route.pois.length} точек`;
  $('#mapFoot').hidden = false;
  $('#mapFootStats').innerHTML = `
    <div><b>${route.distance}</b><span>расстояние</span></div>
    <div><b>${route.duration.replace('около ','~')}</b><span>время</span></div>
    <div><b>${route.pois.length}</b><span>точек</span></div>
    <div><b>${route.rest}</b><span>остановки</span></div>`;

  // прокрутка к детали на мобильном
  if(window.matchMedia('(max-width:900px)').matches){
    $('#routeDetail').scrollIntoView({behavior:'smooth', block:'start'});
  }
}

$('#startBtn').addEventListener('click', ()=>{
  const route = ROUTES.find(r=>r.id===activeRoute);
  if(route) openPOI(route, 0, true);
});

/* ---------- фильтры / сортировка ---------- */
$('#filterChips').addEventListener('click', e=>{
  const b = e.target.closest('.chip'); if(!b) return;
  $$('#filterChips .chip').forEach(c=>c.classList.remove('is-on'));
  b.classList.add('is-on');
  state.filter = b.dataset.filter;
  renderList();
});
$('#sortChips').addEventListener('click', e=>{
  const b = e.target.closest('.chip'); if(!b) return;
  $$('#sortChips .chip').forEach(c=>c.classList.remove('is-on'));
  b.classList.add('is-on');
  state.sort = b.dataset.sort;
  renderList();
});


/* ---------- навигация: активный пункт ---------- */
const navLinks = $$('.topnav a, .bottomnav a');
const secs = ['home','routes','map','about'];
const io = new IntersectionObserver(entries=>{
  entries.forEach(en=>{
    if(en.isIntersecting){
      const id = en.target.id;
      navLinks.forEach(a=>a.classList.toggle('is-active', a.getAttribute('href')==='#'+id));
    }
  });
},{rootMargin:'-45% 0px -50% 0px'});
secs.forEach(id=>{ const el=document.getElementById(id); if(el) io.observe(el); });

/* ---------- фокус карты на зоне маршрутов ---------- */
(function focusMap(){
  const xs = PLANMAP.loop.map(p=>p[0]), ys = PLANMAP.loop.map(p=>p[1]);
  const padX = (Math.max(...xs)-Math.min(...xs))*0.14;
  const padY = (Math.max(...ys)-Math.min(...ys))*0.12;
  const x0 = Math.min(...xs)-padX, y0 = Math.min(...ys)-padY;
  const w = (Math.max(...xs)-Math.min(...xs))+padX*2;
  const h = (Math.max(...ys)-Math.min(...ys))+padY*2;
  $('#parkMap').setAttribute('viewBox', `${x0.toFixed(0)} ${y0.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}`);
})();

/* ---------- старт ---------- */
renderList();
selectRoute('t2');   // маршрут по умолчанию — «Вода и история»

/* ---------- лёгкий параллакс фото в hero по движению мыши ---------- */
(function heroParallax(){
  const hero = $('.hero'), img = $('.hero-bg-img');
  if(!hero || !img || window.matchMedia('(pointer:coarse)').matches) return;
  const MAX_X = 22, MAX_Y = 14; // px — амплитуда сдвига, лёгкая, не навязчивая
  hero.addEventListener('mousemove', e=>{
    const r = hero.getBoundingClientRect();
    const px = (e.clientX - r.left)/r.width - 0.5;
    const py = (e.clientY - r.top)/r.height - 0.5;
    img.style.transform = `scale(1.09) translate3d(${(-px*MAX_X).toFixed(1)}px, ${(-py*MAX_Y).toFixed(1)}px, 0)`;
  });
  hero.addEventListener('mouseleave', ()=>{
    img.style.transform = 'scale(1.09) translate3d(0,0,0)';
  });
})();
