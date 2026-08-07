// WeatherPort — local weather for the suggestion heuristic (docs/06 §5).
// A keyless weather vendor runs on-device behind this port, but the surface is
// keyless-AGNOSTIC: WeatherInput carries NO credential, so a future keyed vendor
// swaps in without a signature change. No vendor response type leaks.
import { z } from 'zod';

export const WeatherCondition = z.enum([
  'clear',
  'cloudy',
  'rain',
  'snow',
  'fog',
  'wind',
]);
export type WeatherCondition = z.infer<typeof WeatherCondition>;

export const WeatherResultSchema = z.object({
  tempC: z.number(),
  condition: WeatherCondition,
});
export type WeatherResult = z.infer<typeof WeatherResultSchema>;

// Port-owned input — coordinates only, NO api key (keyless-agnostic surface).
export interface WeatherInput {
  readonly lat: number;
  readonly lon: number;
}

export interface WeatherPort {
  getCurrent(input: WeatherInput): Promise<WeatherResult>;
}
