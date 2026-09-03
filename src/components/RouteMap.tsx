import { useEffect, useRef, useState } from 'react';
import { isGoogleMapsConfigured, loadGoogleMaps } from '../lib/googleMaps';

type Props = {
  origin: string;
  destination: string;
};

const DEFAULT_CENTER = { lat: 48, lng: 10 };
const DEFAULT_ZOOM = 5;

// The map itself renders immediately on mount, so the page doesn't feel empty
// while you're still filling in locations. The route/pins only draw once both
// `origin` and `destination` are "confirmed" (autocomplete selection or a
// successful distance calculation) — the parent is responsible for not
// passing raw keystrokes in here, so this never re-geocodes on every letter typed.
export function RouteMap({ origin, destination }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isGoogleMapsConfigured() || !mapDivRef.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapDivRef.current) return;
        mapRef.current = new g.maps.Map(mapDivRef.current, {
          zoom: DEFAULT_ZOOM,
          center: DEFAULT_CENTER,
          disableDefaultUI: true,
          zoomControl: true
        });
        rendererRef.current = new g.maps.DirectionsRenderer({ map: mapRef.current });
      })
      .catch(() => setError('Could not load the map.'));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!origin.trim() || !destination.trim()) return;
    let cancelled = false;

    loadGoogleMaps().then((g) => {
      if (cancelled || !rendererRef.current) return;
      new g.maps.DirectionsService().route(
        { origin, destination, travelMode: g.maps.TravelMode.DRIVING },
        (result, status) => {
          if (cancelled || !rendererRef.current) return;
          if (status === 'OK' && result) {
            rendererRef.current.setDirections(result);
            setError(null);
          } else {
            setError('Could not show this route on the map.');
          }
        }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [origin, destination]);

  if (!isGoogleMapsConfigured()) return null;

  return (
    <div className="route-map-wrap">
      <div ref={mapDivRef} className="route-map" />
      {error && (
        <div className="alert alert-error alert-inline">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
