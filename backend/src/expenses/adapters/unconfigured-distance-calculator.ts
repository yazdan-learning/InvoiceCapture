import { DistanceCalculator, DistanceResult } from '../ports';

// Stand-in used until GOOGLE_DIRECTIONS_API_KEY is set. Manual distance entry
// keeps working with no configuration at all; only the "calculate for me"
// path needs this — and it fails with a clear, actionable message rather
// than crashing the app at boot for lack of a key.
export class UnconfiguredDistanceCalculator implements DistanceCalculator {
  async getDistance(_from: string, _to: string): Promise<DistanceResult> {
    throw new Error('Map-based distance calculation is not set up yet. Enter the distance manually.');
  }
}
