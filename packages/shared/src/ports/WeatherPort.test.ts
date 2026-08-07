// Tier-0 (docs/05): spec-literal contract test for WeatherPort. Compiler + parse
// signals. RED-FIRST: invalid cases (tempC: "warm", out-of-enum condition) would
// stop throwing under a loosened schema — the throw is the oracle.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { WeatherResultSchema, type WeatherResult, type WeatherPort, type WeatherInput } from './WeatherPort.js';

const validFixture: WeatherResult = { tempC: 12.5, condition: 'rain' };

const fakeWeather: WeatherPort = {
  getCurrent: async () => WeatherResultSchema.parse(validFixture),
};

const fakeWeatherB: WeatherPort = {
  getCurrent: async () => WeatherResultSchema.parse({ tempC: -3, condition: 'snow' }),
};

async function run(port: WeatherPort): Promise<WeatherResult> {
  return port.getCurrent({ lat: 51.5, lon: -0.12 });
}

describe('WeatherPort contract', () => {
  it('parses a spec-shaped fixture and round-trips it', () => {
    expect(WeatherResultSchema.parse(validFixture)).toEqual(validFixture);
  });

  it('swap invariant — two distinct fakes both satisfy the port and run', async () => {
    expect((await run(fakeWeather)).condition).toBe('rain');
    expect((await run(fakeWeatherB)).condition).toBe('snow');
  });

  it('rejects a wrong-type tempC (ZodError)', () => {
    expect(() => WeatherResultSchema.parse({ tempC: 'warm', condition: 'clear' })).toThrow(z.ZodError);
  });

  it('rejects a value outside the condition enum, accepts a documented member', () => {
    expect(() => WeatherResultSchema.parse({ tempC: 10, condition: 'meteor-shower' })).toThrow(z.ZodError);
    expect(WeatherResultSchema.parse({ tempC: 10, condition: 'fog' }).condition).toBe('fog');
  });

  it('WeatherInput carries no credential field (keyless-agnostic surface)', () => {
    // compile-time guard: an api-key property is not assignable to WeatherInput.
    const input: WeatherInput = { lat: 0, lon: 0 };
    expect(Object.keys(input)).toEqual(['lat', 'lon']);
  });
});
