import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const north = parseFloat(searchParams.get('north'));
  const south = parseFloat(searchParams.get('south'));
  const east = parseFloat(searchParams.get('east'));
  const west = parseFloat(searchParams.get('west'));
  const days = parseInt(searchParams.get('days')) || 2;

  if ([north, south, east, west].some(isNaN)) {
    return NextResponse.json({ error: 'Missing bounds' }, { status: 400 });
  }

  const mapKey = process.env.FIRMS_MAP_KEY;
  if (!mapKey || mapKey === 'your_firms_map_key_here') {
    return NextResponse.json({ active_fires: [], source: 'no_api_key' });
  }

  try {
    // FIRMS area query: west,south,east,north
    const area = `${west},${south},${east},${north}`;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${area}/${days}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ active_fires: [], error: text, source: 'firms_error' });
    }

    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
      return NextResponse.json({ active_fires: [], source: 'firms_empty' });
    }

    // Parse CSV header
    const headers = lines[0].split(',');
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const frpIdx = headers.indexOf('frp');
    const confIdx = headers.indexOf('confidence');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const brightIdx = headers.indexOf('bright_ti4');

    const activeFires = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < headers.length) continue;

      const lat = parseFloat(cols[latIdx]);
      const lon = parseFloat(cols[lonIdx]);
      if (isNaN(lat) || isNaN(lon)) continue;

      activeFires.push({
        lat,
        lon,
        frp: parseFloat(cols[frpIdx]) || 0, // Fire Radiative Power (MW)
        confidence: cols[confIdx] || 'nominal',
        date: cols[dateIdx] || '',
        time: cols[timeIdx] || '',
        brightness: parseFloat(cols[brightIdx]) || 0,
      });
    }

    return NextResponse.json({
      active_fires: activeFires,
      count: activeFires.length,
      source: 'VIIRS_SNPP_NRT',
      days_queried: days,
    });
  } catch (err) {
    return NextResponse.json({ active_fires: [], error: err.message, source: 'fetch_error' });
  }
}
