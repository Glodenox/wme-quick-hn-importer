# WME Quick HN Importer

This userscript augments the [Waze Map Editor](https://www.waze.com/editor/) by making it easier to quickly add house numbers with data from an external open database (not configurable). When enabled, the script provides an overview of all known house numbers in streets in certain parts of the world (see below) and whenever you add a house number, it will automatically fill in the number of the nearest house number.

### Currently supported regions

- Belgium
- The Netherlands

## Installation instructions

> TL;DR: install as most other WME userscripts from its [Greasy Fork page](https://greasyfork.org/scripts/421430-wme-quick-hn-importer)

Userscripts are snippets of code that are executed after the loading of certain webpages. This script does this after the loading of the Waze Map Editor. In order to run userscripts in your browser, you are adviced to use Firefox or Google Chrome.

You will need to install an add-on that manages userscripts for this to work. There is TamperMonkey for [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) and [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).

These add-ons will be visible in the browser with an additional button that is visible to the right of the address bar. Through this button it will be possible to maintain any userscripts you install.

You should be able to install the script at [Greasy Fork](https://greasyfork.org/scripts/421430-wme-quick-hn-importer). There will be a big green install button which you will have to press to install the script.
__When installing userscripts always pay attention to the site(s) on which the script runs.__ This script only runs on Waze.com, so other sites will not be affected in any way.

After installing a userscript, you will be able to find it working on the site(s) specified. Do note that if you had the page open before installing the userscript, you will first need to refresh the page.

TamperMonkey will occasionally check for new versions of these scripts. You will get a notification when a new version has been found and installed.

## How to use

Go into the house number editing mode of a segment and enable the Quick HN Importer with the new checkbox next to the "Add Housenumber" button. At this point, the script will load the house numbers and will press the "Add Housenumber" button for you. Click near the house numbers you wish to add or press ESC to stop. Save as usual. If you leave the checkbox enabled, it will automatically load the house numbers the next time you open the house number mode during this session.

## Feedback and suggestions

Any issues found can be reported at the [GitHub project page](https://github.com/Glodenox/wme-quick-hn-importer/issues). A forum thread may be made later when more sources are added, but is currently not foreseen.
