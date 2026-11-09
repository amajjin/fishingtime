'use strict';
const FishingWeather=(()=>{
 const URL='https://api.open-meteo.com/v1/forecast?latitude=47.567&longitude=-52.702&hourly=precipitation,weather_code,wind_speed_10m,wind_gusts_10m&forecast_days=16&timezone=America%2FSt_Johns&timeformat=unixtime&wind_speed_unit=kmh';
 const CACHE='fishing-weather-v1',HOUR=3600000;let hours=[],loadedAt=0,status='loading';
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 function rain(code,mm){
  if(!finite(code)&&!finite(mm))return {label:'No data',symbol:'—',detail:'Precipitation unavailable'};
  if([71,73,75,77,85,86].includes(code))return {label:'Snow',symbol:'❄',detail:'Snow forecast'};
  if([66,67].includes(code))return {label:'Rain',symbol:'☂',detail:'Freezing rain forecast'};
  if([95,96,99].includes(code))return {label:'Rain',symbol:'ϟ',detail:'Thunderstorms forecast'};
  if([56,57].includes(code))return {label:'Drizzle',symbol:'⋰',detail:'Freezing drizzle forecast'};
  if([51,53,55].includes(code))return {label:'Drizzle',symbol:'⋰',detail:'Drizzle forecast'};
  if([61,63,65,80,81,82].includes(code)||(!finite(code)&&finite(mm)&&mm>0))return {label:'Rain',symbol:'☂',detail:'Rain forecast'};
  if(!finite(code))return {label:'Clear',symbol:'○',detail:'No precipitation · sky data unavailable'};
  const sky=code===0?'Clear skies':code===1?'Mostly clear':code===2?'Partly cloudy':code===3?'Overcast':[45,48].includes(code)?'Fog':'No precipitation';
  return {label:'Clear',symbol:code>=2?'☁':'☀',detail:sky+' · No precipitation'};
 }
 function wind(speed){if(!finite(speed))return {label:'No data',short:'—',level:0};if(speed<15)return {label:'Light',short:'L',level:1};if(speed<30)return {label:'Moderate',short:'M',level:2};return {label:'Strong',short:'S',level:3}}
 function valid(data){const h=data&&data.hourly;if(!h||!Array.isArray(h.time)||!h.time.length||!['precipitation','weather_code','wind_speed_10m','wind_gusts_10m'].every(k=>Array.isArray(h[k])&&h[k].length===h.time.length))throw Error('Invalid weather response');return h}
 function apply(data,at){const h=valid(data);hours=h.time.map((t,i)=>({t:t*1000,mm:h.precipitation[i],code:h.weather_code[i],speed:h.wind_speed_10m[i],gust:h.wind_gusts_10m[i]}));loadedAt=at;status='ready'}
 function get(t){if(status!=='ready'||!hours.length)return null;const index=Math.floor((t-hours[0].t)/HOUR),h=hours[index];if(!h||t<h.t||t>=h.t+HOUR)return null;return {...h,rain:rain(h.code,h.mm),wind:wind(h.speed)}}
 async function load(force=false){if(!force)try{const cache=JSON.parse(localStorage.getItem(CACHE));if(cache&&Date.now()-cache.at>=0&&Date.now()-cache.at<30*60000){apply(cache.data,cache.at);return}}catch{}
  status='loading';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(URL,{signal:controller.signal});if(!response.ok)throw Error('Weather HTTP '+response.status);const data=await response.json(),at=Date.now();apply(data,at);try{localStorage.setItem(CACHE,JSON.stringify({at,data}))}catch{}}
  catch{hours=[];status='error'}finally{clearTimeout(timer)}
 }
 return {rain,wind,get,load,get status(){return status},get loadedAt(){return loadedAt},get start(){return hours[0]?.t},get end(){return hours.at(-1)?.t}};
})();
if(typeof module!=='undefined')module.exports=FishingWeather;
