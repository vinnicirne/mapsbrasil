import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {factionColors} from './navigation/factions.js';

const collection=features=>({type:'FeatureCollection',features});
const feature=(type,coordinates,properties={})=>({type:'Feature',geometry:{type,coordinates},properties});

export function createNationalMap(container,onPoint,onReady) {
  const map=new maplibregl.Map({container,style:'https://tiles.openfreemap.org/styles/positron',
    center:[-51,-15],zoom:3.4,minZoom:2,maxZoom:19,attributionControl:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'<a href="https://www.openstreetmap.org/fixthemap">Corrigir o mapa</a>'}),'bottom-left');
  let state={}, lastRoute, lastLeg, lastRisk, ready=false;
  map.on('click',event=>{if(!state.nav) onPoint([event.lngLat.lng,event.lngLat.lat]);});
  function update() {
    if(!ready) return;
    const {route,legIndex,position,origin,destination,nav,bearing,risks}=state;
    if(lastRisk!==risks) {
      lastRisk=risks;
      map.getSource('drive-risk').setData(collection((risks??[]).map(zone=>{
        const [outline,fill]=factionColors(zone);
        return {...zone,properties:{...zone.properties,outline,fill:fill.slice(0,7)}};
      })));
    }
    if(lastRoute!==route || lastLeg!==legIndex) {
      lastRoute=route;lastLeg=legIndex;
      const lines=(route?.legs??[]).slice(legIndex).flatMap(leg=>leg.segments.length?
        [feature('LineString',[leg.segments[0].a,...leg.segments.map(segment=>segment.b)])]:[]);
      map.getSource('drive-route').setData(collection(lines));
    }
    const dots=[];
    if(position) dots.push(feature('Point',position,{kind:'gps'}));
    if(origin) dots.push(feature('Point',origin,{kind:'origin'}));
    if(destination) dots.push(feature('Point',destination,{kind:'destination'}));
    if(route?.legs[legIndex]) dots.push(feature('Point',route.legs[legIndex].stop.point,{kind:'destination'}));
    map.getSource('drive-points').setData(collection(dots));
    if(nav && position) map.easeTo({center:position,bearing:bearing??0,zoom:16.6,pitch:38,duration:350});
  }
  map.on('load',()=>{
    for(const id of ['drive-risk','drive-route','drive-points']) map.addSource(id,{type:'geojson',data:collection([])});
    map.addLayer({id:'drive-risk-fill',source:'drive-risk',type:'fill',paint:{'fill-color':['get','fill'],'fill-opacity':.24}});
    map.addLayer({id:'drive-risk-outline',source:'drive-risk',type:'line',paint:{'line-color':['get','outline'],'line-width':1.7}});
    map.addLayer({id:'drive-route-border',source:'drive-route',type:'line',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':10}});
    map.addLayer({id:'drive-route-line',source:'drive-route',type:'line',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#2362de','line-width':6}});
    map.addLayer({id:'drive-markers',source:'drive-points',type:'circle',paint:{
      'circle-radius':7,'circle-color':['match',['get','kind'],'gps','#2362de','origin','#24564a','#223954'],'circle-stroke-color':'#fff','circle-stroke-width':2
    }});
    ready=true;
    update();
    onReady();
  });
  return {
    ready:()=>ready,
    set(value){state=value;update();},
    resize(){map.resize();},
    focus(center,zoom=15){map.easeTo({center,zoom,pitch:0,bearing:0,duration:450});},
    overview(route) {
      const points=route?.legs.flatMap(leg=>leg.segments.flatMap(segment=>[segment.a,segment.b])) ?? [];
      if (!points.length) return this.focus([-51,-15],3.4);
      const bounds=new maplibregl.LngLatBounds(points[0],points[0]);
      for (const point of points) bounds.extend(point);
      map.fitBounds(bounds,{padding:90,maxZoom:16,duration:550,pitch:0,bearing:0});
    },
    zoom(delta){map.easeTo({zoom:map.getZoom()+Math.log2(delta)});}
  };
}
