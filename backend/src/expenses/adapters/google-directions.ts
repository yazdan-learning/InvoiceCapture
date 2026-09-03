import { DistanceCalculator, DistanceResult } from '../ports';

export class GoogleDirectionsCalculator implements DistanceCalculator {
  constructor(private readonly apiKey: string) {}

  async getDistance(from: string, to: string): Promise<DistanceResult> {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', from);
    url.searchParams.set('destination', to);
    url.searchParams.set('key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Directions API request failed (${response.status})`);
    }

    const json = (await response.json()) as {
      status: string;
      routes: { legs: { distance: { value: number }; duration: { value: number } }[] }[];
    };

    const leg = json.routes?.[0]?.legs?.[0];
    if (json.status !== 'OK' || !leg) {
      throw new Error(`Could not find a route between those locations (${json.status})`);
    }

    return {
      distanceKm: leg.distance.value / 1000,
      durationMinutes: Math.round(leg.duration.value / 60)
    };
  }
}
