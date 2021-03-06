import DataSource, {NetworkSource, NetworkTileSource} from './data_source';
import {MVTSource} from './mvt';
import Geo from '../geo';

// For tiling GeoJSON client-side
import geojsonvt from 'geojson-vt';


/**
 Mapzen/OSM.US-style GeoJSON vector tiles
 @class GeoJSONTileSource
*/
export class GeoJSONTileSource extends NetworkTileSource {

    constructor(source) {
        super(source);

        // Check for URL tile pattern, if not found, treat as standalone GeoJSON/TopoJSON object
        if (!this.urlHasTilePattern(this.url)) {
            // Check instance type from parent class
            if (this instanceof GeoJSONTileSource) {
                // Replace instance type
                return new GeoJSONSource(source);
            }
            else {
                // Pass back to parent class to instantiate
                return null;
            }
        }
        return this;
    }

    parseSourceData (tile, source, response) {
        let data = JSON.parse(response);
        this.prepareGeoJSON(data, tile, source);
    }

    prepareGeoJSON (data, tile, source) {
        // Apply optional data transform
        if (typeof this.transform === 'function') {
            data = this.transform(data, this.extra_data);
        }

        source.layers = GeoJSONSource.prototype.getLayers(data);

        // A "synthetic" tile that adjusts the tile min anchor to account for tile longitude wrapping
        let anchor = {
            coords: tile.coords,
            min: Geo.metersForTile(Geo.wrapTile(tile.coords, { x: true }))
        };

        DataSource.projectData(source); // mercator projection
        DataSource.scaleData(source, anchor); // re-scale from meters to local tile coords
    }

}


/**
 GeoJSON standalone (non-tiled) source
 Uses geojson-vt split into tiles client-side
*/

export class GeoJSONSource extends NetworkSource {

    constructor(source) {
        super(source);
        this.tiled = true;
        this.load_data = null;
        this.tile_indexes = {}; // geojson-vt tile indices, by layer name
        this.max_zoom = Math.max(this.max_zoom || 0, 15); // TODO: max zoom < 15 causes artifacts/no-draw at 20, investigate
        this.pad_scale = 0; // we don't want padding on auto-tiled sources
        this.enforce_winding = (source.enforce_winding === false) ? false : true; // default on, can be forced off
    }

    _load(dest) {
        if (!this.load_data) {
            this.load_data = super._load({ source_data: { layers: {} } }).then(data => {
                let layers = data.source_data.layers;
                for (let layer_name in layers) {
                    this.tile_indexes[layer_name] = geojsonvt(layers[layer_name], {
                        maxZoom: this.max_zoom,  // max zoom to preserve detail on
                        tolerance: 3, // simplification tolerance (higher means simpler)
                        extent: Geo.tile_scale, // tile extent (both width and height)
                        buffer: 0     // tile buffer on each side
                    });
                }

                this.loaded = true;
                return data;
            });
        }

        return this.load_data.then(() => {
            for (let layer_name in this.tile_indexes) {
                dest.source_data.layers[layer_name] = this.getTileFeatures(dest, layer_name);
            }
            return dest;
        });
    }

    getTileFeatures(tile, layer_name) {
        let coords = Geo.wrapTile(tile.coords, { x: true });

        // request a particular tile
        let t = this.tile_indexes[layer_name].getTile(coords.z, coords.x, coords.y);

        // Convert from MVT-style JSON struct to GeoJSON
        let collection;
        if (t && t.features) {
            collection = {
                type: 'FeatureCollection',
                features: []
            };

            for (let feature of t.features) {
                // GeoJSON feature
                let f = {
                    type: 'Feature',
                    geometry: {},
                    properties: feature.tags
                };

                if (feature.type === 1) {
                    f.geometry.coordinates = feature.geometry.map(coord => [coord[0], coord[1]]);
                    f.geometry.type = 'MultiPoint';
                }
                else if (feature.type === 2 || feature.type === 3) {
                    f.geometry.coordinates = feature.geometry.map(ring =>
                        ring.map(coord => [coord[0], coord[1]])
                    );

                    if (feature.type === 2) {
                        f.geometry.type = 'MultiLineString';
                    }
                    else  {
                        f.geometry = MVTSource.decodeMultiPolygon(f.geometry); // un-flatten rings
                    }
                }
                else {
                    continue;
                }

                collection.features.push(f);
            }
        }

        return collection;
    }

    formatUrl (dest) {
        return this.url;
    }

    parseSourceData (tile, source, response) {
        source.layers = this.getLayers(JSON.parse(response));
    }

    // Detect single or multiple layers in returned data
    getLayers (data) {
        if (data.type === 'Feature' || data.type === 'FeatureCollection') {
            return { _default: data };
        }
        else {
            return data;
        }
    }

}

DataSource.register(GeoJSONTileSource, 'GeoJSON');      // prefered shorter name
DataSource.register(GeoJSONTileSource, 'GeoJSONTiles'); // for backwards-compatibility
