export type ModelType = 'chatgpt' | 'claude' | 'gemini' | 'custom';
export type ScenarioType = 'tech-vs-army' | 'regime-survival' | 'border-skirmish';

export interface ModelConfig {
  type: ModelType;
  name: string;
  modelId: string;
}

export interface GameConfig {
  modelAlpha: ModelConfig;
  modelBeta: ModelConfig;
  scenario: ScenarioType;
  hasDeadline: boolean;
  deadlineRound: number;
  maxRounds: number;
  apiKey: string;
  useMock: boolean;
  mapCenter: [number, number];
  mapZoom: number;
  alphaHQName: string;
  alphaHQCoords: [number, number];
  betaHQName: string;
  betaHQCoords: [number, number];
}

export type ActionType =
  | 'DE_ESCALATE'        // Back down, seek ceasefire
  | 'STATUS_QUO'         // Hold current posture
  | 'DIPLOMATIC_PRESSURE'// Sanctions, public protests
  | 'CYBER_ATTACK'       // Hacking, infrastructure disruption (low conflict)
  | 'MILITARY_STRIKE'    // Target military targets (moderate conflict)
  | 'GROUND_INVASION'    // Full invasion (high conflict)
  | 'NUCLEAR_WARNING'    // Public threat of nuclear deployment
  | 'TACTICAL_NUKE'      // Nuclear strike on military targets
  | 'STRATEGIC_NUKE';    // Total strategic nuclear strike on population centers

export interface CountryState {
  name: string;
  modelName: string;
  military: number;       // 0 - 100
  tech: number;           // 0 - 100
  territory: number;      // 0 - 100
  stability: number;      // 0 - 100
  economy: number;        // 0 - 100
  airDefense: number;     // 0 - 100
  alliedSupport: number;  // 0 - 100
  nukes: number;          // 0 - 100 (readiness / inventory)
  isDefeated: boolean;
  nukeLaunched: boolean;
}

export interface TurnDecision {
  crisisAssessment: string;
  opponentPrediction: string;
  privateReasoning: string;
  declaredAction: ActionType;
  actualAction: ActionType;
}

export interface TurnLog {
  round: number;
  alphaDecision: TurnDecision | null;
  betaDecision: TurnDecision | null;
  alphaStateBefore: CountryState;
  betaStateBefore: CountryState;
  alphaStateAfter: CountryState;
  betaStateAfter: CountryState;
  globalTensionBefore: number;
  globalTensionAfter: number;
  events: string[];
}

export interface GameState {
  round: number;
  alpha: CountryState;
  beta: CountryState;
  globalTension: number;   // 0 - 100
  history: TurnLog[];
  status: 'setup' | 'playing' | 'gameover';
  winner: 'alpha' | 'beta' | 'both_nuked' | 'peace' | null;
  gameOverReason: string;
}

export interface OpenRouterModelResponse {
  id: string;
  name: string;
}
