// ==UserScript==
// @name         WME Quick HN Importer
// @namespace    http://www.wazebelgium.be/
// @version      2.0.0
// @description  Quickly add house numbers based on open data sources of house numbers
// @author       Tom 'Glodenox' Puttemans
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      geo.api.vlaanderen.be
// ==/UserScript==

/* global W, OpenLayers, I18n, require, getWmeSdk */


let wmeSDK;
const LAYER_NAME = 'Quick HN importer';
(unsafeWindow || window).SDK_INITIALIZED.then(() => {
  wmeSDK = getWmeSdk({ scriptId: "quick-hn-importer", scriptName: "Quick HN Importer"});
  wmeSDK.Events.once({ eventName: "wme-ready" }).then(init);
});

let loadingMessage = document.createElement('div');
let exitMessage = document.createElement('div');

let selectedStreetNames = [];

let repository = function() {
  let groups = [];
  let toIndex = (lon, lat) => [ Math.floor(lon * 100), Math.floor(lat * 333.33) ];
  let toCoord = (x, y) => [ x / 100, y / 333.33 ];
  let getData = (x, y) => {
    console.log("Retrieving", x, y);
    let cell = groups[x] ? groups[x][y] : undefined;
    if (cell) {
      return new Promise((resolve, reject) => { resolve([]) });
    }
    return new Promise((resolve, reject) => {
      let [ lon, lat ] = toCoord(x, y);
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://geo.api.vlaanderen.be/Adressenregister/ogc/features/v1/collections/Adres/items?f=application/json&bbox=${lon},${lat - 0.003},${lon + 0.01},${lat}`,
        responseType: 'json',
        onload: function(response) {
          let features = [];
          let typeMapping = {
            'InGebruik': 'active',
            'Voorgesteld': 'planned',
            'Gehistoreerd': 'archived'
          };
          response.response.features?.forEach((feature) => {
            let lon = feature.geometry.coordinates[0];
            let lat = feature.geometry.coordinates[1];
            // Create multidimensional array entry, if needed
            if (!groups[x]) {
              groups[x] = [];
            }
            if (!groups[x][y]) {
              groups[x][y] = [];
            }
            // Transform to feature, ready to be added via SDK
            groups[x][y].push(feature.properties.Id);
            features.push({
              type: "Feature",
              id: feature.properties.Id,
              geometry: feature.geometry,
              properties: {
                street: feature.properties.Straatnaam,
                number: feature.properties.Huisnummer,
                municipality: feature.properties.Gemeentenaam,
                processed: false,
                type: typeMapping[feature.properties.AdresStatus]
              }
            });
          });
          resolve(features);
        },
        onerror: (error) => {
          console.error('Error', error);
          loadingMessage.style.display = 'none';
          reject(error);
        }
      });
    });
  };

  return {
    getExtentData: async function(extent) {
      let features = [];
      let sanityLimit = 10;
      let [ left, bottom ] = toIndex(extent[0], extent[1]),
          [ right, top ] = toIndex(extent[2], extent[3]);
      for (let x = left; x <= right; x += 1) {
        for (let y = top + 1; y >= bottom; y -= 1) {
          console.log('consulting', x, y);
          sanityLimit--;
          if (sanityLimit <= 0) {
            console.log("sanity limit reached");
            return;
          }
          features = features.concat(await getData(x, y));
        }
      }
      return features;
    }
  };
}();

function init() {
  exitMessage.style.position = 'absolute';
  exitMessage.style.top = '35px';
  exitMessage.style.width = '100%';
  exitMessage.style.pointerEvents = 'none';
  exitMessage.style.display = 'none';
  exitMessage.innerHTML = `<div style="margin:0 auto; max-width:200px; text-align:center; background:rgba(0, 0, 0, 0.5); color:white; border-radius:3px; padding:5px 15px;">Press ESC to stop adding house numbers</div>`;
  wmeSDK.Map.getMapViewportElement().appendChild(exitMessage);

  loadingMessage.style.position = 'absolute';
  loadingMessage.style.bottom = '35px';
  loadingMessage.style.width = '100%';
  loadingMessage.style.pointerEvents = 'none';
  loadingMessage.style.display = 'none';
  loadingMessage.innerHTML = `<div style="margin:0 auto; max-width:300px; text-align:center; background:rgba(0, 0, 0, 0.5); color:white; border-radius:3px; padding:5px 15px;"><i class="fa fa-pulse fa-spinner"></i> Loading address points</div>`;
  wmeSDK.Map.getMapViewportElement().appendChild(loadingMessage);

  var currentStreetName = "straat";
  wmeSDK.Map.addLayer({
    layerName: LAYER_NAME,
    styleContext: {
      fillColor: ({ feature }) => feature.properties && selectedStreetNames.find(feature.properties.street) != undefined ? '#99ee99' : '#cccccc',
      radius: ({ feature }) => feature.properties && feature.properties.number ? Math.max(feature.properties.number.length * 6, 10) : 10,
      opacity: ({ feature }) => feature.properties && feature.properties.street == currentStreetName && feature.properties.processed ? 0.3 : 1,
      title: ({ feature }) => feature.properties && feature.properties.number && feature.properties.street ? feature.properties.street + ' ' + feature.properties.number : '',
      number: ({ feature }) => feature.properties && feature.properties.number ? feature.properties.number : ''
    },
    styleRules: [
      {
        style: {
          fillColor: '${fillColor}',
          fillOpacity: '${opacity}',
          fontColor: '#111111',
          fontWeight: 'bold',
          strokeColor: '#ffffff',
          strokeOpacity: '${opacity}',
          strokeWidth: 2,
          pointRadius: '${radius}',
          label: '${number}',
          title: '${title}'
        }
      }
    ]
  });
  wmeSDK.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: false });
  wmeSDK.Events.trackLayerEvents({ layerName: LAYER_NAME });

  wmeSDK.Events.trackLayerEvents({ "layerName": "house_numbers" });
  wmeSDK.Events.on({
    eventName: "wme-layer-visibility-changed",
    eventHandler: updateLayer
  });
  wmeSDK.Events.on({
    eventName: "wme-map-move-end",
    eventHandler: updateLayer
  });

  wmeSDK.Events.on({
    eventName: "wme-layer-feature-clicked",
    eventHandler: console.log
  });
  wmeSDK.Events.on({
    eventName: "wme-house-number-added",
    eventHandler: () => {
      console.log("Do stuff with new house number, probably remove matching data point");
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-house-number-deleted",
    eventHandler: () => {
      console.log("Do stuff with new house number, probably add removed data point");
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-selection-changed",
    eventHandler: () => {
      let segmentSelection = wmeSDK.Editing.getSelection();
      if (!segmentSelection || segmentSelection.objectType != 'segment' || segmentSelection.ids.length == 0) {
        console.log("No segments selected");
        selectedStreetNames = [];
      } else {
        selectedStreetNames = segmentSelection.ids.map((segmentId) => wmeSDK.DataModel.Segments.getById({ segmentId: segmentId })?.primaryStreetId).filter(x => x).map((id) => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name).filter(x => x);
      }
    }
  });
}

function updateLayer() {
  if (!wmeSDK.Map.isLayerVisible({ layerName: "house_numbers"}) || wmeSDK.Map.getZoomLevel() < 19) {
    wmeSDK.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: false });
    return;
  } else if (wmeSDK.Map.isLayerVisible({ layerName: "house_numbers"}) && wmeSDK.Map.getZoomLevel() >= 19 && !wmeSDK.Map.isLayerVisible({ layerName: LAYER_NAME})) {
    wmeSDK.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: true });
  }
  loadingMessage.style.display = null;
  repository.getExtentData(wmeSDK.Map.getMapExtent()).then((newFeatures) => {
    wmeSDK.Map.addFeaturesToLayer({
      layerName: LAYER_NAME,
      features: newFeatures
    });
    loadingMessage.style.display = 'none';
  });
};

function log(message) {
  if (typeof message === 'string') {
    console.log('%cWME Quick HN Importer: %c' + message, 'color:black', 'color:#d97e00');
  } else {
    console.log('%cWME Quick HN Importer:', 'color:black', message);
  }
}
