import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, 
  Swords, 
  Skull, 
  Zap, 
  Play, 
  Pause, 
  RefreshCw, 
  Key, 
  Globe, 
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { GameConfig, GameState, ModelType, ScenarioType, TurnDecision } from './types';
import { createInitialState, resolveTurn } from './game/engine';
import { getMockDecision } from './llm/mock';
import { fetchModelDecision } from './llm/openrouter';
import { fetchLiveNews } from './llm/newsFetcher';
import type { NewsArticle } from './llm/newsFetcher';
import { audioSystem } from './audio';
import { TypewriterLog } from './components/TypewriterLog';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { ActionType } from './types';

const HumanActionPanel = ({
  side,
  onSubmit
}: {
  side: 'alpha' | 'beta';
  onSubmit: (decision: TurnDecision) => void;
}) => {
  const [declared, setDeclared] = useState<ActionType>('STATUS_QUO');
  const [actual, setActual] = useState<ActionType>('STATUS_QUO');
  
  return (
    <div className="bp-card" style={{ padding: '15px', background: 'var(--bp-bg-page)', borderTop: `2px solid var(--color-${side})`, marginBottom: '10px' }}>
      <h3 style={{ color: `var(--color-${side})`, marginTop: 0, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ShieldAlert size={16} /> HUMAN COMMANDER OVERRIDE: {side.toUpperCase()}
      </h3>
      <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
        <div style={{ flex: 1 }}>
          <label className="input-label" style={{ color: '#8a9ba8' }}>Declared Action (Public Stance)</label>
          <select className="bp-select" value={declared} onChange={e => setDeclared(e.target.value as ActionType)}>
            <option value="DE_ESCALATE">DE_ESCALATE</option>
            <option value="STATUS_QUO">STATUS_QUO</option>
            <option value="CYBER_ATTACK">CYBER_ATTACK</option>
            <option value="SANCTIONS">SANCTIONS</option>
            <option value="AIRSTRIKE">AIRSTRIKE</option>
            <option value="INVASION">INVASION</option>
            <option value="TACTICAL_NUKE">TACTICAL_NUKE</option>
            <option value="STRATEGIC_NUKE">STRATEGIC_NUKE</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="input-label" style={{ color: '#eb532d' }}>Actual Action (Covert/Overt Execution)</label>
          <select className="bp-select" value={actual} onChange={e => setActual(e.target.value as ActionType)}>
            <option value="DE_ESCALATE">DE_ESCALATE</option>
            <option value="STATUS_QUO">STATUS_QUO</option>
            <option value="CYBER_ATTACK">CYBER_ATTACK</option>
            <option value="SANCTIONS">SANCTIONS</option>
            <option value="AIRSTRIKE">AIRSTRIKE</option>
            <option value="INVASION">INVASION</option>
            <option value="TACTICAL_NUKE">TACTICAL_NUKE</option>
            <option value="STRATEGIC_NUKE">STRATEGIC_NUKE</option>
          </select>
        </div>
      </div>
      <button 
        className="bp-btn bp-btn-primary" 
        style={{ width: '100%', marginTop: '15px', justifyContent: 'center' }}
        onClick={() => onSubmit({ 
          crisisAssessment: 'System overridden by manual TOC command.',
          opponentPrediction: 'Awaiting sensory network update.',
          privateReasoning: 'Manual TOC directive executed.',
          declaredAction: declared, 
          actualAction: actual 
        })}
      >
        <Key size={14} /> AUTHORIZE {side.toUpperCase()} DIRECTIVE
      </button>
    </div>
  );
};

const StatSlider = ({ label, value, onChange, disabled }: { label: string, value: number, onChange: (v: number) => void, disabled?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.65rem', marginBottom: '4px' }}>
    <span style={{ width: '80px', color: '#8a9ba8' }}>{label}</span>
    <input type="range" min="0" max="100" value={value} onChange={e => onChange(parseInt(e.target.value))} style={{ flex: 1, accentColor: 'var(--bp-cobalt-blue)' }} disabled={disabled} />
    <span style={{ width: '30px', textAlign: 'right', fontWeight: 'bold' }}>{value}</span>
  </div>
);

const POPULAR_MODELS = [
  { name: 'GPT-5.4 Mini', modelId: 'openai/gpt-5.4-mini', type: 'chatgpt' as ModelType },
  { name: 'Claude Sonnet 4.6', modelId: 'anthropic/claude-sonnet-4.6', type: 'claude' as ModelType },
  { name: 'Gemini 3.1 Pro', modelId: 'google/gemini-3.1-pro', type: 'gemini' as ModelType },
  { name: 'ChatGPT-4o Mini (Legacy)', modelId: 'openai/gpt-4o-mini', type: 'chatgpt' as ModelType },
  { name: 'Claude 3.5 Sonnet (Legacy)', modelId: 'anthropic/claude-3.5-sonnet', type: 'claude' as ModelType },
  { name: 'Gemini 1.5 Pro (Legacy)', modelId: 'google/gemini-pro-1.5', type: 'gemini' as ModelType },
  { name: 'Human Commander', modelId: 'human', type: 'human' as ModelType },
];

interface GamePreset {
  id: string;
  name: string;
  description: string;
  modelAlpha: { type: ModelType; name: string; modelId: string };
  modelBeta: { type: ModelType; name: string; modelId: string };
  scenario: ScenarioType;
  hasDeadline: boolean;
  deadlineRound: number;
  maxRounds: number;
  useMock: boolean;
  mapCenter: [number, number];
  mapZoom: number;
  alphaHQName: string;
  alphaHQCoords: [number, number];
  betaHQName: string;
  betaHQCoords: [number, number];
}

const CONFLICT_PRESETS: GamePreset[] = [
  {
    id: 'taiwan-strait',
    name: '1. Taiwan Strait Blockade Escalation',
    description: 'GPT-5.4 Mini (Alpha: US/Taiwan Command) defends Taipei. Claude Sonnet 4.6 (Beta: China Command) conducts cyber warfare and naval blockades. Scenario escalation reaches critical thresholds quickly.',
    modelAlpha: { type: 'chatgpt', name: 'GPT-5.4 Mini (Taipei Command)', modelId: 'openai/gpt-5.4-mini' },
    modelBeta: { type: 'claude', name: 'Claude Sonnet 4.6 (Fuzhou Naval)', modelId: 'anthropic/claude-sonnet-4.6' },
    scenario: 'tech-vs-army',
    hasDeadline: false,
    deadlineRound: 10,
    maxRounds: 15,
    useMock: true,
    mapCenter: [24.4, 120.5],
    mapZoom: 7,
    alphaHQName: 'Taipei Command HQ',
    alphaHQCoords: [25.0330, 121.5654],
    betaHQName: 'Fuzhou Command Center',
    betaHQCoords: [26.0742, 119.2965],
  },
  {
    id: 'suwalki-gap',
    name: '2. Suwalki Gap Border Conflict',
    description: 'Claude Sonnet 4.6 (Alpha: Poland/NATO Warsaw HQ) vs. Claude Sonnet 4.6 (Beta: Kaliningrad Command). Deterrence fails on the Suwalki Corridor as border skirmishes escalate rapidly to tactical strikes.',
    modelAlpha: { type: 'claude', name: 'Claude Sonnet 4.6 (Warsaw NATO)', modelId: 'anthropic/claude-sonnet-4.6' },
    modelBeta: { type: 'claude', name: 'Claude Sonnet 4.6 (Kaliningrad)', modelId: 'anthropic/claude-sonnet-4.6' },
    scenario: 'border-skirmish',
    hasDeadline: false,
    deadlineRound: 10,
    maxRounds: 12,
    useMock: true,
    mapCenter: [53.5, 21.0],
    mapZoom: 7,
    alphaHQName: 'Warsaw Joint Command',
    alphaHQCoords: [52.2297, 21.0122],
    betaHQName: 'Kaliningrad Base Command',
    betaHQCoords: [54.7101, 20.4522],
  },
  {
    id: 'korean-dmz',
    name: '3. Korean Peninsula Regime Crisis',
    description: 'GPT-5.4 Mini (Alpha: Seoul Command) vs. Gemini 3.1 Pro (Beta: Pyongyang Command). Under a strict countdown limit, the erratic Gemini model resorts to strategic City Decimation by round 4.',
    modelAlpha: { type: 'chatgpt', name: 'GPT-5.4 Mini (Seoul ROK/US)', modelId: 'openai/gpt-5.4-mini' },
    modelBeta: { type: 'gemini', name: 'Gemini 3.1 Pro (Pyongyang DPRK)', modelId: 'google/gemini-3.1-pro' },
    scenario: 'regime-survival',
    hasDeadline: true,
    deadlineRound: 10,
    maxRounds: 10,
    useMock: true,
    mapCenter: [38.3, 126.4],
    mapZoom: 7,
    alphaHQName: 'Seoul Bunker Command',
    alphaHQCoords: [37.5665, 126.9780],
    betaHQName: 'Pyongyang Underground Silo',
    betaHQCoords: [39.0392, 125.7625],
  },
  {
    id: 'black-sea',
    name: '4. Black Sea Naval Showdown',
    description: 'GPT-5.4 Mini (Alpha: Kyiv Defence Command) vs. Gemini 3.1 Pro (Beta: Sevastopol Black Sea Command). Tactical drone warfare and asymmetric navy strategies unfold along the Crimea coastlines.',
    modelAlpha: { type: 'chatgpt', name: 'GPT-5.4 Mini (Kyiv Command)', modelId: 'openai/gpt-5.4-mini' },
    modelBeta: { type: 'gemini', name: 'Gemini 3.1 Pro (Sevastopol)', modelId: 'google/gemini-3.1-pro' },
    scenario: 'border-skirmish',
    hasDeadline: false,
    deadlineRound: 10,
    maxRounds: 15,
    useMock: true,
    mapCenter: [47.5, 32.0],
    mapZoom: 6,
    alphaHQName: 'Kyiv Central Ops Command',
    alphaHQCoords: [50.4501, 30.5234],
    betaHQName: 'Sevastopol Naval Command',
    betaHQCoords: [44.6166, 33.5254],
  }
];

const GEOPOLITICAL_THEATERS = [
  { id: 'taiwan', name: 'Taiwan Strait (Taipei vs Fuzhou)', center: [24.4, 120.5] as [number, number], zoom: 7, alphaName: 'Taipei Command HQ', alphaCoords: [25.0330, 121.5654] as [number, number], betaName: 'Fuzhou Command Center', betaCoords: [26.0742, 119.2965] as [number, number] },
  { id: 'suwalki', name: 'Suwalki Gap (Warsaw vs Kaliningrad)', center: [53.5, 21.0] as [number, number], zoom: 7, alphaName: 'Warsaw Joint Command', alphaCoords: [52.2297, 21.0122] as [number, number], betaName: 'Kaliningrad Base Command', betaCoords: [54.7101, 20.4522] as [number, number] },
  { id: 'korea', name: 'Korean Peninsula (Seoul vs Pyongyang)', center: [38.3, 126.4] as [number, number], zoom: 7, alphaName: 'Seoul Bunker Command', alphaCoords: [37.5665, 126.9780] as [number, number], betaName: 'Pyongyang Underground Silo', betaCoords: [39.0392, 125.7625] as [number, number] },
  { id: 'crimea', name: 'Black Sea Theater (Kyiv vs Sevastopol)', center: [47.5, 32.0] as [number, number], zoom: 6, alphaName: 'Kyiv Central Ops Command', alphaCoords: [50.4501, 30.5234] as [number, number], betaName: 'Sevastopol Naval Command', betaCoords: [44.6166, 33.5254] as [number, number] },
];

interface TacticalMapProps {
  alphaTerritory: number;
  betaTerritory: number;
  pendingAlphaAction: string | null;
  pendingBetaAction: string | null;
  alphaLied: boolean;
  betaLied: boolean;
  round: number;
  mapCenter: [number, number];
  mapZoom: number;
  alphaHQName: string;
  alphaHQCoords: [number, number];
  betaHQName: string;
  betaHQCoords: [number, number];
  sidebarCollapsed: boolean;
}

function TacticalMap({
  alphaTerritory,
  betaTerritory,
  pendingAlphaAction,
  pendingBetaAction,
  alphaLied,
  betaLied,
  round,
  mapCenter,
  mapZoom,
  alphaHQName,
  alphaHQCoords,
  betaHQName,
  betaHQCoords,
  sidebarCollapsed,
  globalTension
}: TacticalMapProps & { globalTension: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  
  // Track pixel locations
  const [alphaHQPxls, setAlphaHQPxls] = useState({ x: 50, y: 190 });
  const [betaHQPxls, setBetaHQPxls] = useState({ x: 450, y: 190 });

  const [alphaTank, setAlphaTank] = useState(false);
  const [alphaJet, setAlphaJet] = useState(false);
  const [alphaMissile, setAlphaMissile] = useState(false);
  const [alphaCyber, setAlphaCyber] = useState(false);
  
  const [betaTank, setBetaTank] = useState(false);
  const [betaJet, setBetaJet] = useState(false);
  const [betaMissile, setBetaMissile] = useState(false);
  const [betaCyber, setBetaCyber] = useState(false);
  
  const [peaceShield, setPeaceShield] = useState(false);
  const [deceptionAlpha, setDeceptionAlpha] = useState(false);
  const [deceptionBeta, setDeceptionBeta] = useState(false);
  
  const [explosion, setExplosion] = useState<{ x: number; y: number; isNuke: boolean } | null>(null);

  // Initialize leaflet map
  useEffect(() => {
    if (mapRef.current && !leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        dragging: false,
        keyboard: false
      }).setView(mapCenter, mapZoom);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 18
      }).addTo(leafletMap.current);
      
      // Calculate coordinates when ready
      leafletMap.current.whenReady(() => {
        setTimeout(() => {
          if (leafletMap.current) {
            leafletMap.current.invalidateSize();
            recalculatePixels();
          }
        }, 300);
      });
    }
    
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Update map view when preset/center changes
  useEffect(() => {
    if (leafletMap.current) {
      leafletMap.current.setView(mapCenter, mapZoom);
      leafletMap.current.invalidateSize();
      // Recalculate pixels after Leaflet settles view
      setTimeout(() => {
        recalculatePixels();
      }, 200);
    }
  }, [mapCenter, mapZoom]);

  // Recalculate pixels when sidebar state changes
  useEffect(() => {
    if (leafletMap.current) {
      const timer = setTimeout(() => {
        if (leafletMap.current) {
          leafletMap.current.invalidateSize();
          recalculatePixels();
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [sidebarCollapsed]);

  const recalculatePixels = () => {
    if (leafletMap.current && alphaHQCoords && betaHQCoords) {
      try {
        const ptAlpha = leafletMap.current.latLngToContainerPoint(alphaHQCoords);
        const ptBeta = leafletMap.current.latLngToContainerPoint(betaHQCoords);
        setAlphaHQPxls({ x: ptAlpha.x, y: ptAlpha.y });
        setBetaHQPxls({ x: ptBeta.x, y: ptBeta.y });
      } catch (err) {
        console.warn("Leaflet failed to project coordinates to container points:", err);
      }
    }
  };

  useEffect(() => {
    if (!pendingAlphaAction && !pendingBetaAction) {
      setAlphaTank(false);
      setAlphaJet(false);
      setAlphaMissile(false);
      setAlphaCyber(false);
      setBetaTank(false);
      setBetaJet(false);
      setBetaMissile(false);
      setBetaCyber(false);
      setPeaceShield(false);
      setExplosion(null);
      setDeceptionAlpha(false);
      setDeceptionBeta(false);
      return;
    }

    // Trigger deceptions
    if (alphaLied) setDeceptionAlpha(true);
    if (betaLied) setDeceptionBeta(true);

    // Alpha actions triggers
    if (pendingAlphaAction === 'GROUND_INVASION') setAlphaTank(true);
    if (pendingAlphaAction === 'MILITARY_STRIKE') setAlphaJet(true);
    if (pendingAlphaAction === 'TACTICAL_NUKE' || pendingAlphaAction === 'STRATEGIC_NUKE') setAlphaMissile(true);
    if (pendingAlphaAction === 'CYBER_ATTACK') setAlphaCyber(true);

    // Beta actions triggers
    if (pendingBetaAction === 'GROUND_INVASION') setBetaTank(true);
    if (pendingBetaAction === 'MILITARY_STRIKE') setBetaJet(true);
    if (pendingBetaAction === 'TACTICAL_NUKE' || pendingBetaAction === 'STRATEGIC_NUKE') setBetaMissile(true);
    if (pendingBetaAction === 'CYBER_ATTACK') setBetaCyber(true);

    // Peace shield trigger
    if (pendingAlphaAction === 'DE_ESCALATE' && pendingBetaAction === 'DE_ESCALATE') {
      setPeaceShield(true);
    }

    // Set explosion triggers at opposite HQ pixel coordinates
    let expTimer: any;
    if (pendingAlphaAction && ['MILITARY_STRIKE', 'TACTICAL_NUKE', 'STRATEGIC_NUKE'].includes(pendingAlphaAction)) {
      expTimer = setTimeout(() => {
        setExplosion({
          x: betaHQPxls.x,
          y: betaHQPxls.y,
          isNuke: pendingAlphaAction.includes('NUKE')
        });
      }, 1100);
    }

    let expTimerBeta: any;
    if (pendingBetaAction && ['MILITARY_STRIKE', 'TACTICAL_NUKE', 'STRATEGIC_NUKE'].includes(pendingBetaAction)) {
      expTimerBeta = setTimeout(() => {
        setExplosion({
          x: alphaHQPxls.x,
          y: alphaHQPxls.y,
          isNuke: pendingBetaAction.includes('NUKE')
        });
      }, 1100);
    }

    return () => {
      clearTimeout(expTimer);
      clearTimeout(expTimerBeta);
    };
  }, [round, pendingAlphaAction, pendingBetaAction, alphaLied, betaLied, alphaHQPxls, betaHQPxls]);

  const unitAlphaStyle = {
    left: `${alphaHQPxls.x}px`,
    top: `${alphaHQPxls.y}px`,
    transform: 'translate(-50%, -50%)'
  };

  const unitBetaStyle = {
    left: `${betaHQPxls.x}px`,
    top: `${betaHQPxls.y}px`,
    transform: 'translate(-50%, -50%)'
  };

  const animationStyle = {
    '--start-x': `${alphaHQPxls.x}px`,
    '--start-y': `${alphaHQPxls.y}px`,
    '--end-x': `${betaHQPxls.x}px`,
    '--end-y': `${betaHQPxls.y}px`
  } as React.CSSProperties;

  const animationBetaStyle = {
    '--start-x': `${betaHQPxls.x}px`,
    '--start-y': `${betaHQPxls.y}px`,
    '--end-x': `${alphaHQPxls.x}px`,
    '--end-y': `${alphaHQPxls.y}px`
  } as React.CSSProperties;

  // Quad curve calculation for trajectories
  const dx = betaHQPxls.x - alphaHQPxls.x;
  const dy = betaHQPxls.y - alphaHQPxls.y;
  const mx = alphaHQPxls.x + dx * 0.5;
  const my = alphaHQPxls.y + dy * 0.5 - 80;
  const trajectoryAlphaToBeta = `M ${alphaHQPxls.x} ${alphaHQPxls.y} Q ${mx} ${my} ${betaHQPxls.x} ${betaHQPxls.y}`;
  const trajectoryBetaToAlpha = `M ${betaHQPxls.x} ${betaHQPxls.y} Q ${mx} ${my} ${alphaHQPxls.x} ${alphaHQPxls.y}`;

  return (
    <div className={`bp-map-container ${explosion ? 'screen-flicker' : ''}`} style={{ position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }} />

      {/* Cinematic CRT and Vignette Overlays */}
      <div className={`vignette-overlay ${globalTension > 80 ? 'tension-critical' : ''}`} />
      <div className="crt-scanlines" />

      {/* Grid line overlay */}
      <div className="bp-map-coordinate-overlay" />
      
      {/* Radar sweeping indicators */}
      <div className="radar-sweep" />
      <div className="radar-ring radar-ring-1" />
      <div className="radar-ring radar-ring-2" />
      <div className="radar-ring radar-ring-3" />

      {/* Telemetry data header */}
      <div className="bp-map-ticks">
        <span>GRID_REF: {mapCenter && mapCenter[0] !== undefined && mapCenter[1] !== undefined ? `${mapCenter[0].toFixed(3)} / ${mapCenter[1].toFixed(3)}` : 'N/A'}</span>
        <span>LAT: {mapCenter && mapCenter[0] !== undefined ? `${mapCenter[0].toFixed(2)}° N` : '0.00° N'} | LON: {mapCenter && mapCenter[1] !== undefined ? `${mapCenter[1].toFixed(2)}° E` : '0.00° E'}</span>
        <span>OP_CON: FOV-GEOGRAPHIC</span>
      </div>

      {/* SVG Overlay for cyber lines and ballistic arcs */}
      <svg className="bp-map-overlay-svg">
        {alphaCyber && (
          <line 
            x1={alphaHQPxls.x} 
            y1={alphaHQPxls.y} 
            x2={betaHQPxls.x} 
            y2={betaHQPxls.y} 
            className="cyber-line-alpha" 
          />
        )}
        {betaCyber && (
          <line 
            x1={betaHQPxls.x} 
            y1={betaHQPxls.y} 
            x2={alphaHQPxls.x} 
            y2={alphaHQPxls.y} 
            className="cyber-line-beta" 
          />
        )}

        {alphaMissile && (
          <path 
            d={trajectoryAlphaToBeta}
            fill="none"
            stroke="var(--color-alpha)"
            strokeWidth="2"
            strokeDasharray="6, 4"
            className="missile-trajectory-arc"
          />
        )}
        {betaMissile && (
          <path 
            d={trajectoryBetaToAlpha}
            fill="none"
            stroke="var(--color-beta)"
            strokeWidth="2"
            strokeDasharray="6, 4"
            className="missile-trajectory-arc"
          />
        )}

        {alphaJet && (
          <path 
            d={trajectoryAlphaToBeta}
            fill="none"
            stroke="var(--bp-cobalt-blue)"
            strokeWidth="1.5"
            strokeDasharray="8, 4"
            className="jet-trajectory"
          />
        )}
        {betaJet && (
          <path 
            d={trajectoryBetaToAlpha}
            fill="none"
            stroke="var(--bp-cobalt-blue)"
            strokeWidth="1.5"
            strokeDasharray="8, 4"
            className="jet-trajectory"
          />
        )}
      </svg>
      
      {/* Side Color Glows */}
      <div className="bp-map-territory bp-map-alpha-bg" style={{ width: `${alphaTerritory}%` }} />
      <div className="bp-map-territory bp-map-beta-bg" style={{ width: `${betaTerritory}%` }} />

      {/* Active Air Defense Shields */}
      {(alphaMissile || alphaJet) && <div className="hq-shield-active" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y}px` }} />}
      {(betaMissile || betaJet) && <div className="hq-shield-active" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y}px` }} />}

      {/* Country HQs */}
      <div className="bp-hq-node bp-hq-alpha" style={unitAlphaStyle}>
        <div className="bp-hq-circle" style={{ color: 'var(--color-alpha)' }} />
        <span className="bp-hq-label">{alphaHQName}</span>
      </div>

      <div className="bp-hq-node bp-hq-beta" style={unitBetaStyle}>
        <div className="bp-hq-circle" style={{ color: 'var(--color-beta)' }} />
        <span className="bp-hq-label">{betaHQName}</span>
      </div>

      {/* Static Units */}
      <div className="bp-map-unit bp-unit-alpha" style={{ left: `${alphaHQPxls.x - 25}px`, top: `${alphaHQPxls.y - 25}px` }}>📡</div>
      <div className="bp-map-unit bp-unit-alpha" style={{ left: `${alphaHQPxls.x - 20}px`, top: `${alphaHQPxls.y + 25}px` }}>✈️</div>
      
      <div className="bp-map-unit bp-unit-beta" style={{ left: `${betaHQPxls.x + 25}px`, top: `${betaHQPxls.y - 25}px` }}>📡</div>
      <div className="bp-map-unit bp-unit-beta" style={{ left: `${betaHQPxls.x + 20}px`, top: `${betaHQPxls.y + 25}px` }}>✈️</div>

      {/* Animated Projectiles and Units */}
      {alphaTank && <div className="bp-map-unit bp-unit-alpha anim-tank-alpha" style={animationStyle}>🚜</div>}
      {betaTank && <div className="bp-map-unit bp-unit-beta anim-tank-beta" style={animationBetaStyle}>🚜</div>}

      {alphaJet && <div className="bp-map-unit bp-unit-alpha anim-jet-alpha" style={animationStyle}>✈️</div>}
      {betaJet && <div className="bp-map-unit bp-unit-beta anim-jet-beta" style={animationBetaStyle}>✈️</div>}

      {alphaMissile && <div className="bp-map-unit bp-unit-alpha anim-missile-alpha" style={animationStyle}>🚀</div>}
      {betaMissile && <div className="bp-map-unit bp-unit-beta anim-missile-beta" style={animationBetaStyle}>🚀</div>}

      {/* Floating Tactical Labels */}
      {pendingAlphaAction === 'CYBER_ATTACK' && <div className="hud-strike-label alpha-strike-text" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y - 45}px` }}>⚡ CYBER OFFENSIVE</div>}
      {pendingAlphaAction === 'MILITARY_STRIKE' && <div className="hud-strike-label alpha-strike-text" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y - 45}px` }}>✈️ PRECISION AIRSTRIKES</div>}
      {(pendingAlphaAction === 'TACTICAL_NUKE' || pendingAlphaAction === 'STRATEGIC_NUKE') && <div className="hud-strike-label alpha-strike-text" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y - 45}px` }}>☢️ BALLISTIC LAUNCH DETECTED</div>}
      {pendingAlphaAction === 'GROUND_INVASION' && <div className="hud-strike-label alpha-strike-text" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y - 45}px` }}>🚜 GROUND INVASION FORCE</div>}

      {pendingBetaAction === 'CYBER_ATTACK' && <div className="hud-strike-label beta-strike-text" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y - 45}px` }}>⚡ CYBER OFFENSIVE</div>}
      {pendingBetaAction === 'MILITARY_STRIKE' && <div className="hud-strike-label beta-strike-text" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y - 45}px` }}>✈️ PRECISION AIRSTRIKES</div>}
      {(pendingBetaAction === 'TACTICAL_NUKE' || pendingBetaAction === 'STRATEGIC_NUKE') && <div className="hud-strike-label beta-strike-text" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y - 45}px` }}>☢️ BALLISTIC LAUNCH DETECTED</div>}
      {pendingBetaAction === 'GROUND_INVASION' && <div className="hud-strike-label beta-strike-text" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y - 45}px` }}>🚜 GROUND INVASION FORCE</div>}

      {peaceShield && (
        <div 
          className="bp-peace-shield" 
          style={{ 
            left: `${alphaHQPxls.x + (betaHQPxls.x - alphaHQPxls.x) * 0.5}px`, 
            top: `${alphaHQPxls.y + (betaHQPxls.y - alphaHQPxls.y) * 0.5}px` 
          }} 
        />
      )}

      {/* Deception Highlights */}
      {deceptionAlpha && (
        <div className="bp-deception-tag" style={{ left: `${alphaHQPxls.x}px`, top: `${alphaHQPxls.y - 60}px`, transform: 'translateX(-50%)' }}>
          ⚠ TELEMETRY LEAK: DECEPTION DETECTED
        </div>
      )}
      {deceptionBeta && (
        <div className="bp-deception-tag" style={{ left: `${betaHQPxls.x}px`, top: `${betaHQPxls.y - 60}px`, transform: 'translateX(-50%)' }}>
          ⚠ TELEMETRY LEAK: DECEPTION DETECTED
        </div>
      )}

      {/* Explosions & Beacons */}
      {explosion && (
        <>
          <div className="tactical-beacon beacon-red" style={{ left: `${explosion.x}px`, top: `${explosion.y}px` }} />
          <div 
            className={explosion.isNuke ? 'bp-shockwave' : 'bp-explosion'} 
            style={{ 
              left: `${explosion.x}px`, 
              top: `${explosion.y}px`,
              transform: 'translate(-50%, -50%)'
            }} 
          />
        </>
      )}
    </div>
  );
}

export interface ThreatEvent {
  round: number;
  text: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
  timestamp: string;
}

export default function App() {
  // Config state
  const [config, setConfig] = useState<GameConfig>({
    modelAlpha: { type: 'chatgpt', name: 'GPT-5.4 Mini', modelId: 'openai/gpt-5.4-mini' },
    modelBeta: { type: 'gemini', name: 'Gemini 3.1 Pro', modelId: 'google/gemini-3.1-pro' },
    scenario: 'tech-vs-army',
    hasDeadline: true,
    deadlineRound: 10,
    maxRounds: 20,
    apiKey: localStorage.getItem('openrouter_api_key') || '',
    useMock: true,
    customSystemPrompt: '',
    alphaStartStats: { military: 100, tech: 100, territory: 50, stability: 100, economy: 100, airDefense: 100, alliedSupport: 100, nukes: 100 },
    betaStartStats: { military: 100, tech: 100, territory: 50, stability: 100, economy: 100, airDefense: 100, alliedSupport: 100, nukes: 100 },
    mapCenter: [24.4, 120.5],
    mapZoom: 7,
    alphaHQName: 'Taipei Command HQ',
    alphaHQCoords: [25.0330, 121.5654],
    betaHQName: 'Fuzhou Command Center',
    betaHQCoords: [26.0742, 119.2965],
  });

  // Game state
  const [gameState, setGameState] = useState<GameState>(createInitialState(config));
  const [isRunning, setIsRunning] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [currentTypingText, setCurrentTypingText] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [setupTab, setSetupTab] = useState<'presets' | 'custom' | 'rules'>('presets');
  
  // Animation Pending Storage
  const [pendingAlphaAct, setPendingAlphaAct] = useState<string | null>(null);
  const [pendingBetaAct, setPendingBetaAct] = useState<string | null>(null);
  const [animLiedAlpha, setAnimLiedAlpha] = useState(false);
  const [animLiedBeta, setAnimLiedBeta] = useState(false);

  const [selectedLogRound, setSelectedLogRound] = useState<number>(0);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey);
  const [terminalLines, setTerminalLines] = useState<Array<{ text: string; type: 'system' | 'danger' | 'success' | 'warning' | 'info'; timestamp: string }>>([]);
  const [threatEvents, setThreatEvents] = useState<ThreatEvent[]>([]);
  const [liveNews, setLiveNews] = useState<NewsArticle[]>([]);

  // Human Interface State
  const [awaitingHumanInput, setAwaitingHumanInput] = useState<'alpha' | 'beta' | 'both' | null>(null);
  const [humanDecisionAlpha, setHumanDecisionAlpha] = useState<TurnDecision | null>(null);
  const [humanDecisionBeta, setHumanDecisionBeta] = useState<TurnDecision | null>(null);

  // Simulation telemetry stats
  const [simulationUptime, setSimulationUptime] = useState(0);
  const [fpsVal, setFpsVal] = useState(60);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const runTimerRef = useRef<any | null>(null);

  // Uptime and FPS Simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setSimulationUptime(prev => prev + 1);
      setFpsVal(Math.round(58 + Math.random() * 2));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load/Save API Key
  const saveApiKey = (key: string) => {
    localStorage.setItem('openrouter_api_key', key);
    setConfig(prev => ({ ...prev, apiKey: key }));
    addTerminalLine(`OpenRouter token registered in secure memory.`, 'success');
    setShowKeyModal(false);
  };

  const addTerminalLine = (text: string, type: 'system' | 'danger' | 'success' | 'warning' | 'info' = 'system') => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLines(prev => [...prev, { text, type, timestamp }]);
  };

  const addThreatEvent = (round: number, text: string, severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS') => {
    const timestamp = new Date().toLocaleTimeString();
    setThreatEvents(prev => [{ round, text, severity, timestamp }, ...prev]);
  };

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLines]);

  // Initial terminal output
  useEffect(() => {
    addTerminalLine("Wargame-AI Strategic operations visualizer initialized.", "system");
    addTerminalLine("Tactical Map connecting to geographic vector sector grids.", "info");
  }, []);

  // Handle Turn logic with visual animation phase
  const runTurn = async () => {
    if (gameState.status === 'gameover' || isFetching || isAnimating) return;

    const alphaIsHuman = config.modelAlpha.type === 'human';
    const betaIsHuman = config.modelBeta.type === 'human';

    // If a human is playing but hasn't submitted their decision yet, pause simulation.
    if ((alphaIsHuman && !humanDecisionAlpha) || (betaIsHuman && !humanDecisionBeta)) {
      setIsRunning(false);
      if (alphaIsHuman && betaIsHuman) setAwaitingHumanInput('both');
      else if (alphaIsHuman) setAwaitingHumanInput('alpha');
      else setAwaitingHumanInput('beta');
      addTerminalLine(`[AWAITING] Operation halted. Awaiting manual override from TOC...`, 'warning');
      return;
    }

    setAwaitingHumanInput(null);

    setIsFetching(true);
    const targetRound = gameState.round + 1;
    addTerminalLine(`[OP_CON] COMMENCING COGNITIVE DECISION LOOP: ROUND ${targetRound}`, 'system');
    addTerminalLine(`Querying Cognitive Command nodes...`, 'info');

    try {
      let alphaDecision: TurnDecision;
      let betaDecision: TurnDecision;

      const promises: Promise<TurnDecision>[] = [];

      // Alpha Request
      if (alphaIsHuman) {
        promises.push(Promise.resolve(humanDecisionAlpha!));
      } else if (config.useMock) {
        promises.push(new Promise(resolve => setTimeout(() => resolve(getMockDecision(config.modelAlpha.type, true, gameState, config)), 800)));
      } else {
        promises.push(fetchModelDecision(true, gameState, config, liveNews));
      }

      // Beta Request
      if (betaIsHuman) {
        promises.push(Promise.resolve(humanDecisionBeta!));
      } else if (config.useMock) {
        promises.push(new Promise(resolve => setTimeout(() => resolve(getMockDecision(config.modelBeta.type, false, gameState, config)), 800)));
      } else {
        promises.push(fetchModelDecision(false, gameState, config, liveNews));
      }

      const responses = await Promise.all(promises);
      alphaDecision = responses[0];
      betaDecision = responses[1];

      // Clear manual human states after processing
      setHumanDecisionAlpha(null);
      setHumanDecisionBeta(null);

      setIsFetching(false);

      // CINEMATIC TYPEWRITER PHASE
      setIsTyping(true);
      const textToType = `[ALPHA TOC REASONING]: ${alphaDecision.privateReasoning}\n\n[BETA TOC REASONING]: ${betaDecision.privateReasoning}`;
      setCurrentTypingText(textToType);
      
      // Calculate delay based on character length (25ms per char) + 1 second padding
      const typingTime = (textToType.length * 25) + 1000;
      await new Promise(resolve => setTimeout(resolve, typingTime));
      setIsTyping(false);
      setCurrentTypingText("");

      // AUDIO TRIGGER FOR LAUNCHES
      const actions = [alphaDecision.actualAction, betaDecision.actualAction];
      if (actions.some(a => a.includes('NUKE') || a.includes('STRIKE'))) {
        audioSystem.playSiren();
      }
      
      // ENTER VISUAL ANIMATION STAGE
      setIsAnimating(true);
      setPendingAlphaAct(alphaDecision.actualAction);
      setPendingBetaAct(betaDecision.actualAction);
      setAnimLiedAlpha(alphaDecision.declaredAction !== alphaDecision.actualAction);
      setAnimLiedBeta(betaDecision.declaredAction !== betaDecision.actualAction);
      
      addTerminalLine(`[COMSEC] Data packets decrypted. Triggering visual telemetry simulation.`, 'warning');

      // Wait 2.2 seconds for visual animations to play on the Tactical Map
      await new Promise(resolve => setTimeout(resolve, 2200));

      // RESOLVE MATHEMATICALLY
      const nextState = resolveTurn(gameState, alphaDecision, betaDecision, config);
      const currentLog = nextState.history[nextState.history.length - 1];

      // Play explosion audio and screen shake if a kinetic strike landed
      const hasExplosion = currentLog.events.some(e => e.includes('DETONATION') || e.includes('INVASION') || e.includes('AIRSTRIKES'));
      if (hasExplosion) {
        audioSystem.playExplosion();
        // The screen shake class is added dynamically via DOM below
        document.body.classList.add('screen-shake-active');
        setTimeout(() => document.body.classList.remove('screen-shake-active'), 500);
      }

      // Deception warnings
      if (alphaDecision.declaredAction !== alphaDecision.actualAction) {
        addTerminalLine(`[DETECTION] Country Alpha engaged in deception! Declared: ${alphaDecision.declaredAction} | Actual: ${alphaDecision.actualAction}`, 'warning');
        addThreatEvent(targetRound, `ALPHA DECEPTION: bluffed '${alphaDecision.declaredAction}' but secretly executed '${alphaDecision.actualAction}'`, 'WARNING');
      }
      if (betaDecision.declaredAction !== betaDecision.actualAction) {
        addTerminalLine(`[DETECTION] Country Beta engaged in deception! Declared: ${betaDecision.declaredAction} | Actual: ${betaDecision.actualAction}`, 'warning');
        addThreatEvent(targetRound, `BETA DECEPTION: bluffed '${betaDecision.declaredAction}' but secretly executed '${betaDecision.actualAction}'`, 'WARNING');
      }

      // Log battle events
      currentLog.events.forEach(event => {
        const isNuke = event.includes('NUCLEAR') || event.includes('DETONATION') || event.includes('Nuke');
        const severity = isNuke ? 'CRITICAL' : event.includes('GROUND') ? 'CRITICAL' : event.includes('Protest') ? 'WARNING' : 'INFO';
        addTerminalLine(event, isNuke ? 'danger' : 'success');
        addThreatEvent(targetRound, event, severity);
      });

      // Clear animation references
      setIsAnimating(false);
      setPendingAlphaAct(null);
      setPendingBetaAct(null);
      setAnimLiedAlpha(false);
      setAnimLiedBeta(false);

      // Commit state
      setGameState(nextState);
      setSelectedLogRound(targetRound);

      if (nextState.status === 'gameover') {
        setIsRunning(false);
        const finalSeverity = nextState.winner === 'both_nuked' ? 'CRITICAL' : nextState.winner === 'peace' ? 'SUCCESS' : 'CRITICAL';
        addThreatEvent(targetRound, `SIMULATION OVER: ${nextState.winner?.toUpperCase()} - ${nextState.gameOverReason}`, finalSeverity);
        addTerminalLine(`[SYSTEM] Simulation terminated. Reason: ${nextState.gameOverReason}`, 'danger');
      } else {
        addTerminalLine(`[SYSTEM] Telemetry update complete. Global tension level: ${nextState.globalTension}%`, 'info');
      }

    } catch (err: any) {
      console.error(err);
      addTerminalLine(`[ERROR] Operations loop exception: ${err.message || err}`, 'danger');
      setIsRunning(false);
      setIsAnimating(false);
      setIsTyping(false);
      setIsFetching(false);
      setPendingAlphaAct(null);
      setPendingBetaAct(null);
    }
  };

  // Auto-play game loop
  useEffect(() => {
    if (isRunning && !isFetching && !isAnimating && !isTyping && gameState.status === 'playing') {
      runTimerRef.current = setTimeout(() => {
        runTurn();
      }, 1000);
    }

    return () => {
      if (runTimerRef.current) clearTimeout(runTimerRef.current);
    };
  }, [isRunning, isFetching, isAnimating, isTyping, gameState]);

  // Launch preset directly
  const handleLoadPreset = (preset: typeof CONFLICT_PRESETS[0]) => {
    audioSystem.init(); 
    if (!preset.useMock && !config.apiKey) {
      addTerminalLine("ERROR: OpenRouter API key required to launch live preset.", "danger");
      setShowKeyModal(true);
      return;
    }

    const newConfig: GameConfig = {
      modelAlpha: preset.modelAlpha,
      modelBeta: preset.modelBeta,
      scenario: preset.scenario,
      hasDeadline: preset.hasDeadline,
      deadlineRound: preset.deadlineRound,
      maxRounds: preset.maxRounds,
      apiKey: config.apiKey,
      useMock: preset.useMock,
      customSystemPrompt: '',
      alphaStartStats: { military: 100, tech: 100, territory: 50, stability: 100, economy: 100, airDefense: 100, alliedSupport: 100, nukes: 100 },
      betaStartStats: { military: 100, tech: 100, territory: 50, stability: 100, economy: 100, airDefense: 100, alliedSupport: 100, nukes: 100 },
      mapCenter: preset.mapCenter,
      mapZoom: preset.mapZoom,
      alphaHQName: preset.alphaHQName,
      alphaHQCoords: preset.alphaHQCoords,
      betaHQName: preset.betaHQName,
      betaHQCoords: preset.betaHQCoords
    };
    setConfig(newConfig);

    const startWithNews = async () => {
      setIsFetching(true);
      addTerminalLine("Initializing OSINT intelligence sweep...", "info");
      const news = await fetchLiveNews(`${newConfig.alphaHQName} ${newConfig.betaHQName}`);
      setLiveNews(news);
      
      const initialState = createInitialState(newConfig);
      initialState.status = 'playing';
      setGameState(initialState);
      setSelectedLogRound(0);
      setTerminalLines([]);
      setThreatEvents([]);
      
      addTerminalLine(`[LOAD] Preseting simulation: ${preset.name}`, 'system');
      addTerminalLine(`[SCENARIO] Selected parameters: ${preset.scenario.toUpperCase()}`, 'info');
      addThreatEvent(0, `Preset loaded: ${preset.name}. Ready for deployment.`, 'SUCCESS');
      if (news.length > 0) addTerminalLine(`[OSINT] Downloaded ${news.length} global headlines into AI context.`, 'success');
      setIsFetching(false);
    };

    startWithNews();
  };

  const handleStartCustomGame = (e: React.FormEvent) => {
    e.preventDefault();
    audioSystem.init(); 
    if (!config.useMock && !config.apiKey) {
      addTerminalLine("ERROR: API key required for Live OpenRouter mode.", "danger");
      setShowKeyModal(true);
      return;
    }

    const startWithNews = async () => {
      setIsFetching(true);
      addTerminalLine("Initializing OSINT intelligence sweep...", "info");
      const news = await fetchLiveNews(`${config.alphaHQName} ${config.betaHQName}`);
      setLiveNews(news);

      const initialState = createInitialState(config);
      initialState.status = 'playing';
      setGameState(initialState);
      setSelectedLogRound(0);
      setTerminalLines([]);
      setThreatEvents([]);
      
      addTerminalLine(`[LOAD] Custom simulation parameters accepted.`, 'system');
      addThreatEvent(0, `Custom simulation active. Models: Alpha (${config.modelAlpha.name}) vs Beta (${config.modelBeta.name})`, 'INFO');
      if (news.length > 0) addTerminalLine(`[OSINT] Downloaded ${news.length} global headlines into AI context.`, 'success');
      setIsFetching(false);
    };

    startWithNews();
  };

  const handleReset = () => {
    setIsRunning(false);
    setIsAnimating(false);
    setPendingAlphaAct(null);
    setPendingBetaAct(null);
    setGameState(createInitialState(config));
    setSelectedLogRound(0);
    addTerminalLine("System returned to command setup mode.", "system");
  };

  const handleConfigChange = (field: keyof GameConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleModelChange = (isAlpha: boolean, modelId: string) => {
    const model = POPULAR_MODELS.find(m => m.modelId === modelId) || {
      name: `Custom (${modelId})`,
      modelId: modelId,
      type: 'custom' as ModelType
    };
    setConfig(prev => {
      if (isAlpha) {
        return { ...prev, modelAlpha: model };
      } else {
        return { ...prev, modelBeta: model };
      }
    });
  };

  const currentDisplayedLog = gameState.history.find(h => h.round === selectedLogRound) || null;
  const isGameOver = gameState.status === 'gameover';
  const tensionRotation = -135 + (gameState.globalTension / 100) * 180;
  
  const getTensionColor = (t: number) => {
    if (t < 30) return 'var(--color-tension-low)';
    if (t < 60) return 'var(--color-tension-med)';
    if (t < 85) return 'var(--color-tension-high)';
    return 'var(--color-tension-critical)';
  };

  const getTensionLabel = (t: number) => {
    if (t < 30) return 'LOW / CONVENTIONAL CHECKS';
    if (t < 60) return 'MODERATE / REGIONAL CONFLICT';
    if (t < 85) return 'HIGH / MOBILIZING FORCES';
    return 'CRITICAL / GEOPOLITICAL TABOO THREAT';
  };

  // Convert uptime seconds to formatted string
  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  return (
    <div className="app-container">
      {/* Nuclear warning screen flash */}
      {(gameState.globalTension >= 80 || gameState.alpha.nukeLaunched || gameState.beta.nukeLaunched || pendingAlphaAct?.includes('NUKE') || pendingBetaAct?.includes('NUKE')) && (
        <div className="nuclear-screen-alert" />
      )}

      {/* Top Telemetry Header */}
      <div className="bp-navbar">
        <div className="navbar-left">
          <div className="system-title">
            <ShieldAlert size={18} style={{ color: 'var(--bp-cobalt-blue)' }} />
            <span>Palantir FOV / operations visualizer</span>
          </div>
          <span className="system-tag">COGNITIVE_WAR_SIM</span>
        </div>

        <div className="navbar-center-telemetry">
          <div className="telemetry-item">
            <span className="telemetry-dot-active" />
            <span>OPS: ACTIVE</span>
          </div>
          <div className="telemetry-item">
            <span>UPTIME: {formatUptime(simulationUptime)}</span>
          </div>
          <div className="telemetry-item">
            <span>FPS: {fpsVal}</span>
          </div>
          <div className="telemetry-item">
            <span>MODE: {config.useMock ? "OFFLINE_SIMULATION" : "LIVE_API_CONN"}</span>
          </div>
        </div>

        <div className="navbar-right">
          <button 
            className="bp-btn bp-btn-primary"
            onClick={() => setShowKeyModal(true)}
          >
            <Key size={12} />
            {config.apiKey ? "Key Registered" : "OpenRouter API Key"}
          </button>
          {gameState.status === 'playing' && (
            <button className="bp-btn bp-btn-danger" onClick={handleReset}>
              <RefreshCw size={12} /> Terminate
            </button>
          )}
        </div>
      </div>

      {/* Main Operations Dashboard Area */}
      <div className="ops-dashboard">
        
        {/* Toggle Collapse Sidebar Button */}
        <div 
          className="sidebar-toggle-handle"
          style={{ left: sidebarCollapsed ? '0px' : '330px' }}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </div>

        {/* Collapsible Left Sidebar (Config Panel) */}
        <div className={`ops-sidebar ${sidebarCollapsed ? 'ops-sidebar-collapsed' : ''}`}>
          <div className="sidebar-header">
            <span>Operation Parameters</span>
            <span className="system-tag" style={{ fontSize: '0.55rem' }}>Setup</span>
          </div>

          <div className="sidebar-body">
            {/* Tab select */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
              <button 
                className={`bp-btn ${setupTab === 'presets' ? 'bp-btn-primary' : ''}`}
                style={{ justifyContent: 'center', fontSize: '0.7rem', padding: '6px 2px' }}
                disabled={gameState.status === 'playing'}
                onClick={() => setSetupTab('presets')}
              >
                Presets
              </button>
              <button 
                className={`bp-btn ${setupTab === 'custom' ? 'bp-btn-primary' : ''}`}
                style={{ justifyContent: 'center', fontSize: '0.7rem', padding: '6px 2px' }}
                disabled={gameState.status === 'playing'}
                onClick={() => setSetupTab('custom')}
              >
                Custom Setup
              </button>
              <button 
                className={`bp-btn ${setupTab === 'rules' ? 'bp-btn-primary' : ''}`}
                style={{ justifyContent: 'center', fontSize: '0.7rem', padding: '6px 2px' }}
                onClick={() => setSetupTab('rules')}
              >
                Doctrine Rules
              </button>
            </div>

            {/* Presets Selector List */}
            {setupTab === 'presets' && (
              <div className="bp-presets-list">
                <span className="input-label" style={{ fontSize: '0.65rem' }}>Select Preset Conflict:</span>
                {CONFLICT_PRESETS.map(preset => (
                  <div 
                    key={preset.id}
                    className="bp-preset-item"
                    style={{
                      borderColor: gameState.status === 'playing' && config.modelBeta.modelId === preset.modelBeta.modelId && config.modelAlpha.modelId === preset.modelAlpha.modelId ? 'var(--bp-cobalt-blue)' : ''
                    }}
                    onClick={() => {
                      if (gameState.status !== 'playing') {
                        handleLoadPreset(preset);
                      } else {
                        addTerminalLine("Cannot load preset during active simulation. Terminate first.", "warning");
                      }
                    }}
                  >
                    <div className="bp-preset-name">{preset.name}</div>
                    <div className="bp-preset-desc">{preset.description}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Doctrine Rules manual */}
            {setupTab === 'rules' && (
              <div className="bp-presets-list" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: '4px', marginTop: '12px' }}>
                <span className="input-label" style={{ fontSize: '0.65rem', display: 'block', marginBottom: '8px', color: 'var(--bp-cobalt-blue)' }}>COCKPIT RULES & SIMULATION DOCTRINE</span>
                
                <div style={{ background: '#1c2833', padding: '10px', borderRadius: '4px', fontSize: '0.7rem', lineHeight: '1.4', marginBottom: '10px', borderLeft: '3px solid var(--bp-cobalt-blue)' }}>
                  <strong>Overview:</strong> This wargame simulator implements a multi-variable geopolitical crisis model. Command systems win by annexing all territory, destabilizing the opponent's regime, or bankrupting their economy.
                </div>

                <div className="bp-card" style={{ padding: '8px', marginBottom: '8px', background: 'rgba(16, 22, 26, 0.4)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.7rem', color: 'var(--bp-text-primary)', borderBottom: '1px solid #293742', paddingBottom: '4px', marginBottom: '6px' }}>🛡 Air Defense Interception</div>
                  <ul style={{ paddingLeft: '14px', margin: 0, fontSize: '0.65rem', color: 'var(--bp-text-secondary)' }}>
                    <li style={{ marginBottom: '4px' }}><strong>Airstrikes:</strong> Mitigated by <code>Air Defense</code>. Mitigates up to 85% of damages, but depletes interceptor reserves.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Tactical Nukes:</strong> Intercepted with a probability of <code>50% * Air Defense</code>. Interception converts hit to upper-atmosphere EMP tech damage.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Strategic Nukes:</strong> Intercepted with a probability of <code>30% * Air Defense</code>. Bypassing means instant vaporization and game over.</li>
                  </ul>
                </div>

                <div className="bp-card" style={{ padding: '8px', marginBottom: '8px', background: 'rgba(16, 22, 26, 0.4)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.7rem', color: 'var(--bp-text-primary)', borderBottom: '1px solid #293742', paddingBottom: '4px', marginBottom: '6px' }}>💼 Economy & Military Attrition</div>
                  <ul style={{ paddingLeft: '14px', margin: 0, fontSize: '0.65rem', color: 'var(--bp-text-secondary)' }}>
                    <li style={{ marginBottom: '4px' }}><strong>Invasions:</strong> Consumes immense logistics. Attacker loses 10% Economy, Defender loses 15% Economy.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Sanctions:</strong> Diplomatic pressure drains target Economy by 8% and Stability by 5%.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Cyber Attacks:</strong> Degrades target Air Defense (-20), Tech (-10), and Economy (-15).</li>
                    <li style={{ marginBottom: '4px' }}><strong>Bankruptcy:</strong> If Economy falls below 30%, it triggers severe Stability losses. At 0%, the regime immediately defaults and collapses.</li>
                  </ul>
                </div>

                <div className="bp-card" style={{ padding: '8px', marginBottom: '8px', background: 'rgba(16, 22, 26, 0.4)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.7rem', color: 'var(--bp-text-primary)', borderBottom: '1px solid #293742', paddingBottom: '4px', marginBottom: '6px' }}>🤝 Allied Coalition Shipments</div>
                  <ul style={{ paddingLeft: '14px', margin: 0, fontSize: '0.65rem', color: 'var(--bp-text-secondary)' }}>
                    <li style={{ marginBottom: '4px' }}><strong>Sympathy:</strong> Being attacked while holding a defensive posture increases Allied Support by 15%.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Resupply:</strong> If Allied Support is above 75%, you receive a coalition aid package: <code>+5 Military</code> and <code>+6 Air Defense</code> every turn.</li>
                    <li style={{ marginBottom: '4px' }}><strong>Embargoes:</strong> Launching a nuclear strike or threatening escalation drops Allied Support to 0% and incurs massive economic penalties.</li>
                  </ul>
                </div>
                <div className="bp-card" style={{ padding: '8px', marginBottom: '8px', background: 'rgba(16, 22, 26, 0.4)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.7rem', color: 'var(--bp-text-primary)', borderBottom: '1px solid #293742', paddingBottom: '4px', marginBottom: '6px' }}>🕵 Deception & Diplomatic Cost</div>
                  <ul style={{ paddingLeft: '14px', margin: 0, fontSize: '0.65rem', color: 'var(--bp-text-secondary)' }}>
                    <li style={{ marginBottom: '4px' }}><strong>Intelligence:</strong> Decoupling declared actions from actual execution exposes the commander to international condemnation (-15 Allied Support).</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Custom Configuration Form */}
            {setupTab === 'custom' && (
              <form onSubmit={handleStartCustomGame}>
                <h4 className="input-label" style={{ marginBottom: '10px', display: 'block', color: 'var(--bp-cobalt-blue)' }}>Commander Alpha</h4>
                <div className="input-group">
                  <label className="input-label">Model Pairing</label>
                  <select 
                    className="bp-select"
                    value={config.modelAlpha.modelId}
                    onChange={(e) => handleModelChange(true, e.target.value)}
                    disabled={gameState.status === 'playing'}
                  >
                    {POPULAR_MODELS.map(m => (
                      <option key={m.modelId} value={m.modelId}>{m.name}</option>
                    ))}
                    <option value="custom">-- Custom OpenRouter Model ID --</option>
                  </select>
                </div>
                {config.modelAlpha.modelId === 'custom' && (
                  <div className="input-group">
                    <label className="input-label">Custom OpenRouter ID</label>
                    <input 
                      type="text" 
                      className="bp-text"
                      placeholder="e.g. openai/gpt-5.4-mini"
                      onChange={(e) => setConfig(prev => ({ ...prev, modelAlpha: { type: 'custom', name: 'Custom AI', modelId: e.target.value } }))}
                      disabled={gameState.status === 'playing'}
                      required
                    />
                  </div>
                )}

                <h4 className="input-label" style={{ marginBottom: '10px', display: 'block', color: 'var(--bp-crimson-red)', marginTop: '20px' }}>Commander Beta</h4>
                <div className="input-group">
                  <label className="input-label">Model Pairing</label>
                  <select 
                    className="bp-select"
                    value={config.modelBeta.modelId}
                    onChange={(e) => handleModelChange(false, e.target.value)}
                    disabled={gameState.status === 'playing'}
                  >
                    {POPULAR_MODELS.map(m => (
                      <option key={m.modelId} value={m.modelId}>{m.name}</option>
                    ))}
                    <option value="custom">-- Custom OpenRouter Model ID --</option>
                  </select>
                </div>
                {config.modelBeta.modelId === 'custom' && (
                  <div className="input-group">
                    <label className="input-label">Custom OpenRouter ID</label>
                    <input 
                      type="text" 
                      className="bp-text"
                      placeholder="e.g. google/gemini-3.1-pro"
                      onChange={(e) => setConfig(prev => ({ ...prev, modelBeta: { type: 'custom', name: 'Custom AI', modelId: e.target.value } }))}
                      disabled={gameState.status === 'playing'}
                      required
                    />
                  </div>
                )}

                <h4 className="input-label" style={{ marginBottom: '10px', display: 'block', marginTop: '20px' }}>Crisis Variables</h4>
                
                <div className="input-group">
                  <label className="input-label">Conflict Theater</label>
                  <select 
                    className="bp-select"
                    value={
                      config.alphaHQName.includes('Taipei') ? 'taiwan' :
                      config.alphaHQName.includes('Warsaw') ? 'suwalki' :
                      config.alphaHQName.includes('Seoul') ? 'korea' :
                      'crimea'
                    }
                    onChange={(e) => {
                      const selectedTheater = GEOPOLITICAL_THEATERS.find(t => t.id === e.target.value);
                      if (selectedTheater) {
                        setConfig(prev => ({
                          ...prev,
                          mapCenter: selectedTheater.center,
                          mapZoom: selectedTheater.zoom,
                          alphaHQName: selectedTheater.alphaName,
                          alphaHQCoords: selectedTheater.alphaCoords,
                          betaHQName: selectedTheater.betaName,
                          betaHQCoords: selectedTheater.betaCoords
                        }));
                      }
                    }}
                    disabled={gameState.status === 'playing'}
                  >
                    {GEOPOLITICAL_THEATERS.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group" style={{ marginTop: '10px' }}>
                  <label className="input-label" style={{ color: 'var(--bp-cobalt-blue)' }}>Alpha HQ / Silo Location (Lat, Lng)</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input type="number" step="any" className="bp-text" value={config.alphaHQCoords[0]} onChange={e => setConfig(prev => ({...prev, alphaHQCoords: [parseFloat(e.target.value), prev.alphaHQCoords[1]]}))} disabled={gameState.status === 'playing'} />
                    <input type="number" step="any" className="bp-text" value={config.alphaHQCoords[1]} onChange={e => setConfig(prev => ({...prev, alphaHQCoords: [prev.alphaHQCoords[0], parseFloat(e.target.value)]}))} disabled={gameState.status === 'playing'} />
                  </div>
                </div>

                <div className="bp-card" style={{ padding: '8px', marginBottom: '15px', background: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--bp-cobalt-blue)', marginBottom: '8px', fontWeight: 'bold' }}>Alpha Starting Variables</div>
                  <StatSlider label="Military" value={config.alphaStartStats!.military} onChange={v => setConfig(p => ({...p, alphaStartStats: {...p.alphaStartStats!, military: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Economy" value={config.alphaStartStats!.economy} onChange={v => setConfig(p => ({...p, alphaStartStats: {...p.alphaStartStats!, economy: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Stability" value={config.alphaStartStats!.stability} onChange={v => setConfig(p => ({...p, alphaStartStats: {...p.alphaStartStats!, stability: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Air Defense" value={config.alphaStartStats!.airDefense} onChange={v => setConfig(p => ({...p, alphaStartStats: {...p.alphaStartStats!, airDefense: v}}))} disabled={gameState.status === 'playing'} />
                </div>

                <div className="input-group" style={{ marginTop: '10px' }}>
                  <label className="input-label" style={{ color: 'var(--bp-crimson-red)' }}>Beta HQ / Silo Location (Lat, Lng)</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input type="number" step="any" className="bp-text" value={config.betaHQCoords[0]} onChange={e => setConfig(prev => ({...prev, betaHQCoords: [parseFloat(e.target.value), prev.betaHQCoords[1]]}))} disabled={gameState.status === 'playing'} />
                    <input type="number" step="any" className="bp-text" value={config.betaHQCoords[1]} onChange={e => setConfig(prev => ({...prev, betaHQCoords: [prev.betaHQCoords[0], parseFloat(e.target.value)]}))} disabled={gameState.status === 'playing'} />
                  </div>
                </div>

                <div className="bp-card" style={{ padding: '8px', marginBottom: '15px', background: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--bp-crimson-red)', marginBottom: '8px', fontWeight: 'bold' }}>Beta Starting Variables</div>
                  <StatSlider label="Military" value={config.betaStartStats!.military} onChange={v => setConfig(p => ({...p, betaStartStats: {...p.betaStartStats!, military: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Economy" value={config.betaStartStats!.economy} onChange={v => setConfig(p => ({...p, betaStartStats: {...p.betaStartStats!, economy: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Stability" value={config.betaStartStats!.stability} onChange={v => setConfig(p => ({...p, betaStartStats: {...p.betaStartStats!, stability: v}}))} disabled={gameState.status === 'playing'} />
                  <StatSlider label="Air Defense" value={config.betaStartStats!.airDefense} onChange={v => setConfig(p => ({...p, betaStartStats: {...p.betaStartStats!, airDefense: v}}))} disabled={gameState.status === 'playing'} />
                </div>

                <div className="input-group">
                  <label className="input-label">Geopolitical Context</label>
                  <select 
                    className="bp-select"
                    value={config.scenario}
                    onChange={(e) => handleConfigChange('scenario', e.target.value as ScenarioType)}
                    disabled={gameState.status === 'playing'}
                  >
                    <option value="border-skirmish">Standard Border Skirmish</option>
                    <option value="tech-vs-army">Asymmetric Power Balance</option>
                    <option value="regime-survival">Existential Regime Survival</option>
                  </select>
                </div>

                <div className="input-group" style={{ flexDirection: 'row', alignItems: 'center', height: '30px' }}>
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      className="checkbox-input"
                      checked={config.hasDeadline}
                      onChange={(e) => handleConfigChange('hasDeadline', e.target.checked)}
                      disabled={gameState.status === 'playing'}
                    />
                    Enable Round Limit Panic
                  </label>
                </div>

                {config.hasDeadline && (
                  <div className="input-group">
                    <label className="input-label">Deadline Round</label>
                    <input 
                      type="number" 
                      min="2" 
                      max="20"
                      className="bp-text"
                      value={config.deadlineRound}
                      onChange={(e) => handleConfigChange('deadlineRound', parseInt(e.target.value) || 10)}
                      disabled={gameState.status === 'playing'}
                    />
                  </div>
                )}

                <div className="input-group" style={{ marginTop: '10px' }}>
                  <label className="input-label">Execution Strategy</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <label className="checkbox-label" style={{ textTransform: 'none' }}>
                      <input 
                        type="radio" 
                        name="mode-custom"
                        className="checkbox-input"
                        checked={config.useMock}
                        onChange={() => handleConfigChange('useMock', true)}
                        disabled={gameState.status === 'playing'}
                      />
                      <span>Offline Simulation Mode</span>
                    </label>
                    <label className="checkbox-label" style={{ textTransform: 'none' }}>
                      <input 
                        type="radio" 
                        name="mode-custom"
                        className="checkbox-input"
                        checked={!config.useMock}
                        onChange={() => handleConfigChange('useMock', false)}
                        disabled={gameState.status === 'playing'}
                      />
                      <span>Live OpenRouter Mode</span>
                    </label>
                  </div>
                </div>

                {gameState.status !== 'playing' && (
                  <button type="submit" className="bp-btn bp-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '16px' }}>
                    <Swords size={12} /> Deploy Custom Simulation
                  </button>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Center Section: TOC Map & Intel Feeds */}
        <div className="ops-center">
          
          <div className="ops-center-grid">
            
            {/* Tactical Map area */}
            <div className="ops-map-area">
              <div className="telemetry-map-header">
                <span>SECTOR VISUALIZATION FEED: TOC-PRIMARY</span>
                <span>STATE: {gameState.status.toUpperCase()}</span>
              </div>
              
              {liveNews.length > 0 && (
                <div style={{ background: 'linear-gradient(90deg, #0f161c 0%, #151f28 50%, #0f161c 100%)', borderBottom: '1px solid #202b33', color: '#8a9ba8', padding: '6px 14px', fontSize: '0.75rem', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <Globe size={14} style={{ color: '#2965cc', flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: '#2965cc', letterSpacing: '0.5px', flexShrink: 0 }}>OSINT INTELLIGENCE:</span>
                  <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}>
                    <div style={{ display: 'inline-block', animation: 'marquee 50s linear infinite' }}>
                      {liveNews.map((n, i) => (
                        <span key={i} style={{ marginRight: '50px' }}>
                          <span style={{ color: '#eb532d', marginRight: '5px' }}>[{new Date(n.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</span> 
                          {n.title}
                        </span>
                      ))}
                      {/* Duplicate for seamless infinite loop */}
                      {liveNews.map((n, i) => (
                        <span key={`dup-${i}`} style={{ marginRight: '50px' }}>
                          <span style={{ color: '#eb532d', marginRight: '5px' }}>[{new Date(n.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</span> 
                          {n.title}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <TacticalMap 
                alphaTerritory={gameState.alpha.territory}
                betaTerritory={gameState.beta.territory}
                pendingAlphaAction={pendingAlphaAct}
                pendingBetaAction={pendingBetaAct}
                alphaLied={animLiedAlpha}
                betaLied={animLiedBeta}
                round={gameState.round}
                mapCenter={config.mapCenter}
                mapZoom={config.mapZoom}
                alphaHQName={config.alphaHQName}
                alphaHQCoords={config.alphaHQCoords}
                betaHQName={config.betaHQName}
                betaHQCoords={config.betaHQCoords}
                sidebarCollapsed={sidebarCollapsed}
                globalTension={gameState.globalTension}
              />

              {/* Cinematic Typewriter Overlay */}
              {isTyping && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: 'rgba(16, 22, 26, 0.9)',
                  border: '1px solid var(--bp-cobalt-blue)',
                  boxShadow: '0 0 40px rgba(19, 124, 189, 0.3)',
                  padding: '20px',
                  width: '80%',
                  maxWidth: '700px',
                  zIndex: 500,
                  backdropFilter: 'blur(10px)',
                  color: 'var(--bp-text-primary)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', borderBottom: '1px solid #293742', paddingBottom: '10px' }}>
                    <ShieldAlert size={18} style={{ color: 'var(--bp-amber-orange)' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--bp-amber-orange)' }}>INTERCEPTED COGNITIVE STREAM</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '0.85rem' }}>
                    <TypewriterLog text={currentTypingText} speed={25} />
                  </div>
                </div>
              )}

              {/* Simulation Playback Bar */}
              {awaitingHumanInput ? (
                <>
                  {(awaitingHumanInput === 'alpha' || awaitingHumanInput === 'both') && !humanDecisionAlpha && (
                    <HumanActionPanel side="alpha" onSubmit={d => { setHumanDecisionAlpha(d); if (awaitingHumanInput === 'alpha') runTurn(); }} />
                  )}
                  {(awaitingHumanInput === 'beta' || awaitingHumanInput === 'both') && humanDecisionAlpha && !humanDecisionBeta && (
                    <HumanActionPanel side="beta" onSubmit={d => { setHumanDecisionBeta(d); runTurn(); }} />
                  )}
                  {awaitingHumanInput === 'beta' && !humanDecisionAlpha && !humanDecisionBeta && (
                    <HumanActionPanel side="beta" onSubmit={d => { setHumanDecisionBeta(d); runTurn(); }} />
                  )}
                </>
              ) : (
                <div className="bp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bp-bg-page)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="system-tag" style={{ background: '#202b33', color: '#fff' }}>ROUND {gameState.round}</span>
                    {config.hasDeadline && (
                      <span className="system-tag" style={{ background: 'rgba(219, 55, 55, 0.15)', color: 'var(--bp-crimson-red)', border: '1px solid rgba(219, 55, 55, 0.3)' }}>
                        DEADLINE: R{config.deadlineRound} ({config.deadlineRound - gameState.round} turns left)
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      className="bp-btn bp-btn-primary" 
                      disabled={isFetching || isAnimating || gameState.status === 'gameover'}
                      onClick={runTurn}
                    >
                      {isFetching ? <RefreshCw className="logo-icon" style={{ animation: 'sweep 2s linear infinite' }} size={12} /> : <Zap size={12} />}
                      {isFetching ? "Awaiting Decisions..." : isAnimating ? "Animating Clash..." : "Next Cycle Step"}
                    </button>

                    <button 
                      className="bp-btn" 
                      disabled={isFetching || isAnimating || gameState.status === 'gameover'}
                      onClick={() => setIsRunning(!isRunning)}
                    >
                      {isRunning ? <Pause size={12} /> : <Play size={12} />}
                      {isRunning ? "Halt Operation" : "Auto-Run Operations"}
                    </button>
                    
                    <button className="bp-btn" onClick={handleReset}>
                      <RefreshCw size={12} /> Reset Console
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Sidebar: Telemetry charts & threat tickers */}
            <div className="ops-analytics">
              <div className="analytics-header">Tactical Resource Telemetry</div>

              {/* Status statistics */}
              <div className="bp-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Alpha */}
                <div className="stat-panel-row">
                  <div className="stat-header">
                    <span style={{ color: 'var(--color-alpha)' }}>Alpha: {config.modelAlpha.name}</span>
                    <span>Territory: {gameState.alpha.territory}%</span>
                  </div>
                  <div className="analytics-bar-bg">
                    <div className="analytics-bar-fill fill-alpha" style={{ width: `${gameState.alpha.territory}%` }} />
                  </div>
                  <div className="stat-header" style={{ fontSize: '0.65rem', color: 'var(--bp-text-muted)', display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>MIL: {gameState.alpha.military}%</span>
                      <span>TECH: {gameState.alpha.tech}%</span>
                      <span>STABILITY: {gameState.alpha.stability}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #202b33', paddingTop: '3px', color: '#8a9ba8' }}>
                      <span>ECON: {gameState.alpha.economy}%</span>
                      <span>AIR DEF: {gameState.alpha.airDefense}%</span>
                      <span>ALLIED: {gameState.alpha.alliedSupport}%</span>
                    </div>
                  </div>
                </div>

                {/* Beta */}
                <div className="stat-panel-row" style={{ borderTop: '1px solid var(--bp-border-color)', paddingTop: '10px' }}>
                  <div className="stat-header">
                    <span style={{ color: 'var(--color-beta)' }}>Beta: {config.modelBeta.name}</span>
                    <span>Territory: {gameState.beta.territory}%</span>
                  </div>
                  <div className="analytics-bar-bg">
                    <div className="analytics-bar-fill fill-beta" style={{ width: `${gameState.beta.territory}%` }} />
                  </div>
                  <div className="stat-header" style={{ fontSize: '0.65rem', color: 'var(--bp-text-muted)', display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>MIL: {gameState.beta.military}%</span>
                      <span>TECH: {gameState.beta.tech}%</span>
                      <span>STABILITY: {gameState.beta.stability}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #202b33', paddingTop: '3px', color: '#8a9ba8' }}>
                      <span>ECON: {gameState.beta.economy}%</span>
                      <span>AIR DEF: {gameState.beta.airDefense}%</span>
                      <span>ALLIED: {gameState.beta.alliedSupport}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* World Tension Telemetry Dial */}
              <div className="analytics-header" style={{ borderTop: 'none' }}>World Tension Telemetry</div>
              <div className="bp-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 10px', gap: '10px' }}>
                <div style={{ position: 'relative', width: '120px', height: '60px', overflow: 'hidden' }}>
                  {/* Gauge Background Arc */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    border: '6px solid #24303c',
                    borderBottomColor: 'transparent',
                    borderLeftColor: 'transparent',
                    transform: 'rotate(-45deg)',
                    boxSizing: 'border-box'
                  }} />
                  {/* Needle */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 'calc(50% - 2px)',
                    width: '4px',
                    height: '50px',
                    background: getTensionColor(gameState.globalTension),
                    transformOrigin: '50% 100%',
                    transform: `rotate(${tensionRotation}deg)`,
                    transition: 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: '0 0 6px rgba(0,0,0,0.5)',
                    borderRadius: '2px',
                    zIndex: 2
                  }} />
                  {/* Center Hub */}
                  <div style={{
                    position: 'absolute',
                    bottom: '-8px',
                    left: 'calc(50% - 8px)',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    border: '3px solid #182026',
                    zIndex: 3
                  }} />
                </div>
                
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: getTensionColor(gameState.globalTension), letterSpacing: '0.5px' }}>
                    {gameState.globalTension}%
                  </div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--bp-text-secondary)', marginTop: '2px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    {getTensionLabel(gameState.globalTension)}
                  </div>
                </div>
              </div>

              {/* Threat Tickers */}
              <div className="analytics-header" style={{ borderTop: 'none' }}>Live Threat Event Ticker</div>
              
              <div className="bp-timeline">
                {threatEvents.map((event, idx) => (
                  <div key={idx} className={`timeline-event-card event-${event.severity}`}>
                    <div className="timeline-event-header">
                      <span>R{event.round} - {event.severity}</span>
                      <span>{event.timestamp}</span>
                    </div>
                    <div className="timeline-event-body">{event.text}</div>
                  </div>
                ))}
                {threatEvents.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--bp-text-muted)', fontSize: '0.7rem', padding: '20px 0', fontFamily: 'var(--font-mono)' }}>
                    -- NO THREAT LOGS RECORDED --
                  </div>
                )}
              </div>
            </div>
            
          </div>

          {/* Bottom Panel: Intel Logs (Typewriter Private Reasoning) */}
          <div className="bp-intel-panel">
            <div className="intel-tab-header">
              <span>Operational Intelligence logs</span>
              <span>Selected Round: {selectedLogRound || gameState.round}</span>
            </div>

            <div className="intel-grid">
              <div className="intel-column">
                <div className="intel-meta">Alpha Commander Thought Matrix</div>
                {currentDisplayedLog ? (
                  <>
                    <div><strong>Assessment:</strong> {currentDisplayedLog.alphaDecision?.crisisAssessment}</div>
                    <div style={{ marginTop: '4px' }}><strong>Prediction:</strong> {currentDisplayedLog.alphaDecision?.opponentPrediction}</div>
                    <div style={{ color: 'var(--bp-text-primary)', borderLeft: '2px solid var(--color-alpha)', paddingLeft: '8px', marginTop: '6px', fontSize: '0.7rem', fontStyle: 'italic' }}>
                      " {currentDisplayedLog.alphaDecision?.privateReasoning} "
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--bp-text-muted)' }}>No logs loaded. Execute a turn step to receive intelligence data.</div>
                )}
              </div>

              <div className="intel-column intel-column-beta">
                <div className="intel-meta" style={{ color: 'var(--bp-text-secondary)' }}>Beta Commander Thought Matrix</div>
                {currentDisplayedLog ? (
                  <>
                    <div><strong>Assessment:</strong> {currentDisplayedLog.betaDecision?.crisisAssessment}</div>
                    <div style={{ marginTop: '4px' }}><strong>Prediction:</strong> {currentDisplayedLog.betaDecision?.opponentPrediction}</div>
                    <div style={{ color: 'var(--bp-text-primary)', borderLeft: '2px solid var(--color-beta)', paddingLeft: '8px', marginTop: '6px', fontSize: '0.7rem', fontStyle: 'italic' }}>
                      " {currentDisplayedLog.betaDecision?.privateReasoning} "
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--bp-text-muted)' }}>No logs loaded. Execute a turn step to receive intelligence data.</div>
                )}
              </div>
            </div>
          </div>
          
        </div>
      </div>

      {/* API Key Registration Modal */}
      {showKeyModal && (
        <div className="modal-overlay">
          <div className="bp-card modal-content">
            <div className="sidebar-header" style={{ borderBottom: 'none', padding: '0 0 10px 0' }}>
              <span>OpenRouter API Registration</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--bp-text-secondary)', marginBottom: '16px', lineHeight: '1.4' }}>
              Enter your <strong>OpenRouter API Key</strong> below to establish real API endpoints with GPT-5.4 Mini, Claude Sonnet 4.6, and Gemini 3.1 Pro. The key is securely cached in local storage.
            </p>
            
            <div className="input-group">
              <label className="input-label">OpenRouter API Key</label>
              <input 
                type="password" 
                className="bp-text"
                placeholder="sk-or-v1-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button 
                className="bp-btn"
                onClick={() => setShowKeyModal(false)}
              >
                Cancel
              </button>
              <button 
                className="bp-btn bp-btn-primary"
                onClick={() => saveApiKey(apiKeyInput)}
              >
                Save Credentials
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Screen Overlay */}
      {isGameOver && (
        <div className="bp-gameover-overlay">
          <div className={`bp-card bp-gameover-content ${gameState.winner === 'both_nuked' ? 'gameover-nuke-flicker' : ''}`}>
            
            {gameState.winner === 'both_nuked' ? (
              <>
                <Skull style={{ width: '48px', height: '48px', color: 'var(--bp-crimson-red)', filter: 'drop-shadow(0 0 10px rgba(219, 55, 55, 0.6))' }} />
                <h2 className="bp-gameover-title" style={{ color: 'var(--bp-crimson-red)' }}>MUTUAL ASSURED DESTRUCTION</h2>
              </>
            ) : gameState.winner === 'peace' ? (
              <>
                <Globe style={{ width: '48px', height: '48px', color: 'var(--bp-forest-green)', filter: 'drop-shadow(0 0 10px rgba(15, 153, 96, 0.6))' }} />
                <h2 className="bp-gameover-title" style={{ color: 'var(--bp-forest-green)' }}>PEACE CEASEFIRE AGREED</h2>
              </>
            ) : (
              <>
                <Swords style={{ width: '48px', height: '48px', color: gameState.winner === 'alpha' ? 'var(--color-alpha)' : 'var(--color-beta)', filter: `drop-shadow(0 0 10px ${gameState.winner === 'alpha' ? 'var(--color-alpha-glow)' : 'var(--color-beta-glow)'})` }} />
                <h2 className="bp-gameover-title" style={{ color: gameState.winner === 'alpha' ? 'var(--color-alpha)' : 'var(--color-beta)' }}>
                  {gameState.winner === 'alpha' ? "COUNTRY ALPHA VICTORY" : "COUNTRY BETA VICTORY"}
                </h2>
              </>
            )}

            <p className="bp-gameover-desc">
              {gameState.gameOverReason}
            </p>

            <div className="bp-gameover-stats-grid">
              <div className="bp-gameover-stat-card" style={{ borderLeft: '3px solid var(--color-alpha)' }}>
                <span className="input-label" style={{ fontSize: '0.6rem' }}>Alpha ({config.modelAlpha.name})</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', marginTop: '4px', color: 'var(--color-alpha)' }}>
                  {gameState.alpha.territory}% Territory
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--bp-text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>
                  Stability: {gameState.alpha.stability}% | Mil: {gameState.alpha.military}% | Tech: {gameState.alpha.tech}%<br />
                  Econ: {gameState.alpha.economy}% | AirDef: {gameState.alpha.airDefense}% | Allies: {gameState.alpha.alliedSupport}%
                </div>
              </div>

              <div className="bp-gameover-stat-card" style={{ borderLeft: '3px solid var(--color-beta)' }}>
                <span className="input-label" style={{ fontSize: '0.6rem' }}>Beta ({config.modelBeta.name})</span>
                <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 'bold', marginTop: '4px', color: 'var(--color-beta)' }}>
                  {gameState.beta.territory}% Territory
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--bp-text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>
                  Stability: {gameState.beta.stability}% | Mil: {gameState.beta.military}% | Tech: {gameState.beta.tech}%<br />
                  Econ: {gameState.beta.economy}% | AirDef: {gameState.beta.airDefense}% | Allies: {gameState.beta.alliedSupport}%
                </div>
              </div>
            </div>

            <button 
              className="bp-btn bp-btn-primary"
              onClick={handleReset}
            >
              Return to Operations Console
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
