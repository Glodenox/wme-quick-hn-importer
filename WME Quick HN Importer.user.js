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
// @require      https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
// ==/UserScript==

/* global getWmeSdk, turf */


let wmeSDK;
const LAYER_NAME = 'Quick HN importer';
(unsafeWindow || window).SDK_INITIALIZED.then(() => {
  wmeSDK = getWmeSdk({ scriptId: "quick-hn-importer", scriptName: "Quick HN Importer"});
  wmeSDK.Events.once({ eventName: "wme-ready" }).then(init);
});

let loadingMessage = document.createElement('div');
let exitMessage = document.createElement('div');

let previousCenterLocation = null;
let selectedStreetNames = [];

let repository = function() {
  let groups = [];
  let houseNumberSegments = new Map();
  let directory = new Map();
  let toIndex = (lon, lat) => [ Math.floor(lon * 100), Math.floor(lat * 200) ];
  let toCoord = (x, y) => [ x / 100, y / 200 ];
  let storeData = (x, y, feature) => {
    groups[x][y].push(feature);
    directory.set(feature.id, feature);
  };
  let getData = (x, y) => {
    let cell = groups[x] ? groups[x][y] : undefined;
    if (cell) {
      return new Promise((resolve, reject) => { resolve(cell) });
    }
    // Create multidimensional array entry, if needed
    if (!groups[x]) {
      groups[x] = [];
    }
    if (!groups[x][y]) {
      groups[x][y] = [];
    }
    return new Promise((resolve, reject) => {
      let [ left, top ] = toCoord(x, y);
      let right = left + 0.01,
          bottom = top - 0.005;
      console.log("Performing uncached data lookup for group ", x, y);
      // START SOURCE-SPECIFIC MAPPINGS
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://geo.api.vlaanderen.be/Adressenregister/ogc/features/v1/collections/Adres/items?f=application/json&bbox=${left},${bottom},${right},${top}`,
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
            let newFeature = {
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
            };
            // Transform to feature, ready to be added via SDK
            storeData(x, y, newFeature);
            features.push(newFeature);
          });
          console.log("Retrieved features", features);
          resolve(features);
        },
        onerror: (error) => {
          console.error('Error', error);
          loadingMessage.style.display = 'none';
          reject(error);
        }
      });
      // END SOURCE-SPECIFIC MAPPINGS
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
          sanityLimit--;
          if (sanityLimit <= 0) {
            console.log("sanity limit reached");
            return;
          }
          features = features.concat(await getData(x, y));
        }
      }
      // The houseNumberSegments repository should probably be filled when the datamodel changes
      /*let toRetrieve = features.map(feature => feature.nearestSegment).filter((segmentId, index, array) => segmentId != null && array.indexOf(segmentId) === index && !houseNumberSegments.has(segmentId)); // Unique non-null values and not already known
      toRetrieve.forEach(segmentId => houseNumberSegments.set(segmentId, []));
      if (toRetrieve.length > 0) {
        console.log("Segments to retrieve", toRetrieve);
        wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({ segmentIds: toRetrieve }).then(houseNumbers => houseNumbers.forEach(houseNumber => {
          let houseNumberSegment = houseNumberSegments.get(houseNumber.segmentId);
          houseNumberSegment.push(houseNumber.number);
          houseNumberSegments.set(houseNumber.segmentId, houseNumberSegment);
          let processedFeature = features.find(feature => feature.properties.nearestSegment == houseNumber.segmentid && feature.properties.number == houseNumber.number);
          console.log("processed feature", processedFeature);
          if (processedFeature) {
            processedFeature.properties.processed = true;
          }
          console.log("Current housenumbers", houseNumberSegments);
        }));
      }*/
      return features;
    },
    cull: () => {
      groups.forEach((col, xIndex) => {
        col.forEach((row, yIndex) => {
          console.log("Data culling check", xIndex, yIndex, wmeSDK.Map.getMapCenter(), turf.distance(toCoord(xIndex, yIndex), Object.values(wmeSDK.Map.getMapCenter())));
          if (turf.distance(toCoord(xIndex, yIndex), Object.values(wmeSDK.Map.getMapCenter())) > 1) {
            row.forEach((feature) => {
              wmeSDK.Map.removeFeatureFromLayer({
                layerName: LAYER_NAME,
                featureId: feature.id
              });
              directory.delete(feature.id);
            });
            col.splice(yIndex, 1);
            if (col.length == 0) {
              groups.splice(xIndex, 1);
            }
            console.log("Data culled", xIndex, yIndex, groups, directory);
          }
        })
      });
    },
    lookup: (featureId) => directory.get(featureId)
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

  previousCenterLocation = Object.values(wmeSDK.Map.getMapCenter());

  wmeSDK.Map.addLayer({
    layerName: LAYER_NAME,
    styleContext: {
      fillColor: ({ feature }) => feature.properties && selectedStreetNames.includes(feature.properties.street) ? '#99ee99' : '#cccccc',
      radius: ({ feature }) => feature.properties && feature.properties.number ? Math.max(feature.properties.number.length * 6, 10) : 10,
      opacity: ({ feature }) => feature.properties && selectedStreetNames.includes(feature.properties.street) && feature.properties.processed ? 0.3 : 1,
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
          cursor: 'pointer',
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
    eventHandler: () => {
      updateLayer();
      let currentLocation = Object.values(wmeSDK.Map.getMapCenter());
      // Check for any data removal when we're a good distance away
      if (turf.distance(currentLocation, previousCenterLocation) > 1) {
        previousCenterLocation = currentLocation;
        repository.cull();
      }
    }
  });

  wmeSDK.Events.on({
    eventName: "wme-layer-feature-clicked",
    eventHandler: (clickEvent) => {
      let feature = repository.lookup(clickEvent.featureId);
      let nearestSegment = findNearestSegment(feature);
      if (nearestSegment) {
        wmeSDK.Editing.setSelection({
          selection: {
            ids: [ nearestSegment.id ],
            objectType: "segment"
          }
        });
      }
      wmeSDK.DataModel.HouseNumbers.addHouseNumber({
        number: feature.properties.number,
        point: feature.geometry,
        segmentId: nearestSegment?.id
      });
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-house-number-added",
    eventHandler: (addEvent) => {
      console.log("Do stuff with new house number, probably remove matching data point", addEvent);
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-house-number-deleted",
    eventHandler: (deleteEvent) => {
      console.log("Do stuff with deleted house number, probably add removed data point", deleteEvent);
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-selection-changed",
    eventHandler: () => {
      let segmentSelection = wmeSDK.Editing.getSelection();
      if (!segmentSelection || segmentSelection.objectType != 'segment' || segmentSelection.ids.length == 0) {
        selectedStreetNames = [];
      } else {
        selectedStreetNames = segmentSelection.ids
          .map((segmentId) => wmeSDK.DataModel.Segments.getById({ segmentId: segmentId })?.primaryStreetId)
          .filter(x => x)
          .map((id) => wmeSDK.DataModel.Streets.getById({ streetId: id })?.name)
          .filter(x => x);
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
  repository.getExtentData(wmeSDK.Map.getMapExtent()).then((features) => {
    if (features.length > 0) {
      wmeSDK.Map.removeAllFeaturesFromLayer({
        layerName: LAYER_NAME
      });
      wmeSDK.Map.addFeaturesToLayer({
        layerName: LAYER_NAME,
        features: features
      });
    }
    loadingMessage.style.display = 'none';
  });
}

function findNearestSegment(feature) {
  let street = wmeSDK.DataModel.Streets.getAll().find(street => street.name == feature.properties.Straatnaam);
  if (street) {
    return wmeSDK.DataModel.Segments.getAll()
      .filter(segment => segment.primaryStreetId == street.id || segment.alternateStreetIds?.includes(street.id))
      .reduce((current, contender) => {
      contender.distance = turf.pointToLineDistance(feature.geometry, contender.geometry);
      return current.distance < contender.distance ? current : contender;
    },  { distance: Infinity });
  }
  return null;
}

function log(message) {
  if (typeof message === 'string') {
    console.log('%cWME Quick HN Importer: %c' + message, 'color:black', 'color:#d97e00');
  } else {
    console.log('%cWME Quick HN Importer:', 'color:black', message);
  }
}
