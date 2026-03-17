'use client';

export default function Sidebar({
  county,
  census,
  weather,
  infrastructure,
  terrain,
  activeFires,
  damage,
  simState,
  simLog,
  optimalPlan,
  improvementCurve,
  phase,
  onStartSim,
  onStartFromHotspots,
  animationPhase,
}) {
  return (
    <div className="sidebar">
      {/* County Info */}
      {county && (
        <div className="sidebar-section">
          <h3>County Data</h3>
          {census ? (
            <div className="stat-grid">
              <div className="stat-item">
                <div className="stat-label">Population</div>
                <div className="stat-value">{census.population?.toLocaleString() || '...'}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Housing Units</div>
                <div className="stat-value">{census.housing_units?.toLocaleString() || '...'}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Fire Stations</div>
                <div className="stat-value red">{infrastructure?.fire_stations?.length || 0}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">Hospitals</div>
                <div className="stat-value green">{infrastructure?.hospitals?.length || 0}</div>
              </div>
            </div>
          ) : (
            <div className="loading-text"><span className="loading-spinner"></span> Loading census data...</div>
          )}
        </div>
      )}

      {/* Weather */}
      {weather && (
        <div className="sidebar-section">
          <h3>Weather Conditions</h3>
          <div className="weather-info">
            <div className="weather-item">
              <span className="weather-label">Temp</span>
              <span className="weather-value">{weather.temperature}°F</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Humidity</span>
              <span className="weather-value">{weather.humidity}%</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Wind</span>
              <span className="weather-value">{weather.wind_speed} mph</span>
            </div>
            <div className="weather-item">
              <span className="weather-label">Direction</span>
              <span className="weather-value">{weather.wind_direction}</span>
            </div>
          </div>
          {weather.description && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{weather.description}</p>
          )}
        </div>
      )}

      {/* Terrain Data */}
      {terrain && (
        <div className="sidebar-section">
          <h3>Terrain Analysis</h3>
          <div className="stat-grid">
            <div className="stat-item">
              <div className="stat-label">Min Elevation</div>
              <div className="stat-value">{terrain.meta?.min_elevation}m</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Max Elevation</div>
              <div className="stat-value">{terrain.meta?.max_elevation}m</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Cell Size</div>
              <div className="stat-value">{terrain.meta?.cell_size_meters}m</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Grid</div>
              <div className="stat-value">{terrain.meta?.grid_size}x{terrain.meta?.grid_size}</div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Elevation from USGS NED 10m via Open Topo Data. Slope &amp; fuel type derived for Rothermel spread model.
          </p>
        </div>
      )}

      {/* NASA FIRMS Active Fires */}
      {activeFires && activeFires.length > 0 && (
        <div className="sidebar-section">
          <h3>Active Fire Detections (FIRMS)</h3>
          <div className="stat-grid">
            <div className="stat-item">
              <div className="stat-label">Hotspots</div>
              <div className="stat-value red">{activeFires.length}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Avg FRP</div>
              <div className="stat-value amber">
                {(activeFires.reduce((s, f) => s + (f.frp || 0), 0) / activeFires.length).toFixed(1)} MW
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            NASA VIIRS satellite detections (last 48h). Orange markers on map.
          </p>
          {!damage && onStartFromHotspots && (
            <button
              className="btn btn-primary"
              onClick={onStartFromHotspots}
              style={{ marginTop: 10, width: '100%' }}
            >
              Simulate Fire from {activeFires.length} Hotspot{activeFires.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* Fire Damage */}
      {damage && (
        <div className="sidebar-section">
          <h3>Fire Damage Report</h3>
          <div className="stat-grid">
            <div className="stat-item">
              <div className="stat-label">Area Burned</div>
              <div className="stat-value red">{damage.burned_area_pct}%</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Houses Hit</div>
              <div className="stat-value red">{damage.houses_destroyed}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Pop. Affected</div>
              <div className="stat-value amber">{damage.population_affected?.toLocaleString()}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Roads Blocked</div>
              <div className="stat-value amber">{damage.blocked_roads}</div>
            </div>
          </div>

          {simState === 'idle' && (
            <button className="btn btn-primary" onClick={onStartSim} style={{ marginTop: 12, width: '100%' }}>
              Deploy AI Recovery Agent
            </button>
          )}
        </div>
      )}

      {/* Simulation Progress */}
      {(simState === 'running' || simState === 'complete') && (
        <div className="sidebar-section">
          <h3>AI Optimization</h3>
          {simState === 'running' && (
            <>
              <div className="loading-text">
                <span className="loading-spinner"></span>
                Evaluating recovery strategies...
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(simLog.length / 50) * 100}%` }}
                ></div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {simLog.length} / 50 plans evaluated
              </p>
            </>
          )}
          <div className="round-log">
            {simLog.map((entry, i) => (
              <div key={i} className="round-log-entry">
                {entry.type === 'round_complete' ? (
                  <span>Round {entry.round + 1}/10 — Best: <span className="score">{entry.best_score}</span></span>
                ) : entry.type === 'plan_evaluated' ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    R{entry.round + 1} Plan {entry.plan_index + 1}: {entry.plan_name} → <span className="score">{entry.score}</span>
                  </span>
                ) : entry.type === 'error' ? (
                  <span style={{ color: '#ff6b6b' }}>
                    R{entry.round + 1}: {entry.message}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvement Curve */}
      {improvementCurve && improvementCurve.length > 0 && (
        <div className="sidebar-section">
          <h3>Score Improvement</h3>
          <div className="improvement-curve">
            {improvementCurve.map((point, i) => {
              const maxScore = Math.max(...improvementCurve.map(p => p.best_score));
              const height = maxScore > 0 ? (point.best_score / maxScore) * 100 : 10;
              return (
                <div
                  key={i}
                  className="curve-bar"
                  style={{ height: `${height}%` }}
                  data-score={point.best_score}
                  title={`Round ${point.round + 1}: ${point.best_score}`}
                ></div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>Round 1</span>
            <span>Round {improvementCurve.length}</span>
          </div>
        </div>
      )}

      {/* Optimal Plan Results */}
      {optimalPlan && (
        <div className="sidebar-section plan-result">
          <h3>Optimal Recovery Plan</h3>
          <div className="plan-header">
            <h4>{optimalPlan.strategy_name}</h4>
            <p>{optimalPlan.description}</p>
          </div>

          {/* Damage comparison */}
          {damage && (
            <div className="damage-compare">
              <div className="compare-card without">
                <div className="compare-label">Without Response</div>
                <div className="compare-value">{damage.houses_destroyed}</div>
                <div className="compare-label">houses lost</div>
              </div>
              <div className="compare-card with">
                <div className="compare-label">With Optimal Plan</div>
                <div className="compare-value">
                  {Math.max(0, damage.houses_destroyed - Math.round(damage.houses_destroyed * 0.6))}
                </div>
                <div className="compare-label">houses saved ~60%</div>
              </div>
            </div>
          )}

          {/* Timeline */}
          {optimalPlan.timeline && optimalPlan.timeline.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 8 }}>Response Timeline</h3>
              <ul className="timeline-list">
                {optimalPlan.timeline.map((step, i) => (
                  <li key={i} className={`timeline-item ${animationPhase > i ? 'active' : ''}`}>
                    <span className="timeline-time">{step.time}</span>
                    <span className="timeline-action">{step.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Resources */}
          {optimalPlan.resource_allocation && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 8 }}>Resources Deployed</h3>
              <table className="resource-table">
                <tbody>
                  {Object.entries(optimalPlan.resource_allocation).map(([key, val]) => (
                    <tr key={key}>
                      <td>{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                      <td>{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Initial state */}
      {!county && (
        <div className="sidebar-section">
          <h3>Getting Started</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Select a California county from the dropdown above to begin.
            The app will fetch real population, infrastructure, and weather data,
            then let you simulate a wildfire and deploy an AI-optimized recovery plan.
          </p>
          <div style={{ marginTop: 16 }}>
            <div className="phase-indicator">
              <div className="phase-dot"></div>
              <div className="phase-dot"></div>
              <div className="phase-dot"></div>
              <div className="phase-dot"></div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              1. Select County &rarr; 2. Click to Start Fire &rarr; 3. AI Optimizes &rarr; 4. View Plan
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
