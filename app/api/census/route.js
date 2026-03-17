import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fips = searchParams.get('fips');

  if (!fips) {
    return NextResponse.json({ error: 'Missing fips parameter' }, { status: 400 });
  }

  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Census API key not configured' }, { status: 500 });
  }

  try {
    const url = `https://api.census.gov/data/2023/acs/acs5?get=B01003_001E,B25001_001E&for=county:${fips}&in=state:06&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || data.length < 2) {
      return NextResponse.json({ error: 'No census data found' }, { status: 404 });
    }

    const [, values] = data;
    return NextResponse.json({
      population: parseInt(values[0]) || 0,
      housing_units: parseInt(values[1]) || 0,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Census API error: ' + err.message }, { status: 500 });
  }
}
