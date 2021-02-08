// ==UserScript==
// @name         WME Quick HN Importer
// @namespace    http://www.wazebelgium.be/
// @version      1.0
// @description  Quickly add house numbers based on open data sources of house numbers
// @author       Tom 'Glodenox' Puttemans
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @grant        none
// ==/UserScript==

/* global W, OpenLayers */

(function() {
  'use strict';

  function init(e) {
    if (e && e.user == null) {
      return;
    }
    if (OpenLayers == null) {
      setTimeout(init, 500);
      log('OpenLayers object not yet available, page still loading');
    }
    if (document.getElementById('user-info') == null) {
      setTimeout(init, 500);
      log('user-info element not yet available, page still loading');
      return;
    }
    if (typeof W === 'undefined' || typeof W.loginManager === 'undefined' || typeof W.prefs === 'undefined' || typeof W.map === 'undefined' || document.getElementById('edit-buttons') == null) {
      setTimeout(init, 300);
      return;
    }
    if (!W.loginManager.user) {
      W.loginManager.events.register('login', null, init);
      W.loginManager.events.register('loginStatus', null, init);
      // Double check as event might have triggered already
      if (!W.loginManager.user) {
        return;
      }
    }

    var currentStreetId = null;
    var streetNames = {};
    var layer = new OpenLayers.Layer.Vector('Quick HN importer', {
      uniqueName: 'quick-hn-importer',
      styleMap: new OpenLayers.StyleMap({
        "default": new OpenLayers.Style({
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
        }, {
          context: {
            fillColor: (feature) => feature.attributes && feature.attributes.street == currentStreetId ? '#99ee99' : '#cccccc',
            radius: (feature) => feature.attributes && feature.attributes.number ? Math.max(feature.attributes.number.length * 6, 10) : 10,
            opacity: (feature) => feature.attributes && feature.attributes.street == currentStreetId && feature.attributes.processed ? 0.3 : 1,
            title: (feature) => feature.attributes && feature.attributes.number && feature.attributes.street ? streetNames[feature.attributes.street] + ' ' + feature.attributes.number : ''
          }
        })
      }),
    });
    I18n.translations[I18n.currentLocale()].layers.name['quick-hn-importer'] = 'Quick HN Importer';
    layer.setVisibility(false);
    W.map.addLayer(layer);

    var streets = {}; // Container for all currently loaded street names
    var updateLayer = () => {
      var segmentSelection = W.selectionManager.getSegmentSelection();
      if (!segmentSelection.segments || segmentSelection.segments.length == 0) {
        return;
      }
      var bounds = null;
      segmentSelection.segments.forEach((segment) => bounds == null ? bounds = segment.attributes.geometry.bounds : bounds.extend(segment.attributes.geometry.bounds));
      fetch(`https://www.wazebelgium.be/quick-hn-import/?left=${Math.floor(bounds.left - 200)}&top=${Math.floor(bounds.top + 200)}&right=${Math.floor(bounds.right + 200)}&bottom=${Math.floor(bounds.bottom - 200)}`).then((response) => {
        if (!response.ok) {
          console.error(response);
        }
        return response.text();
      }).then((text) => {
        var features = [];
        var currentHouseNumbers =  W.model.segmentHouseNumbers.getObjectArray().map((houseNumber) => houseNumber.attributes.number);
        text.split("\n").forEach((line) => {
          var values = line.split(',');
          if (values.length == 4) { // House number
            features.push(new OpenLayers.Feature.Vector(new OpenLayers.Geometry.Point(values[0], values[1]), {
              number: values[2],
              street: values[3],
              processed: currentHouseNumbers.indexOf(values[2]) != -1
            }));
          } else if (values.length == 2) { // Street name
            streets[values[1]] = values[0];
            streetNames[values[0]] = values[1];
          }
        });
        var streetIds = segmentSelection.segments[0].attributes.streetIDs;
        streetIds.push(segmentSelection.segments[0].attributes.primaryStreetID);
        var selectedStreetNames = W.model.streets.getByIds(streetIds).map((street) => street.name);
        var matchingStreetName = selectedStreetNames.find((streetName) => streets[streetName] != undefined);
        currentStreetId = streets[matchingStreetName];
        layer.addFeatures(features);
      }).catch((error) => {
        console.error('Error', error);
      });
    };

    var editButtons = document.getElementById('edit-buttons');
    var menuToggle = document.createElement('div');
    menuToggle.className = 'toolbar-button toolbar-button-with-label toolbar-button-with-icon';
    menuToggle.innerHTML = `
      <div class="item-icon" style="margin-left: 16px;">
        <wz-checkbox name="enableQuickHNImporter" value="off" checked=""></wz-checkbox>
      </div>
      <div class="item-container" style="padding-left: 0;">
        <span class="menu-title">Enable Quick HN importer</span>
      </div>`;
    var toggle = menuToggle.querySelector('wz-checkbox');
    menuToggle.querySelector('.item-container').addEventListener('click', () => {
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change', { 'bubbles': true }));
    });
    toggle.checked = false;
    toggle.addEventListener('change', (e) => {
      if (layer.features.length == 0) {
        updateLayer();
      }
      layer.setVisibility(e.target.checked);
      if (e.target.checked) {
        editButtons.querySelector('.add-house-number').click();
      }
    });

    var houseNumberObserver = new MutationObserver((mutations) => {
      if (!toggle.checked) {
        return;
      }
      mutations.filter((mutation) => mutation.target.classList.contains('content')).forEach((mutation) => {
        if (!mutation.target.classList.contains('new') && mutation.target.classList.contains('active')) {
          var numberInput = mutation.target.querySelector('input.number');
          if (numberInput.value == '') { // Do not interfere when adjusting an existing house number
            // Find nearest house number
            var locationLonLat = W.map.getLayersByName('houseNumberMarkers')[0].markers.find((marker) => marker.isNew).lonlat;
            var location = new OpenLayers.Geometry.Point(locationLonLat.lon, locationLonLat.lat);
            var nearestFeature = layer.features.filter((feature) => !feature.attributes.processed).reduce((prev, feature) => prev.geometry.distanceTo(location) > feature.geometry.distanceTo(location) ? feature : prev);
            // Fill in data and prepare for next click
            if (nearestFeature) {
              numberInput.value = nearestFeature.data.number;
              numberInput.dispatchEvent(new Event('change', { 'bubbles': true })); // dispatch event so WME sees the content as changed
              editButtons.querySelector('.add-house-number').click();
              nearestFeature.attributes.processed = true;
              layer.redraw();
            }
          }
        }
      });
    });
    var menuObserver = new MutationObserver(() => {
      // If we've entered house number mode
      if (editButtons.querySelector('.add-house-number') != null) {
        editButtons.childNodes[0].insertBefore(menuToggle, editButtons.querySelector('.waze-icon-exit'));
        houseNumberObserver.observe(document.querySelector('div.olLayerDiv.house-numbers-layer'), { subtree: true, attributes: true });
        if (toggle.checked) {
          updateLayer();
          layer.setVisibility(true);
        }
      } else {
        layer.setVisibility(false);
        layer.removeAllFeatures();
        streets = {};
        streetNames = {};
      }
    });
    menuObserver.observe(editButtons, { childList: true });
  }

  function log(message) {
    if (typeof message === 'string') {
      console.log('%cWME Quick HN Importer: %c' + message, 'color:black', 'color:#d97e00');
    } else {
      console.log('%cWME Quick HN Importer:', 'color:black', message);
    }
  }

  init();
})();