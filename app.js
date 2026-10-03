/* A local, static travel map. Coordinates and route geometries are WGS84. */
(() => {
  'use strict';
  const D=window.TRIP_DATA,C=window.TripCore,$=id=>document.getElementById(id);
  const points=D.points,byId=new Map(points.map(p=>[p.id,p]));
  const state={selected:'H6',scene:'all',filter:'all',search:'',origin:'班',destination:'H6',pick:null,request:0};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=s=>typeof s==='string'&&/^https?:\/\//.test(s)?s:'#';
  const link=(href,text)=>url(href)==='#'?`<span>${esc(href||text)}</span>`:`<a href="${esc(url(href))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const group=p=>p.type==='attraction'?'attraction':p.type==='hotel'?'hotel':'special';
  const badge=p=>p.badge||p.rank||'点';
  const kind=p=>({attraction:'景点',hotel:'住宿安排',campus:'大学校区',transport:'交通枢纽',personal:'会合地点'}[p.type]||'特别地点');
  const coordinate=p=>[p.lat,p.lon];
  const safeStorage={get:k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
  const saved=safeStorage.get('chaoshan-map-choice-v2');
  if(saved){for(const k of ['selected','origin','destination'])if(byId.has(saved[k]))state[k]=saved[k];if(D.scenes.some(s=>s.id===saved.scene))state.scene=saved.scene;}
  const save=()=>safeStorage.set('chaoshan-map-choice-v2',{selected:state.selected,scene:state.scene,origin:state.origin,destination:state.destination});
  const map=L.map('map',{zoomControl:false,minZoom:8,maxZoom:18,scrollWheelZoom:true,preferCanvas:true}).setView([23.65,116.7],10);
  L.control.zoom({position:'topright'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  map.attributionControl.setPrefix(false);
  const displayRegion=D.displayRegion||D.boundaries;
  const regionLayer=L.geoJSON(displayRegion,{style:f=>({color:'#9aafa3',weight:1,fillColor:{潮州:'#ecf1e7',汕头:'#eff0e3'}[f.properties.city]||'#e8eee5',fillOpacity:.7,fillRule:'evenodd'}),interactive:false}).addTo(map);
  const bounds=regionLayer.getBounds();map.setMaxBounds(bounds.pad(.12));
  map.createPane('streets');map.getPane('streets').style.zIndex=210;
  const tiles=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{pane:'streets',maxNativeZoom:18,maxZoom:18,bounds:bounds.pad(.03),attribution:'Tiles © Esri · HERE · Garmin · © OpenStreetMap contributors',keepBuffer:1}).addTo(map);
  let tileErrors=0,anyTile=false;
  tiles.on('tileload',()=>{anyTile=true;});tiles.on('tileerror',()=>{tileErrors++;if(tileErrors===8&&!anyTile)notice('街道底图暂时不可用，仍可查看地点、边界与距离。');});
  // Erase each polygon separately: overlap is a union, never an even-odd hole.
  // The mask also clips route lines outside the requested map extent.
  map.createPane('regionMask');map.getPane('regionMask').style.zIndex=450;map.getPane('regionMask').style.pointerEvents='none';
  const projectedRegions=new Map();
  function maskPolygons(zoom){
    if(!projectedRegions.has(zoom))projectedRegions.set(zoom,displayRegion.features.flatMap(f=>{
      const polys=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
      return polys.map(poly=>poly.map(ring=>ring.map(([lon,lat])=>map.project([lat,lon],zoom))));
    }));
    return projectedRegions.get(zoom);
  }
  const regionMask=L.gridLayer({pane:'regionMask',tileSize:256,keepBuffer:1,updateWhenIdle:true});
  regionMask.createTile=function(coords){
    const tile=document.createElement('canvas'),size=this.getTileSize(),ctx=tile.getContext('2d');tile.width=size.x;tile.height=size.y;
    ctx.fillStyle='#edf0e9';ctx.fillRect(0,0,size.x,size.y);ctx.globalCompositeOperation='destination-out';
    for(const poly of maskPolygons(coords.z)){
      ctx.beginPath();for(const ring of poly){ring.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x-coords.x*size.x,p.y-coords.y*size.y));ctx.closePath();}
      ctx.fill('evenodd');
    }
    return tile;
  };
  regionMask.addTo(map);
  const labelLayer=L.layerGroup().addTo(map),markerLayer=L.layerGroup().addTo(map),routeLayer=L.layerGroup().addTo(map),selectionLayer=L.layerGroup().addTo(map);
  let lastRouteBounds=null,customCount=0,routeController=null;
  const routeCache=new Map();
  for(const f of D.routes.features){const p=f.properties;if(p.fromId&&p.toId)routeCache.set(`${p.fromId}|${p.toId}`,{km:p.km,minutes:p.ideal_minutes,geometry:f.geometry,kind:'saved',snap:Math.max(...(p.snap_m||[0]))});}
  function notice(text){$('mapNotice').textContent=text;$('mapNotice').hidden=false;}
  function clearNotice(){$('mapNotice').hidden=true;}
  const currentScene=()=>D.scenes.find(s=>s.id===state.scene)||D.scenes[0];
  function scenePoints(){return points.filter(p=>currentScene().pointIds.includes(p.id)||p.type==='custom');}
  function filtered(){return scenePoints().filter(p=>(state.filter==='all'||group(p)===state.filter)&&(!state.search||`${p.name} ${p.zone} ${p.summary}`.toLowerCase().includes(state.search)));}
  function renderList(){
    const list=filtered();$('placeCount').textContent=`${list.length} 个地点`;
    let section='';$('placesList').innerHTML=list.map(p=>{let head='';const s=group(p);if(s!==section){section=s;head=`<div class="list-section">${s==='attraction'?'风景与散步':s==='hotel'?'住宿落脚处':'会合与交通'}</div>`;}return head+`<button class="place-row ${state.selected===p.id?'selected':''}" data-place="${esc(p.id)}" aria-label="查看${esc(p.name)}" ${state.selected===p.id?'aria-current="true"':''}><span class="place-num ${s}">${badge(p)}</span><span class="place-copy"><strong>${esc(p.name)}</strong><small>${esc(p.zone)}${p.duration?' · '+esc(p.duration):''}</small></span></button>`;}).join('')||'<p class="empty">没有匹配地点，试试其他关键词。</p>';
    $('placesList').querySelectorAll('[data-place]').forEach(btn=>btn.addEventListener('click',()=>selectPlace(btn.dataset.place,true)));
  }
  function renderMarkers(){
    markerLayer.clearLayers();labelLayer.clearLayers();
    const visible=filtered(),clusters=new Map(),z=map.getZoom();
    visible.forEach(p=>{const xy=map.latLngToContainerPoint(coordinate(p));const key=z<15&&p.id!==state.selected?`${Math.floor(xy.x/42)},${Math.floor(xy.y/42)}`:p.id;const g=clusters.get(key)||[];g.push(p);clusters.set(key,g);});
    clusters.forEach(g=>{
      if(g.length>1){const lat=g.reduce((s,p)=>s+p.lat,0)/g.length,lon=g.reduce((s,p)=>s+p.lon,0)/g.length;const marker=L.marker([lat,lon],{icon:L.divIcon({className:'',html:`<span class="map-marker cluster">${g.length}</span>`,iconSize:[36,36],iconAnchor:[18,18]}),title:g.map(p=>p.name).join('、'),keyboard:true}).addTo(markerLayer);marker.on('click',()=>map.fitBounds(L.latLngBounds(g.map(coordinate)).pad(.45),{maxZoom:16}));marker.bindTooltip(g.map(p=>p.name).slice(0,4).join(' · '));return;}
      const p=g[0],marker=L.marker(coordinate(p),{icon:L.divIcon({className:'',html:`<span class="map-marker ${group(p)} ${p.id===state.selected?'selected':''}">${badge(p)}</span>`,iconSize:[30,30],iconAnchor:[15,15]}),title:p.name,keyboard:true}).addTo(markerLayer);
      marker.bindTooltip(p.name,{direction:'top',offset:[0,-13],permanent:p.id===state.selected||z>=15});marker.on('click',()=>{if(state.pick)setCustomChoice(p);else selectPlace(p.id,false);});
    });
    if(z<12){for(const f of D.boundaries.features){const c=f.properties.center;if(c)L.marker([c[1],c[0]],{icon:L.divIcon({className:'region-label',html:esc(f.properties.name),iconSize:[90,20],iconAnchor:[45,10]}),interactive:false}).addTo(labelLayer);}}
    selectionLayer.clearLayers();const p=byId.get(state.selected);if(p?.approximate&&p.uncertainty_m)L.circle(coordinate(p),{radius:p.uncertainty_m,color:'#416583',weight:1,dashArray:'4 5',fillOpacity:.06,interactive:false}).addTo(selectionLayer);
  }
  function renderDetail(){
    const p=byId.get(state.selected),photo=p.photo,t=p.ticket||{},heading=p.name,photoPath=photo?.local||photo?.url;
    const picture=photoPath?`<figure class="photo-block"><img id="placePhoto" src="${esc(photoPath)}" alt="${esc(photo.title||heading+'实景')}" referrerpolicy="no-referrer"><figcaption class="photo-caption"><span>${esc(photo.title||heading+'实景')}</span>${link(photo.source||p.source,'图片来源 ↗')}</figcaption></figure>`:`<div class="photo-missing"><strong>${esc(heading)}</strong><span>${esc(photo?.note||'暂无已核实的公开实景照片。')}</span></div>`;
    const priceLabel=t.label||'以实际安排为准';const priceSub=[t.status,t.note||t.detail].filter(Boolean).join('；');
    let alert=p.alert||'';if(p.id==='班')alert='10 月 6 日 09:00–09:30 交接；4 日 17:30 下班。';if(p.id==='家')alert='片区估点，不代表家庭门牌或建筑入口。';if(p.requiresBoat)alert='涉及渡船，图中直线距离不代表海上航线。船班和费用需另行确认。';
    $('detailPanel').innerHTML=picture+`<div class="detail-body"><div class="detail-eyebrow"><span>${esc(kind(p))}</span>${esc(p.zone)}</div><h2>${esc(heading)}</h2><p class="detail-summary">${esc(p.summary)}</p><div class="detail-buttons"><button id="useOrigin">设为起点</button><button id="useDestination">设为终点</button><a class="navigation-button" href="${esc(C.navigationUrl(p))}" target="_blank" rel="noopener noreferrer">${esc(p.navigationLabel||'去导航 ↗')}</a></div>${alert?`<p class="alert-note">${esc(alert)}</p>`:''}<dl class="detail-facts"><div class="fact-row"><dt>${p.type==='hotel'?'住宿':'门票'}</dt><dd>${esc(priceLabel)}${priceSub?`<small>${esc(priceSub)}</small>`:''}${t.source?`<small>${link(t.source,'票务来源 ↗')} · ${esc(t.checkedAt||D.checkedAt)} 核查</small>`:''}</dd></div><div class="fact-row"><dt>${p.type==='hotel'?'入住':'开放'}</dt><dd>${esc(p.hours)}</dd></div><div class="fact-row"><dt>${p.type==='attraction'?'游玩':'安排'}</dt><dd>${esc(p.duration)}</dd></div></dl><section class="detail-section"><h3>${p.type==='attraction'?'怎么逛':'与你的行程有关'}</h3><ul class="tips-list">${(p.tips||[]).map(tip=>`<li>${esc(tip)}</li>`).join('')||`<li>${esc(p.note||'按实际出发时间安排。')}</li>`}</ul></section><p class="location-meta">${esc(p.accuracy)}${p.approximate?' · 位置为片区估点':''}<br>${p.lat.toFixed(5)}° N · ${p.lon.toFixed(5)}° E</p><div class="sources">${link(p.source,'地点资料 ↗')}${photo?.source?link(photo.source,'实景出处 ↗'):''}${p.extraSource?link(p.extraSource,'补充说明 ↗'):''}</div></div>`;
    const image=$('placePhoto');if(image)image.addEventListener('error',()=>{image.parentElement.innerHTML=`<div class="photo-missing"><strong>${esc(heading)}</strong><span>照片暂时加载失败，可打开原图来源查看。</span>${link(photo.source||p.source,'查看实景来源 ↗')}</div>`;},{once:true});
    if(photo?.credit){const credit=document.createElement('p');credit.className='location-meta';credit.textContent=`照片：${photo.credit}。${photo.license||''}`;$('detailPanel').querySelector('.detail-body').append(credit);}
    const moreSources=[p.hoursSource,p.noticeSource,...(p.sources||[])].filter(Boolean);if(moreSources.length){const extra=document.createElement('div');extra.className='sources';extra.innerHTML=[...new Set(moreSources)].map((s,i)=>link(s,`补充资料 ${i+1} ↗`)).join('');$('detailPanel').querySelector('.detail-body').append(extra);}
    $('useOrigin').onclick=()=>setEndpoint('origin',p.id);$('useDestination').onclick=()=>setEndpoint('destination',p.id);
  }
  function selectPlace(id,pan){if(!byId.has(id))return;state.selected=id;renderList();renderDetail();renderMarkers();save();if(pan){const p=byId.get(id);map.setView(coordinate(p),Math.max(map.getZoom(),13),{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});}if(innerWidth<=940)$('detailPanel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
  function optionList(){return points.map(p=>`<option value="${esc(p.id)}">${p.rank?p.rank+' · ':''}${esc(p.name)}</option>`).join('');}
  function renderSelects(){for(const id of ['origin','destination']){$(id).innerHTML=optionList();$(id).value=state[id];}}
  function setEndpoint(field,id){state[field]=id;$(field).value=id;save();compare();}
  function formatKm(km){return km<1?(km*1000).toFixed(0)+' m':km.toFixed(1)+' km';}
  function formatTime(m){return m<60?Math.round(m)+' 分钟':Math.floor(m/60)+' 小时 '+Math.round(m%60)+' 分钟';}
  function drawConnection(a,b,route){routeLayer.clearLayers();const dashed=L.polyline([coordinate(a),coordinate(b)],{color:'#526b7c',weight:2,dashArray:'6 7',opacity:.7}).addTo(routeLayer);if(route?.geometry)L.geoJSON(route.geometry,{style:{color:'#bd6e39',weight:5,opacity:.9},interactive:false}).addTo(routeLayer);for(const [p,label]of [[a,'起'],[b,'终']])L.circleMarker(coordinate(p),{radius:6,color:'white',weight:2,fillColor:label==='起'?'#1e5e52':'#bd6e39',fillOpacity:1}).addTo(routeLayer).bindTooltip(`${label} · ${p.name}`,{direction:'top'});lastRouteBounds=route?.geometry?L.geoJSON(route.geometry).getBounds():dashed.getBounds();}
  function renderDistance(a,b,route,status){
    const straight=C.distance(a,b),offroad=route?.snap>100;
    $('distanceResult').innerHTML=`<div class="metric"><span class="metric-label">${route?(offroad?'附近道路间':'驾车路程'):'直线距离'}</span><b>${formatKm(route?route.km:straight)}</b></div>${route?`<div class="metric secondary"><span class="metric-label">直线</span><b>${formatKm(straight)}</b></div>`:''}`;
    $('routeState').textContent=status;
    let note=route?`基础车程约 ${formatTime(route.minutes)}；国庆需另留拥堵与停车时间。`:'';
    if(a.id===b.id)note='起点与终点是同一地点。';
    else if(a.noDrivingEndpoint||b.noDrivingEndpoint)note='山顶 / 茶山图钉不是机动车入口，只显示直线参考。先向景区或酒店确认可走道路、停车、索道与接驳。';
    else if(!C.routeAllowed(a,b))note='需要其他接驳，不提供全程驾车估算。';
    else if(!route)note='直线距离只用于判断远近，不代表公路、步行或渡船里程。';
    else if(!route.geometry)note+=' 公路距离已存档，虚线仅连接位置；在线加载后显示道路走向。';
    if(a.type==='transport'&&b.type==='transport')note+=' 这是驾车比较，不是铁路里程、列车时长或车次。';
    if(a.id==='班'&&b.id==='H6')note+=' 4 日会合地点另约，支行仅为参考起点。';
    if(offroad)note+=` 图钉与可驾车道路最大偏差约 ${Math.round(route.snap)} 米，未计入这段接驳；道路实线端点为路网起终点。`;
    const approximate=[...new Set([a,b].filter(p=>p.approximate).map(p=>p.name))];
    if(approximate.length)note+=` ${approximate.join('、')}为估点，实际入口需确认。`;
    $('routeNote').textContent=note;$('routeNavigation').href=C.navigationUrl(b);$('routeNavigation').textContent=b.navigationLabel||'去高德查终点与导航 ↗';drawConnection(a,b,route);
  }
  async function compare(){
    state.origin=$('origin').value;state.destination=$('destination').value;save();
    const a=byId.get(state.origin),b=byId.get(state.destination);if(!a||!b)return;
    const token=++state.request;if(routeController)routeController.abort();clearNotice();
    if(a.id===b.id){renderDistance(a,b,{km:0,minutes:0},'同一地点');return;}
    if(!C.routeAllowed(a,b)){renderDistance(a,b,null,a.noDrivingEndpoint||b.noDrivingEndpoint?'山顶 / 片区 · 仅比较直线':'仅比较直线');return;}
    const key=`${a.id}|${b.id}`,known=routeCache.get(key)||C.matrixValue(window.DISTANCE_MATRIX,a,b);
    if(known?.geometry){renderDistance(a,b,known,'公路估算 · 非实时路况');return;}
    renderDistance(a,b,known,known?'公路估算已显示 · 加载道路走向…':'正在查询公路距离…');
    const controller=new AbortController();routeController=controller;const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const endpoint=`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&alternatives=false&steps=true`;
      const response=await fetch(endpoint,{signal:controller.signal});if(!response.ok)throw new Error('route unavailable');
      const data=await response.json(),route=C.validateRoute(data,a,b);if(!route)throw new Error('no reliable road connection');
      if(token!==state.request)return;if(route.ferry){renderDistance(a,b,null,'路线涉及渡船 · 仅显示直线');$('routeNote').textContent='路网结果含渡船，不作为全程驾车距离。请另核实码头、往返船班和费用。';return;}routeCache.set(key,route);renderDistance(a,b,route,'公路估算 · 非实时路况');
    }catch(error){if(token!==state.request)return;renderDistance(a,b,known,known?'已保存公路估算 · 线路暂不可加载':'公路查询暂不可用 · 已显示直线');}finally{clearTimeout(timeout);}
  }
  function renderScene(){
    const scene=currentScene(),nav=byId.get(scene.navigationId);
    $('sceneTabs').innerHTML=D.scenes.map(s=>`<button data-scene="${esc(s.id)}" aria-pressed="${s.id===state.scene}">${esc(s.label)}</button>`).join('');
    $('sceneTabs').querySelectorAll('[data-scene]').forEach(btn=>btn.onclick=()=>selectScene(btn.dataset.scene));
    $('sceneSummary').innerHTML=`<div class="scene-intro"><span class="journal-date">${esc(scene.date)}</span><h2>${esc(scene.title)}</h2><p>${esc(scene.subtitle)}</p></div><div class="scene-plan"><ol class="scene-steps">${scene.steps.map((step,i)=>`<li><button data-step="${esc(step.pointId)}"><span class="step-number">${String(i+1).padStart(2,'0')}</span><span><small>${esc(step.time)}</small><strong>${esc(step.text)}</strong></span></button></li>`).join('')}</ol><p class="scene-advice"><span>这一页的提醒</span>${esc(scene.advice)}</p><div class="scene-actions">${nav?`<a href="${esc(C.navigationUrl(nav))}" target="_blank" rel="noopener noreferrer">去导航 · ${esc(nav.name.split('｜')[0])} ↗</a>`:''}${scene.extraPoint?`<button data-step="${esc(scene.extraPoint)}">看看附近的中山公园 →</button>`:''}${scene.ticketLink?'<a href="https://www.12306.cn/" target="_blank" rel="noopener noreferrer">到 12306 查车票 ↗</a>':''}${scene.source?link(scene.source.url,scene.source.label):''}</div></div>`;
    $('sceneSummary').querySelectorAll('[data-step]').forEach(btn=>btn.onclick=()=>selectPlace(btn.dataset.step,true));
  }
  function fitScene(){const visible=scenePoints().filter(p=>p.type!=='custom');if(visible.length)map.fitBounds(L.latLngBounds(visible.map(coordinate)),{padding:[35,35],maxZoom:14});}
  function selectScene(id){
    const scene=D.scenes.find(s=>s.id===id);if(!scene)return;
    state.scene=id;state.filter='all';state.search='';state.pick=null;state.selected=scene.focusId;state.origin=scene.origin;state.destination=scene.destination;$('search').value='';
    for(const id of ['pickStart','pickEnd'])$(id).setAttribute('aria-pressed','false');
    document.querySelectorAll('[data-filter]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.filter==='all')));
    document.querySelectorAll('[data-view]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.view==='trip')));
    renderScene();renderSelects();renderList();renderDetail();fitScene();renderMarkers();compare();save();
  }
  function pointInRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi))inside=!inside;}return inside;}
  function insideRegion(lon,lat){return displayRegion.features.some(f=>{const polys=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];return polys.some(poly=>pointInRing(lon,lat,poly[0])&&!poly.slice(1).some(h=>pointInRing(lon,lat,h)));});}
  function setCustomChoice(p){const field=state.pick;if(!field)return;if(!byId.has(p.id)){points.push(p);byId.set(p.id,p);renderSelects();}state.pick=null;clearNotice();$('pickStart').setAttribute('aria-pressed','false');$('pickEnd').setAttribute('aria-pressed','false');setEndpoint(field,p.id);}
  map.on('click',e=>{if(!state.pick)return;if(!insideRegion(e.latlng.lng,e.latlng.lat)){notice('请选择潮州、汕头范围内的位置。');return;}setCustomChoice({id:'custom-'+(++customCount),name:`自选${state.pick==='origin'?'起点':'终点'} ${customCount}`,type:'custom',zone:'地图选点',lon:e.latlng.lng,lat:e.latlng.lat});});
  map.on('zoomend moveend',renderMarkers);
  document.querySelectorAll('[data-filter]').forEach(btn=>btn.onclick=()=>{state.filter=btn.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));renderList();renderMarkers();});
  $('search').oninput=e=>{state.search=e.target.value.trim().toLowerCase();renderList();renderMarkers();};
  document.querySelectorAll('[data-view]').forEach(btn=>btn.onclick=()=>{const v=btn.dataset.view;if(v==='trip')fitScene();else selectScene({phoenix:'d5',huanggang:'d6',south:'depart'}[v]);document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));});
  $('origin').onchange=compare;$('destination').onchange=compare;$('compare').onclick=compare;$('swap').onclick=()=>{[state.origin,state.destination]=[state.destination,state.origin];renderSelects();compare();};
  for(const [id,field]of [['pickStart','origin'],['pickEnd','destination']])$(id).onclick=()=>{state.pick=state.pick===field?null:field;$('pickStart').setAttribute('aria-pressed',String(state.pick==='origin'));$('pickEnd').setAttribute('aria-pressed',String(state.pick==='destination'));if(state.pick)notice(`请在潮州、汕头范围内点击${field==='origin'?'起点':'终点'}，也可点击现有图钉。`);else clearNotice();};
  $('fitRoute').onclick=()=>{if(lastRouteBounds?.isValid())map.fitBounds(lastRouteBounds.pad(.18),{maxZoom:15});};
  $('aboutButton').onclick=()=>$('aboutDialog').showModal();$('closeAbout').onclick=()=>$('aboutDialog').close();$('aboutDialog').onclick=e=>{if(e.target===$('aboutDialog'))$('aboutDialog').close();};
  if(!currentScene().pointIds.includes(state.selected))state.selected=currentScene().focusId;
  renderScene();renderSelects();renderList();renderDetail();fitScene();renderMarkers();compare();
})();
