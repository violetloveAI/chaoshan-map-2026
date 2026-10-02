(function(global){
  'use strict';
  function distance(a,b){const R=6371.0088,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,h)));}
  function routeAllowed(a,b){return !a.requiresBoat&&!b.requiresBoat;}
  function matrixValue(matrix,a,b){if(!matrix||!routeAllowed(a,b))return null;const i=matrix.ids.indexOf(a.id),j=matrix.ids.indexOf(b.id);if(i<0||j<0)return null;const m=matrix.distances[i]?.[j],s=matrix.durations[i]?.[j];if(!Number.isFinite(m)||!Number.isFinite(s))return null;return {km:m/1000,minutes:s/60,kind:'matrix',snap:Math.max(matrix.sources?.[i]?.distance||0,matrix.sources?.[j]?.distance||0)};}
  function validateRoute(result,a,b){if(result?.code!=='Ok'||!result.routes?.length)return null;const r=result.routes[0];if(!Number.isFinite(r.distance)||!Number.isFinite(r.duration))return null;const maxSnap=Math.max(...(result.waypoints||[]).map(x=>x.distance||0));if(maxSnap>1500)return null;const ferry=(r.legs||[]).some(l=>(l.steps||[]).some(s=>s.mode==='ferry'));return {km:r.distance/1000,minutes:r.duration/60,geometry:r.geometry,kind:'online',snap:maxSnap,ferry};}
  const api={distance,routeAllowed,matrixValue,validateRoute};global.TripCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
