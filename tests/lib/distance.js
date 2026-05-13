'use strict';

const R_EARTH_M = 6371000;
const TR = Math.PI / 180;

function haversineM(lat1, lng1, lat2, lng2){
  if(lat1 === lat2 && lng1 === lng2) return 0;
  const dLat = (lat2 - lat1) * TR;
  const dLng = (lng2 - lng1) * TR;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * TR) * Math.cos(lat2 * TR) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metersPerDegree(lat){
  const cosL = Math.cos(lat * TR);
  return { lat: 111132.92, lng: 111412.84 * cosL };
}

module.exports = { haversineM, metersPerDegree };
