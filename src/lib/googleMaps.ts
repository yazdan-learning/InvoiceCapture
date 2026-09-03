const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// Same escape hatch as the backend's DistanceCalculator port: without a key,
// every caller here degrades to "just use a plain text field" rather than
// the app failing to boot or render.
export function isGoogleMapsConfigured(): boolean {
  return Boolean(apiKey);
}

let loadPromise: Promise<typeof google> | null = null;

// Loads the Maps JS SDK (with the Places library) exactly once, however many
// components ask for it — callers race to be first, everyone shares the result.
export function loadGoogleMaps(): Promise<typeof google> {
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps is not configured'));
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }

    const callbackName = '__onGoogleMapsLoaded';
    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      resolve(window.google);
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });

  return loadPromise;
}
