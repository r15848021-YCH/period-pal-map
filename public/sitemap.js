// 站點地圖：好朋友 Pal（pal.html）與好朋友地圖網頁（index.html）共用
// 底圖用 MapLibre GL + OpenFreeMap 圖磚，兩者都免費、免金鑰。站點資料在 sites.json。
// 地圖載不出來（網路擋掉、舊手機）時，頁面上的文字清單照樣能用。
const ML="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl";
const STYLE={light:"https://tiles.openfreemap.org/styles/positron",dark:"https://tiles.openfreemap.org/styles/dark"};
export const CAMPUS={all:"全部站點",main:"校總區",med:"醫學院區"};
const PITCH=50;

function h(tag,attrs={},...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null)continue;if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v)}for(const k of kids.flat())if(k!=null)e.append(k);return e}

let lib=null;
function loadLib(){
  if(window.maplibregl)return Promise.resolve(window.maplibregl);
  return lib??=new Promise((ok,no)=>{
    document.head.append(h("link",{rel:"stylesheet",href:ML+".css"}));
    const s=h("script",{src:ML+".js"});s.onload=()=>window.maplibregl?ok(window.maplibregl):no(new Error("maplibre"));
    s.onerror=()=>{lib=null;no(new Error("maplibre"))};document.head.append(s);
    setTimeout(()=>no(new Error("timeout")),15e3);
  });
}

// 一棟樓的整體狀態：有可回報的樓層就彙總即時回報；合作站點沒有即時回報，只標示來源
export function siteState(site,status){
  if(!site.locs?.length)return{cls:"s-partner",label:site.src+"・"+site.form,live:false};
  const ss=site.locs.map(status), ok=ss.filter(s=>s.key==="full"||s.key==="low").length;
  if(ok)return{cls:ss.some(s=>s.key==="full")?"s-full":"s-low",label:ok+"/"+ss.length+" 層有庫存",live:true};
  if(ss.every(s=>s.key==="empty"))return{cls:"s-empty",label:"全部用完",live:true};
  return{cls:"s-unk",label:"待確認",live:true};
}

// 站點卡片。compact = 地圖下方「目前選取」的精簡版；floors(site) 由頁面提供各樓層回報列
export function siteCard(site,{status,floors,compact=false,onMap,onMore}){
  const st=siteState(site,status);
  const rows=[["形式",site.form],["時間",site.hours],["合作",site.partner],["提供",site.src]].filter(([,v])=>v);
  return h("article",{class:"site"+(compact?" compact":""),id:compact?null:"site-"+site.id},
    h("div",{class:"site-head"},h("h3",{},site.name),h("span",{class:"pill "+st.cls},st.label)),
    h("p",{class:"site-where"},site.where),
    h("dl",{},...rows.map(([k,v])=>[h("dt",{},k),h("dd",{},v)])),
    !compact&&floors&&site.locs?.length?floors(site):null,
    compact?h("button",{class:"site-go",type:"button",onclick:()=>onMore(site)},site.locs?.length?"看各樓層・回報 ↓":"看文字清單 ↓")
      :h("button",{class:"site-go",type:"button",onclick:()=>onMap(site)},"在地圖上看 ↑"));
}

// 建立一個可重複掛上頁面的地圖（頁面重畫時不必重新載入圖磚）
export function createSiteMap(sites,{status,onPick}){
  const canvas=h("div",{class:"sm-canvas"});
  const msg=h("div",{class:"sm-msg",role:"status"},"地圖載入中…");
  const btn=(label,icon,fn)=>h("button",{type:"button",class:"sm-btn","aria-label":label,title:label,onclick:fn},icon);
  const dimBtn=btn("切換成平面地圖","2D",()=>setPitch(map&&map.getPitch()>5?0:PITCH));
  const ctrls=h("div",{class:"sm-ctrls"},
    h("div",{class:"sm-group"},btn("放大","+",()=>map?.zoomIn()),btn("縮小","−",()=>map?.zoomOut()),
      btn("指北",h("span",{class:"sm-compass","aria-hidden":"true"}),()=>map?.easeTo({bearing:0}))),
    dimBtn,btn("我的位置",h("span",{class:"sm-locate","aria-hidden":"true"}),locate));
  const el=h("div",{class:"sm",role:"region","aria-label":"站點地圖"},canvas,ctrls,msg);
  let map=null,gl=null,failed=false,selected=null,campus="all",me=null;
  const markers=new Map();

  function setPitch(p){if(!map)return;map.easeTo({pitch:p,duration:600});
    try{map.setLayoutProperty("pal-3d","visibility",p>5?"visible":"none")}catch(e){}
    dimBtn.textContent=p>5?"2D":"3D";dimBtn.setAttribute("aria-label",p>5?"切換成平面地圖":"切換成立體地圖");dimBtn.title=dimBtn.getAttribute("aria-label")}
  function bounds(list){const b=new gl.LngLatBounds();list.forEach(s=>b.extend([s.lng,s.lat]));return b}
  function view(k,animate=true){
    campus=k;if(!map)return;
    const list=k==="all"?sites:sites.filter(s=>s.campus===k);
    if(list.length===1)map[animate?"flyTo":"jumpTo"]({center:[list[0].lng,list[0].lat],zoom:17,pitch:map.getPitch()});
    else map.fitBounds(bounds(list),{padding:{top:56,bottom:40,left:40,right:72},maxZoom:17,pitch:map.getPitch(),animate});
  }
  function select(id,{fly=false}={}){
    selected=id;
    for(const[k,m]of markers)m.getElement().setAttribute("aria-pressed",String(k===id));
    const s=sites.find(x=>x.id===id);
    if(s&&map&&fly)map.flyTo({center:[s.lng,s.lat],zoom:Math.max(map.getZoom(),17.5),offset:[0,40]});
    onPick?.(s||null);
  }
  function paint(){
    for(const s of sites){
      const st=siteState(s,status);let m=markers.get(s.id);
      if(!m){
        const pin=h("button",{type:"button",class:"sm-pin",onclick:e=>{e.stopPropagation();select(s.id,{fly:true})}},h("i",{"aria-hidden":"true"}));
        m=new gl.Marker({element:pin,anchor:"bottom"}).setLngLat([s.lng,s.lat]).addTo(map);markers.set(s.id,m);
      }
      const pin=m.getElement();pin.className="sm-pin "+st.cls;
      pin.setAttribute("aria-label",s.name+"，"+st.label);pin.title=s.name;pin.setAttribute("aria-pressed",String(s.id===selected));
    }
  }
  function locate(){
    if(!navigator.geolocation){msg.textContent="這支手機不支援定位。";msg.hidden=false;return}
    navigator.geolocation.getCurrentPosition(p=>{
      if(!map)return;const ll=[p.coords.longitude,p.coords.latitude];
      if(!me)me=new gl.Marker({element:h("div",{class:"sm-me","aria-label":"你的位置"})}).setLngLat(ll).addTo(map);else me.setLngLat(ll);
      map.flyTo({center:ll,zoom:Math.max(map.getZoom(),16.5)});msg.hidden=true;
    },()=>{msg.textContent="沒有取得位置權限，可以在瀏覽器或 LINE 的設定裡允許定位。";msg.hidden=false;setTimeout(()=>msg.hidden=true,5e3)},{enableHighAccuracy:true,timeout:1e4});
  }
  function chinese(){ // 底圖地名改成優先顯示中文
    for(const l of map.getStyle().layers){
      if(l.type!=="symbol")continue;const tf=map.getLayoutProperty(l.id,"text-field");
      if(tf&&JSON.stringify(tf).includes("name"))map.setLayoutProperty(l.id,"text-field",["coalesce",["get","name:zh-Hant"],["get","name:zh"],["get","name"]]);
    }
  }
  function add3d(dark){
    const src=Object.entries(map.getStyle().sources).find(([,v])=>v.type==="vector")?.[0];if(!src)return;
    const first=map.getStyle().layers.find(l=>l.type==="symbol")?.id;
    map.addLayer({id:"pal-3d",type:"fill-extrusion",source:src,"source-layer":"building",minzoom:14,layout:{visibility:"visible"},
      paint:{"fill-extrusion-color":dark?"#3b3442":"#e7e1ea","fill-extrusion-height":["coalesce",["get","render_height"],8],
        "fill-extrusion-base":["coalesce",["get","render_min_height"],0],"fill-extrusion-opacity":.9}},first);
  }
  async function attach(){
    if(map){map.resize();paint();return}
    if(failed||el.dataset.loading)return;el.dataset.loading="1";
    try{gl=await loadLib()}catch(e){failed=true;msg.textContent="地圖暫時載入不了，請改看下面的文字清單。";el.classList.add("sm-failed");return}
    const dark=matchMedia("(prefers-color-scheme: dark)").matches&&document.documentElement.dataset.theme!=="light";
    const b=bounds(sites);
    map=new gl.Map({container:canvas,style:STYLE[dark?"dark":"light"],bounds:b,fitBoundsOptions:{padding:48},pitch:PITCH,maxPitch:70,
      cooperativeGestures:true,attributionControl:{compact:true},
      locale:{"CooperativeGesturesHandler.WindowsHelpText":"按住 Ctrl 再滾動滑鼠來縮放地圖","CooperativeGesturesHandler.MacHelpText":"按住 ⌘ 再滾動滑鼠來縮放地圖","CooperativeGesturesHandler.MobileHelpText":"用兩指移動地圖"}});
    map.on("error",e=>{if(!map.loaded()&&/style|fetch/i.test(String(e?.error?.message))){msg.textContent="地圖暫時載入不了，請改看下面的文字清單。";msg.hidden=false}});
    map.on("rotate",()=>ctrls.querySelector(".sm-compass").style.transform="rotate("+(-map.getBearing())+"deg)");
    map.on("click",()=>select(null));
    map.once("load",()=>{try{chinese()}catch(e){}try{add3d(dark)}catch(e){}msg.hidden=true;view(campus,false)});
    paint();
  }
  return{el,attach,paint,view,select,
    get campus(){return campus},get selected(){return selected},
    focus(id){el.scrollIntoView({behavior:"smooth",block:"center"});select(id,{fly:true})}};
}
