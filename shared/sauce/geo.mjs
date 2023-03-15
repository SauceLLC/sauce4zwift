
export function distance([latA, lngA], [latB, lngB]) {
    // haversine method (slow but accurate) - as the crow flies
    const rLatA = latA * Math.PI / 180;
    const rLatB = latB * Math.PI / 180;
    const rDeltaLat = (latB - latA) * Math.PI / 180;
    const rDeltaLng = (lngB - lngA) * Math.PI / 180;
    const rDeltaLatHalfSin = Math.sin(rDeltaLat / 2);
    const rDeltaLngHalfSin = Math.sin(rDeltaLng / 2);
    const a = (rDeltaLatHalfSin * rDeltaLatHalfSin) +
              (Math.cos(rLatA) * Math.cos(rLatB) *
               (rDeltaLngHalfSin * rDeltaLngHalfSin));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371e3 * c;
}


function latPad(dist) {
    const mPerDegree = 0.0000089;
    return dist * mPerDegree;
}


function lngPad(lat, dist) {
    const mPerDegree = 0.0000089;
    return (dist * mPerDegree) / Math.cos(lat * (Math.PI / 180));
}


export function boundingBox(latlngStream, options={}) {
    if (!latlngStream || !latlngStream.length) {
        return;
    }
    let necLat = latlngStream[0][0];
    let necLng = latlngStream[0][1];
    let swcLat = latlngStream[0][0];
    let swcLng = latlngStream[0][1];
    for (const [lat, lng] of latlngStream) {
        if (lat > necLat) {
            necLat = lat;
        }
        if (lng > necLng) {
            necLng = lng;
        }
        if (lat < swcLat) {
            swcLat = lat;
        }
        if (lng < swcLng) {
            swcLng = lng;
        }
    }
    if (options.pad) {
        necLat += latPad(options.pad);
        swcLat -= latPad(options.pad);
        necLng += lngPad(necLat, options.pad);
        swcLng -= lngPad(swcLat, options.pad);
    }
    return {
        nec: [necLat, necLng],
        swc: [swcLat, swcLng]
    };
}


export function inBounds(point, box) {
    // Assumes bbox is true swc and nec..
    return point[0] >= box.swc[0] && point[0] <= box.nec[0] &&
        point[1] >= box.swc[1] && point[1] <= box.nec[1];
}


export function boundsOverlap(boxA, boxB) {
    const yA = boxA.swc[0];
    const yB = boxB.swc[0];
    const hA = boxA.nec[0] - yA;
    const hB = boxB.nec[0] - yB;
    const top = Math.min(yA + hA, yB + hB);
    const bottom = Math.max(yA, yB);
    if (top - bottom < 0) {
        return false;
    }
    const xA = boxA.swc[1];
    const xB = boxB.swc[1];
    const wA = boxA.nec[1] - xA;
    const wB = boxB.nec[1] - xB;
    const right = Math.min(xA + wA, xB + wB);
    const left = Math.max(xA, xB);
    if (right - left < 0) {
        return false;
    }
    return true;
}


export class BDCC {
    constructor(lat, lng) {
        const theta = lng * Math.PI / 180.0;
        const rlat = this.geocentricLatitude(lat * Math.PI / 180.0);
        const c = Math.cos(rlat);
        this.x = c * Math.cos(theta);
        this.y = c * Math.sin(theta);
        this.z = Math.sin(rlat);
    }

    // Convert from geographic to geocentric latitude (radians).
    geocentricLatitude(geographicLatitude) {
        const flattening = 1.0 / 298.257223563;  // WGS84
        return Math.atan((Math.tan(geographicLatitude) * ((1.0 - flattening) ** 2)));
    }

    // Convert from geocentric to geographic latitude (radians)
    geographicLatitude(geocentricLatitude) {
        const flattening = 1.0 / 298.257223563;  // WGS84
        return Math.atan(Math.tan(geocentricLatitude) / ((1.0 - flattening) ** 2));
    }

    // Returns the two antipodal points of intersection of two great circles defined by the
    // arcs geo1 to geo2 and geo3 to geo4. Returns a point as a Geo, use .antipode to get the
    // other point
    getIntersection(geo1,  geo2,  geo3,  geo4) {
        const geoCross1 = geo1.crossNormalize(geo2);
        const geoCross2 = geo3.crossNormalize(geo4);
        return geoCross1.crossNormalize(geoCross2);
    }

    radiansToMeters(rad) {
        return rad * 6378137.0;  // WGS84 Equatorial Radius in Meters
    }

    metersToRadians(m) {
        return m / 6378137.0;  // WGS84 Equatorial Radius in Meters
    }

    getLatitudeRadians() {
        return this.geographicLatitude(
            Math.atan2(this.z, Math.sqrt((this.x ** 2) + (this.y ** 2))));
    }

    getLongitudeRadians() {
        return Math.atan2(this.y, this.x);
    }

    getLatitude() {
        return this.getLatitudeRadians() * 180.0 / Math.PI;
    }

    getLongitude() {
        return this.getLongitudeRadians() * 180.0 / Math.PI ;
    }

    dot(b) {
        return (this.x * b.x) + (this.y * b.y) + (this.z * b.z);
    }

    crossLength(b) {
        const x = (this.y * b.z) - (this.z * b.y);
        const y = (this.z * b.x) - (this.x * b.z);
        const z = (this.x * b.y) - (this.y * b.x);
        return Math.sqrt((x * x) + (y * y) + (z * z));
    }

    static scale(s) {
        const r = new this(0, 0);
        r.x = this.x * s;
        r.y = this.y * s;
        r.z = this.z * s;
        return r;
    }

    crossNormalize(b) {
        const x = (this.y * b.z) - (this.z * b.y);
        const y = (this.z * b.x) - (this.x * b.z);
        const z = (this.x * b.y) - (this.y * b.x);
        const L = Math.sqrt((x * x) + (y * y) + (z * z));
        const r = new BDCC(0, 0);
        r.x = x / L;
        r.y = y / L;
        r.z = z / L;
        return r;
    }

    // Point on opposite side of the world from this point.
    antipode() {
        return this.constructor.scale(-1.0);
    }

    // Distance in radians from this point to point v2.
    distance(v2) {
        return Math.atan2(v2.crossLength(this), v2.dot(this));
    }

    // Returns in meters the minimum of the perpendicular distance of this point to the line
    // segment geo1-geo2 and the distance from this point to the line segment ends in geo1 and
    // geo2.
    distanceToLine(geo1, geo2) {
        // Point on unit sphere above origin and normal to plane of geo1,geo2 could be either
        // side of the plane.
        const p2 = geo1.crossNormalize(geo2);
        const d = geo1.distance(geo2);
        // Intersection of GC normal to geo1/geo2 passing through p with GC geo1/geo2.
        let ip = this.getIntersection(geo1, geo2, this, p2);
        let d1p = geo1.distance(ip);
        let d2p = geo2.distance(ip);
        // Need to check that ip or its antipode is between p1 and p2.
        if ((d >= d1p) && (d >= d2p)) {
            return this.radiansToMeters(this.distance(ip));
        } else {
            ip = ip.antipode();
            d1p = geo1.distance(ip);
            d2p = geo2.distance(ip);
        }
        if (d >= d1p && d >= d2p) {
            return this.radiansToMeters(this.distance(ip));
        } else {
            return this.radiansToMeters(Math.min(geo1.distance(this), geo2.distance(this)));
        }
    }

    *middleOutIter(data, start) {
        const len = data.length;
        let count = 0;
        let left = Math.max(0, Math.min(len, start == null ? Math.floor(len / 2) : start));
        let right = left;
        while (count++ < len) {
            let idx;
            if ((count % 2 && left > 0) || right === len) {
                idx = --left;
            } else {
                idx = right++;
            }
            yield [data[idx], idx];
        }
    }

    *hotColdIter(data, start) {
        const len = data.length;
        let count = 0;
        let left = Math.max(0, Math.min(len, start == null ? Math.floor(len / 2) : start));
        let right = left;
        let isHot;
        while (count++ < len) {
            let idx;
            if (isHot && right < len) {
                idx = right++;
            } else if ((count % 2 && left > 0) || right === len) {
                idx = --left;
            } else {
                idx = right++;
            }
            isHot = yield [data[idx], idx];
        }
    }

    // Distance in meters from lat/lng point to polyline (array of lat/lng points).
    distanceToPolylineHotcold(polyline, options={}) {
        const min = options.min;
        let minDistance = Infinity;
        let offset;
        let isHot;
        const hotColdIter = this.hotColdIter(polyline, options.offsetHint);
        for (;;) {
            const x = hotColdIter.next(isHot);
            if (x.done) {
                break;
            }
            const [[latA, lngA], i] = x.value;
            if (i === polyline.length - 1) {
                continue;
            }
            const [latB, lngB] = polyline[i + 1];
            const d = this.distanceToLine(new BDCC(latA, lngA), new BDCC(latB, lngB));
            if (d < minDistance) {
                minDistance = d;
                isHot = true;
                offset = i;
                if (min !== undefined && d <= min) {
                    break;  // Allow caller to optimize when they only care if we are close.
                }
            } else {
                isHot = false;
            }
        }
        return [minDistance, offset];
    }

    // Distance in meters from lat/lng point to polyline (array of lat/lng points).
    distanceToPolylineMiddleout(polyline, options={}) {
        const min = options.min;
        let minDistance = Infinity;
        let offset;
        for (const [[latA, lngA], i] of this.middleOutIter(polyline, options.offsetHint)) {
            if (i === polyline.length - 1) {
                continue;
            }
            const [latB, lngB] = polyline[i + 1];
            const d = this.distanceToLine(new BDCC(latA, lngA), new BDCC(latB, lngB));
            if (d < minDistance) {
                minDistance = d;
                offset = i;
                if (min !== undefined && d <= min) {
                    break;  // Allow caller to optimize when they only care if we are close.
                }
            }
        }
        return [minDistance, offset];
    }

    // Distance in meters from lat/lng point to polyline (array of lat/lng points).
    distanceToPolylineLinear(polyline, options={}) {
        const min = options.min;
        let minDistance = Infinity;
        for (let i = 0; i < polyline.length - 1; i++) {
            const [latA, lngA] = polyline[i];
            const [latB, lngB] = polyline[i + 1];
            const d = this.distanceToLine(new BDCC(latA, lngA), new BDCC(latB, lngB));
            if (d < minDistance) {
                minDistance = d;
            }
            if (d <= min) {
                break;  // Allow caller to optimize when they only care if we are close.
            }
        }
        return [minDistance, 0];
    }

    distanceToPolyline(polyline, options) {
        //return this.distanceToPolylineLinear(polyline, options);
        //return this.distanceToPolylineMiddleout(polyline, options);
        return this.distanceToPolylineHotcold(polyline, options);
    }
}


export function createVAMStream(timeStream, altStream) {
    const vams = [0];
    for (let i = 1; i < timeStream.length; i++) {
        if (timeStream[i] === timeStream[i - 1]) {
            // Sadly this is possible and we just punt..
            // See https://www.strava.com/activities/5070815568 index 5218
            vams.push(0);
            continue;
        }
        const gain = Math.max(0, altStream[i] - altStream[i - 1]);
        vams.push((gain / (timeStream[i] - timeStream[i - 1])) * 3600);
    }
    return vams;
}


export function altitudeChanges(stream) {
    let gain = 0;
    let loss = 0;
    if (stream && stream.length) {
        let last = stream[0];
        for (const x of stream) {
            if (x > last) {
                gain += x - last;
            } else {
                loss += last - x;
            }
            last = x;
        }
    }
    return {gain, loss};
}
