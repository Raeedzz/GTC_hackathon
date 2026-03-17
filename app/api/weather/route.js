import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat'));
  const lon = parseFloat(searchParams.get('lon'));

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'Missing lat/lon' }, { status: 400 });
  }

  try {
    // Step 1: Get forecast URL from points endpoint
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { 'User-Agent': 'WildfireRecoverySim/1.0' } }
    );
    const pointsData = await pointsRes.json();
    const forecastUrl = pointsData.properties?.forecastHourly;

    if (!forecastUrl) {
      throw new Error('No forecast URL from NOAA');
    }

    // Step 2: Get hourly forecast
    const forecastRes = await fetch(forecastUrl, {
      headers: { 'User-Agent': 'WildfireRecoverySim/1.0' },
    });
    const forecastData = await forecastRes.json();
    const period = forecastData.properties?.periods?.[0];

    if (!period) {
      throw new Error('No forecast periods');
    }

    // Parse wind speed (e.g., "10 mph" -> 10)
    const windSpeedMatch = period.windSpeed?.match(/(\d+)/);
    const windSpeed = windSpeedMatch ? parseInt(windSpeedMatch[1]) : 10;

    // Map wind direction to degrees
    const directionMap = {
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
      E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
      W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
    };

    return NextResponse.json({
      temperature: period.temperature || 75,
      humidity: period.relativeHumidity?.value || 30,
      wind_speed: windSpeed,
      wind_direction: period.windDirection || 'N',
      wind_direction_degrees: directionMap[period.windDirection] || 0,
      description: period.shortForecast || 'Clear',
    });
  } catch (err) {
    // Fallback weather for fire-prone conditions
    return NextResponse.json({
      temperature: 95,
      humidity: 15,
      wind_speed: 25,
      wind_direction: 'NE',
      wind_direction_degrees: 45,
      description: 'Hot and dry (fallback data)',
    });
  }
}
