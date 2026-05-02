import React, { useEffect, useMemo, useState } from 'react';
import { Circle, MapContainer, Marker, Popup, ScaleControl, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OTTAWA_CENTER = [38.6159, -95.2672];
const MAX_DISTANCE_MILES = 10;
const VAL_TOWN_ENDPOINT =
  import.meta.env.VITE_VAL_TOWN_ENDPOINT || 'https://YOUR-VAL-TOWN-ENDPOINT-HERE.web.val.run';

const defaultPin = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

function milesBetween([lat1, lng1], [lat2, lng2]) {
  const r = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = r(lat2 - lat1);
  const dLng = r(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeCoords(item) {
  const rawLat = item.lat ?? item.latitude;
  const rawLng = item.lng ?? item.lon ?? item.long ?? item.longitude;

  let lat = Number(rawLat);
  let lng = Number(rawLng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) return { lat: NaN, lng: NaN };

  // If lat/lng were reversed in data entry, recover automatically.
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
  }

  return { lat, lng };
}

function FitSalesBounds({ sales }) {
  const map = useMap();
  useEffect(() => {
    if (!sales.length) return;
    map.fitBounds(
      L.latLngBounds(sales.map((s) => [s.lat, s.lng])).pad(0.15)
    );
  }, [map, sales]);
  return null;
}

function App() {
  const [sales, setSales] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('map');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    street_address: '', city: 'Ottawa', state: 'KS', zip: '', name: '', lat: '', lng: ''
  });

  const visibleSales = useMemo(
    () => sales.filter((s) => includeClosed || !s.is_closed),
    [sales, includeClosed]
  );

  const fetchSales = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${VAL_TOWN_ENDPOINT}?includeClosed=true`);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : payload.sales ?? [];

      const cleaned = list
        .map((item, index) => {
          const { lat, lng } = normalizeCoords(item);
          return {
            id: item.id ?? `${item.street_address}-${index}`,
            address: [item.street_address, item.city, item.state, item.zip].filter(Boolean).join(', '),
            street_address: item.street_address,
            name: item.name ?? 'Garage Sale',
            lat,
            lng,
            is_closed: Boolean(item.is_closed)
          };
        })
        .filter(
          (i) =>
            i.street_address &&
            !Number.isNaN(i.lat) &&
            !Number.isNaN(i.lng) &&
            milesBetween(OTTAWA_CENTER, [i.lat, i.lng]) <= MAX_DISTANCE_MILES
        );

      setSales(cleaned);
      setError('');
    } catch (e) {
      setError(`Unable to load sales. ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSales();
  }, []);

  const addSale = async (event) => {
    event.preventDefault();
    const res = await fetch(VAL_TOWN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to add sale');
      return;
    }
    setShowAdd(false);
    setForm({ street_address: '', city: 'Ottawa', state: 'KS', zip: '', name: '', lat: '', lng: '' });
    fetchSales();
  };

  const markClosed = async (id, isClosed) => {
    const res = await fetch(VAL_TOWN_ENDPOINT, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, is_closed: isClosed })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to update sale');
      return;
    }
    fetchSales();
  };

  return <main className="app-shell"><header className="header"><div><h1>Ottawa, KS Garage Sales</h1><p>Within 10 miles of Ottawa. Address-first display.</p></div><div className="controls"><label><input type="checkbox" checked={includeClosed} onChange={(e)=>setIncludeClosed(e.target.checked)} /> Show closed</label><div className="toggle"><button className={view==='map'?'active':''} onClick={()=>setView('map')}>Map</button><button className={view==='list'?'active':''} onClick={()=>setView('list')}>List</button></div></div></header>{loading&&<p className="status">Loading…</p>}{error&&<p className="status error">{error}</p>}
  {!loading && !error && view==='map' && <section className="map-wrap"><MapContainer center={OTTAWA_CENTER} zoom={13} scrollWheelZoom className="map"><TileLayer attribution='&copy; OpenStreetMap &copy; CARTO' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"/><Circle center={OTTAWA_CENTER} radius={MAX_DISTANCE_MILES*1609.34} pathOptions={{color:'#4f8cc9',fillColor:'#4f8cc9',fillOpacity:0.05}} />{visibleSales.map((sale)=><Marker key={sale.id} position={[sale.lat,sale.lng]} icon={defaultPin}><Popup><strong className="popup-address">{sale.address}</strong><br/><span>{sale.name}</span><br/><button onClick={()=>markClosed(sale.id,!sale.is_closed)}>{sale.is_closed?'Reopen':'Mark closed'}</button></Popup></Marker>)}<FitSalesBounds sales={visibleSales} /><ScaleControl position="bottomleft" imperial maxWidth={130} /></MapContainer></section>}
  {!loading && !error && view==='list' && <section className="list-wrap"><ul>{visibleSales.map((sale)=><li key={sale.id} className={sale.is_closed?'closed':''}><h2>{sale.address}</h2><p className="sale-name">{sale.name}</p><button onClick={()=>markClosed(sale.id,!sale.is_closed)}>{sale.is_closed?'Reopen':'Mark closed'}</button></li>)}</ul></section>}
  <button className="fab" onClick={()=>setShowAdd(true)}>＋ Add sale</button>
  {showAdd && <div className="modal-backdrop" onClick={()=>setShowAdd(false)}><form className="modal" onClick={(e)=>e.stopPropagation()} onSubmit={addSale}><h3>Post new sale</h3><input required placeholder="Street address" value={form.street_address} onChange={(e)=>setForm({...form, street_address:e.target.value})}/><div className="row"><input required placeholder="City" value={form.city} onChange={(e)=>setForm({...form, city:e.target.value})}/><input required placeholder="State" value={form.state} onChange={(e)=>setForm({...form, state:e.target.value})}/><input required placeholder="ZIP" value={form.zip} onChange={(e)=>setForm({...form, zip:e.target.value})}/></div><input placeholder="Name (optional)" value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})}/><div className="row"><input required placeholder="Latitude" value={form.lat} onChange={(e)=>setForm({...form, lat:e.target.value})}/><input required placeholder="Longitude" value={form.lng} onChange={(e)=>setForm({...form, lng:e.target.value})}/></div><div className="row"><button type="submit">Submit</button><button type="button" onClick={()=>setShowAdd(false)}>Cancel</button></div></form></div>}
</main>;
}

export default App;
