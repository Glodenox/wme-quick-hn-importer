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
// @connect      geoservices-urbis.irisnet.be
// @connect      geoservices.wallonie.be
// @connect      service.pdok.nl
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

let previousCenterLocation = null;
let selectedStreetNames = [];
let streetNumbers = new Map();
let streetNames = new Set();

let repository = function() {
  let groups = [];
  let directory = new Map();
  let toIndex = (lon, lat) => [ Math.floor(lon * 100), Math.floor(lat * 200) ];
  let toCoord = (x, y) => [ x / 100, y / 200 ];
  let sources = [];
  let getData = (x, y) => {
    let cell = groups[x] ? groups[x][y] : undefined;
    // Data already loaded
    if (cell instanceof Array) {
      return new Promise((resolve, reject) => { resolve(cell) });
    }
    // Data still loading in parallel
    if (cell instanceof Promise) {
      return cell;
    }
    // No data found, start loading
    let promise = new Promise((resolve, reject) => {
      let [ left, top ] = toCoord(x, y);
      let right = left + 0.01,
          bottom = top - 0.005;
      Promise.all(sources.map(source => source(left, bottom, right, top))).then(newFeatureGroups => {
        groups[x][y] = [];
        newFeatureGroups.forEach(newFeatures => newFeatures.forEach(newFeature => {
          groups[x][y].push(newFeature);
          directory.set(newFeature.id, newFeature);
        }));
        resolve([].concat(... newFeatureGroups));
      });
    });
    // Create multidimensional array entry, if needed
    if (!groups[x]) {
      groups[x] = [];
    }
    if (!groups[x][y]) {
      groups[x][y] = promise;
    }
    return promise;
  };

  return {
    addSource: (source) => sources.push(source),
    getExtentData: async function(extent) {
      let features = [];
      let sanityLimit = 10;
      let [ left, bottom ] = toIndex(extent[0], extent[1]),
          [ right, top ] = toIndex(extent[2], extent[3]);
      for (let x = left; x <= right; x += 1) {
        for (let y = top + 1; y >= bottom; y -= 1) {
          sanityLimit--;
          if (sanityLimit <= 0) {
            log("sanity limit reached while retrieving data");
            return;
          }
          features = features.concat(await getData(x, y));
        }
      }
      // Remove duplicate street+number combinations (mostly boxes at the same location)
      let processedHouseNumbers = new Set();
      return features.filter((feature) => {
        let houseNumberKey = feature.properties.street + "|" + feature.properties.number;
        if (!processedHouseNumbers.has(houseNumberKey)) {
          processedHouseNumbers.add(houseNumberKey);
          return true;
        }
        return false;
      });
    },
    cull: () => {
      groups.forEach((col, xIndex) => {
        col.forEach((row, yIndex) => {
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
          }
        })
      });
    },
    lookup: (featureId) => directory.get(featureId)
  };
}();

// Vlaanderen (Belgium):
repository.addSource((left, bottom, right, top) => {
  let requestedPoly = turf.bboxPolygon([left, bottom, right, top]);
  let regionPoly = turf.polygon([[[4.777969,51.518210],[4.641333,51.422010],[4.537689,51.488676],[4.377120,51.453982],[4.382282,51.381726],[4.217576,51.373885],[3.965949,51.226031],[3.590019,51.305952],[3.414280,51.262159],[3.365430,51.370106],[3.186308,51.362487],[2.545706,51.088757],[2.574734,50.996934],[2.579035,50.918657],[2.606847,50.813426],[2.846267,50.697874],[2.963540,50.773141],[3.120955,50.770274],[3.418007,50.690563],[3.806240,50.747335],[3.920502,50.686118],[4.287230,50.688986],[4.798471,50.772137],[5.135715,50.690628],[5.508128,50.720813],[5.628842,50.773284],[5.821811,50.707623],[5.919873,50.709917],[5.907257,50.769270],[5.694503,50.814860],[5.653214,50.866185],[5.737226,50.906614],[5.866541,51.154922],[5.491785,51.305742],[5.343832,51.276209],[5.071179,51.393485],[5.136526,51.463444],[5.016099,51.491257],[5.002909,51.445380],[4.860834,51.471759],[4.777969,51.518210]]]);
  if (turf.booleanDisjoint(regionPoly, requestedPoly)) {
    return new Promise((resolve, reject) => resolve([]));
  }
  return httpRequest({
    url: `https://geo.api.vlaanderen.be/Adressenregister/ogc/features/v1/collections/Adres/items?f=application/json&bbox=${left},${bottom},${right},${top}`
  }, (response) => {
    let features = [];
    let TYPE_MAPPING = new Map([
      ['InGebruik', 'active'],
      ['Voorgesteld', 'planned']
    ]);
    response.response.features?.forEach((feature) => {
      if (!TYPE_MAPPING.has(feature.properties.AdresStatus)) {
        return;
      }
      features.push({
        type: "Feature",
        id: feature.properties.Id,
        geometry: feature.geometry,
        properties: {
          street: feature.properties.Straatnaam,
          number: feature.properties.Huisnummer,
          municipality: feature.properties.Gemeentenaam,
          type: TYPE_MAPPING.get(feature.properties.AdresStatus)
        }
      });
    });
    return features;
  });
});
// Brussels (Belgium):
repository.addSource((left, bottom, right, top) => {
  let requestedPoly = turf.bboxPolygon([left, bottom, right, top]);
  let regionPoly = turf.polygon([[[4.410507,50.916487],[4.444648,50.883599],[4.420867,50.867712],[4.466045,50.851056],[4.476732,50.820404],[4.452249,50.806449],[4.485805,50.792925],[4.383965,50.761429],[4.331210,50.775508],[4.293584,50.804971],[4.238630,50.814280],[4.253596,50.836364],[4.279553,50.840647],[4.278150,50.866039],[4.295571,50.894146],[4.410507,50.916487]]]);
  if (turf.booleanDisjoint(regionPoly, requestedPoly)) {
    return new Promise((resolve, reject) => resolve([]));
  }
  return httpRequest({
    url: `https://geoservices-urbis.irisnet.be/geoserver/urbisvector/wfs?service=wfs&version=2.0.0&request=GetFeature&typeNames=urbisvector:AddressNumbers&outputFormat=application/json&srsName=EPSG:4326&bbox=${left},${bottom},${right},${top},EPSG:4326`
  }, (response) => {
    let features = [];
    response.response.features?.forEach((feature) => {
      let streetName = feature.properties.STRNAMEFRE || feature.properties.STRNAMEDUT;
      features.push({
        type: "Feature",
        id: feature.properties.INSPIRE_ID,
        geometry: feature.geometry,
        properties: {
          street: streetName,
          number: feature.properties.POLICENUM,
          municipality: feature.properties.MUNNAMEFRE || feature.properties.MUNNAMEDUT,
          type: 'active'
        }
      });
    });
    return features;
  });
});
// Wallonie (Belgium):
repository.addSource((left, bottom, right, top) => {
  let requestedPoly = turf.bboxPolygon([left, bottom, right, top]);
  let regionPoly = turf.polygon([[[5.709641,50.819673],[5.724607,50.758174],[6.025802,50.767641],[6.288645,50.632562],[6.197057,50.530405],[6.351289,50.488288],[6.420534,50.325417],[6.137793,50.129849],[5.999611,50.157914],[5.750798,49.830795],[5.921974,49.705737],[5.898589,49.553056],[5.472410,49.496955],[4.851679,49.793482],[4.781738,49.957938],[4.877586,50.153709],[4.702101,50.095553],[4.692983,49.995491],[4.454353,49.925431],[4.121356,49.959142],[4.147547,50.240543],[4.016592,50.344523],[3.673306,50.295549],[3.615312,50.482215],[3.286056,50.485191],[3.237416,50.688299],[3.055951,50.773557],[2.896000,50.685336],[2.794978,50.732724],[2.982056,50.818491],[3.175681,50.768824],[3.758521,50.780406],[4.249504,50.720289],[4.761160,50.831490],[5.137185,50.719105],[5.709641,50.819673]]]);
  if (turf.booleanDisjoint(regionPoly, requestedPoly)) {
    return new Promise((resolve, reject) => resolve([]));
  }
  return httpRequest({
    url: `https://geoservices.wallonie.be/arcgis/rest/services/DONNEES_BASE/ICAR_ADR_PT/MapServer/1/query?outfields=ADR_ID,ADR_NUMERO,RUE_NM,COM_NM,ADR_FIN&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&f=json&geometry=${left},${bottom},${right},${top}`
  }, (response) => {
    let features = [];
    response.response.features?.forEach((feature) => {
      if (feature.attributes.ADR_FIN != null) {
        return;
      }
      let streetName = feature.attributes.RUE_NM.replace(/ \([A-Z]{2}\)$/, "");
      features.push(turf.point([ feature.geometry.x, feature.geometry.y ], {
        street: streetName,
        number: feature.attributes.ADR_NUMERO,
        municipality: feature.attributes.COM_NM,
        type: 'active'
      }, {
        id: feature.attributes.ADR_ID
      }));
    });
    return features;
  });
});
// The Netherlands:
repository.addSource((left, bottom, right, top) => {
  let requestedPoly = turf.bboxPolygon([left, bottom, right, top]);
  let regionPoly = turf.polygon([[[4.276162,51.358135],[3.923522,51.188432],[3.644777,51.247607],[3.368838,51.233552],[3.263139,51.540013],[4.614772,53.286735],[6.399488,53.739490],[7.194590,53.245021],[7.192821,52.998006],[7.052388,52.600208],[6.737035,52.634695],[6.714814,52.461553],[7.071095,52.449966],[7.026320,52.230637],[6.725938,52.035871],[6.869987,51.957545],[6.362073,51.806845],[6.251697,51.852513],[5.946761,51.815520],[6.252633,51.468980],[6.147252,51.152253],[5.960792,51.034575],[6.085199,50.897317],[5.994910,50.749926],[5.681112,50.746043],[5.595992,50.835330],[5.802712,51.128007],[5.435105,51.254632],[5.129234,51.272191],[5.027527,51.476807],[4.910325,51.391902],[4.762117,51.413374],[4.826092,51.460555],[4.764184,51.496237],[4.630135,51.418206],[4.447338,51.433422],[4.401504,51.325998],[4.276162,51.358135]]]);
  if (turf.booleanDisjoint(regionPoly, requestedPoly)) {
    return new Promise((resolve, reject) => resolve([]));
  }
  let transformedPoly = turf.toMercator(requestedPoly);
  let bbox = turf.bbox(transformedPoly, { recompute: true });
  let parseData = async function(response) {
    let features = [];
    response.response.features?.forEach((feature) => {
      features.push({
        type: "Feature",
        id: feature.properties.identificatie,
        geometry: feature.geometry,
        properties: {
          street: feature.properties.openbare_ruimte,
          number: feature.properties.huisnummer.toString(),
          municipality: feature.properties.woonplaats,
          type: 'active'
        }
      });
    });
    if (response.response.features.length > 0) {
      let currentURL = URL.parse(response.finalUrl);
      let moreFeatures = await retrieveData(Number(currentURL.searchParams.get("startIndex")) + 1000);
      features = features.concat(moreFeatures);
    }
    return features;
  };
  let retrieveData = (startIndex) => {
    console.log("Retrieving data", `https://service.pdok.nl/lv/bag/wfs/v2_0?service=wfs&version=2.0.0&request=GetFeature&typeNames=bag:verblijfsobject&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox.join(",")},EPSG:3857&count=1000&startIndex=${startIndex}`);
    return httpRequest({
      url: `https://service.pdok.nl/lv/bag/wfs/v2_0?service=wfs&version=2.0.0&request=GetFeature&typeNames=bag:verblijfsobject&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox.join(",")},EPSG:3857&count=1000&startIndex=${startIndex}`,
      context: startIndex
    }, parseData);
  };
  return retrieveData(0);
});

function init() {
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
      fillColor: ({ feature }) => feature.properties && selectedStreetNames.includes(feature.properties.street) ? '#99ee99' : '#fa7a2f',
      strokeColor: ({ feature }) => feature.properties && streetNames.has(feature.properties.street) ? '#ffffff' : '#bb3333',
      radius: ({ feature }) => feature.properties && feature.properties.number ? Math.max(feature.properties.number.length * 6, 10) : 10,
      opacity: ({ feature }) => feature.properties && streetNumbers.has(feature.properties.street) && streetNumbers.get(feature.properties.street).has(feature.properties.number) ? 0.3 : 1,
      title: ({ feature }) => feature.properties && feature.properties.number && feature.properties.street ? feature.properties.street + ' - ' + feature.properties.number : '',
      number: ({ feature }) => feature.properties && feature.properties.number ? feature.properties.number : ''
    },
    styleRules: [
      {
        style: {
          fillColor: '${fillColor}',
          fillOpacity: '${opacity}',
          fontColor: '#111111',
          fontOpacity: '${opacity}',
          fontWeight: 'bold',
          strokeColor: '${strokeColor}',
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
      // Try to find nearest segment with name match to latch to
      let nearestSegment = findNearestSegment(feature);
      if (nearestSegment) {
        wmeSDK.Editing.setSelection({
          selection: {
            ids: [ nearestSegment.id ],
            objectType: "segment"
          }
        });
      } else if (!confirm(`Street name "${feature.properties.street}" is unknown. Are you sure you want to add this house number here?`)) {
        return;
      }
      // Store house number
      wmeSDK.DataModel.HouseNumbers.addHouseNumber({
        number: feature.properties.number,
        point: feature.geometry,
        segmentId: nearestSegment?.id
      });
      // Add to streetNumbers
      let nameMatches = wmeSDK.DataModel.Streets.getAll().filter(street => street.name == feature.properties.street).length > 0;
      if (nameMatches) {
        if (!streetNumbers.has(feature.properties.street)) {
          streetNumbers.set(feature.properties.street, new Set());
        }
        streetNumbers.get(feature.properties.street).add(feature.properties.number);
      }
      wmeSDK.Map.redrawLayer({ layerName: LAYER_NAME });
    }
  });
  /* TODO: report that houseNumberId is pretty much useless as there is no way to retrieve a house number somewhere
  wmeSDK.Events.on({
    eventName: "wme-house-number-added",
    eventHandler: (addEvent) => {}
  });
  wmeSDK.Events.on({
    eventName: "wme-house-number-deleted",
    eventHandler: (deleteEvent) => {}
  });*/
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
      updateLayer();
    }
  });
  // House number tracking
  wmeSDK.Events.trackDataModelEvents({ dataModelName: "segmentHouseNumbers" });
  wmeSDK.Events.trackDataModelEvents({ dataModelName: "streets" });
  wmeSDK.Events.on({
    eventName: "wme-data-model-objects-added",
    eventHandler: (eventData) => {
      if (eventData.dataModelName == "segmentHouseNumbers") {
        eventData.objectIds.forEach(segmentHouseNumber => {
          // Ignore IDs received when adding a house number
          if (Number.isInteger(segmentHouseNumber)) {
            return;
          }
          let segmentId = segmentHouseNumber.substring(0, segmentHouseNumber.indexOf("/"));
          let houseNumber = segmentHouseNumber.substring(segmentId.length + 1);
          let segment = wmeSDK.DataModel.Segments.getById({ segmentId: Number(segmentId) });
          if (!segment) {
            log("Housenumber " + segmentHouseNumber + " could not be matched to segment via the API. Weird, but no blocker");
            return;
          }
          [ segment.primaryStreetId, ... segment.alternateStreetIds ].map(streetId => wmeSDK.DataModel.Streets.getById({ streetId: streetId }).name).forEach(streetName => {
            if (!streetNumbers.has(streetName)) {
              streetNumbers.set(streetName, new Set());
            }
            streetNumbers.get(streetName).add(houseNumber);
          });
        });
      } else if (eventData.dataModelName == "streets") {
        eventData.objectIds.map(streetId => wmeSDK.DataModel.Streets.getById({ streetId: streetId })).filter(x => x).forEach(street => streetNames.add(street.name));
      }
      wmeSDK.Map.redrawLayer({ layerName: LAYER_NAME });
    }
  });
  wmeSDK.Events.on({
    eventName: "wme-data-model-objects-removed",
    eventHandler: (eventData) => {
      if (eventData.dataModelName == "segmentHouseNumbers") {
        eventData.objectIds.forEach(segmentHouseNumber => {
          // Ignore IDs received when removing a house number
          if (Number.isInteger(segmentHouseNumber)) {
            return;
          }
          let segmentId = segmentHouseNumber.substring(0, segmentHouseNumber.indexOf("/"));
          let houseNumber = segmentHouseNumber.substring(segmentId.length + 1);
          let segment = wmeSDK.DataModel.Segments.getById({ segmentId: Number(segmentId) });
          if (!segment) {
            log("Housenumber " + segmentHouseNumber + " could not be matched to segment via the API. Weird, but no blocker");
            return;
          }
          [ segment.primaryStreetId, ... segment.alternateStreetIds ].map(streetId => wmeSDK.DataModel.Streets.getById({ streetId: streetId })?.name).forEach(streetName => {
            if (!streetNumbers.has(streetName)) {
              return;
            }
            streetNumbers.get(streetName)?.delete(houseNumber);
            if (streetNumbers.get(streetName)?.delete(houseNumber).size == 0) {
              streetNumbers.delete(streetName);
            }
          });
        });
      } else if (eventData.dataModelName == "streets") {
        eventData.objectIds.map(streetId => wmeSDK.DataModel.Streets.getById({ streetId: streetId })).filter(x => x).forEach(street => streetNames.delete(street.name));
      }
    }
  });
  updateLayer();
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
  let street = wmeSDK.DataModel.Streets.getAll().find(street => street.name == feature.properties.street);
  if (street) {
    return wmeSDK.DataModel.Segments.getAll()
      .filter(segment => segment.primaryStreetId == street.id || segment.alternateStreetIds?.includes(street.id))
      .reduce((current, contender) => {
      contender.distance = turf.pointToLineDistance(feature.geometry, contender.geometry);
      return current.distance < contender.distance ? current : contender;
    }, { distance: Infinity });
  }
  return null;
}

function httpRequest(params, process) {
  return new Promise((resolve, reject) => {
    let defaultParams = {
      method: "GET",
      responseType: 'json',
      onload: response => resolve(process(response)),
      onerror: error => reject(error)
    };
    Object.keys(params).forEach(param => defaultParams[param] = params[param]);
    GM_xmlhttpRequest(defaultParams);
  });
}

function log(message) {
  if (typeof message === 'string') {
    console.log('%cWME Quick HN Importer: %c' + message, 'color:black', 'color:#d97e00');
  } else {
    console.log('%cWME Quick HN Importer:', 'color:black', message);
  }
}
