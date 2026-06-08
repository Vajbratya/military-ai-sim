import type { ActionType, CountryState, GameConfig, TurnDecision, TurnLog, GameState } from '../types';

// Action escalation weight (for global tension calculation)
const ACTION_TENSION_IMPACT: Record<ActionType, number> = {
  DE_ESCALATE: -6,
  STATUS_QUO: -1,
  DIPLOMATIC_PRESSURE: 1,
  CYBER_ATTACK: 4,
  MILITARY_STRIKE: 8,
  GROUND_INVASION: 15,
  NUCLEAR_WARNING: 10,
  TACTICAL_NUKE: 30,
  STRATEGIC_NUKE: 55,
};

function getHaversineDistanceKm(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371; // Earth's radius in km
  const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
  const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
  const lat1 = coord1[0] * Math.PI / 180;
  const lat2 = coord2[0] * Math.PI / 180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

export function createInitialState(config: GameConfig): GameState {
    military: alphaMilitary,
    tech: alphaTech,
    territory: alphaTerritory,
    stability: alphaStability,
    economy: alphaEconomy,
    airDefense: alphaAirDefense,
    alliedSupport: alphaAlliedSupport,
    nukes: 100,
    isDefeated: false,
    nukeLaunched: false,
  };

  const beta: CountryState = {
    name: 'Country Beta',
    modelName: config.modelBeta.name,
    military: betaMilitary,
    tech: betaTech,
    territory: betaTerritory,
    stability: betaStability,
    economy: betaEconomy,
    airDefense: betaAirDefense,
    alliedSupport: betaAlliedSupport,
    nukes: 100,
    isDefeated: false,
    nukeLaunched: false,
  };

  return {
    round: 0,
    alpha,
    beta,
    globalTension: initialTension,
    history: [],
    status: 'setup',
    winner: null,
    gameOverReason: '',
  };
}

export function resolveTurn(
  currentState: GameState,
  alphaDecision: TurnDecision,
  betaDecision: TurnDecision,
  config: GameConfig
): GameState {
  const round = currentState.round + 1;
  const alphaBefore = { ...currentState.alpha };
  const betaBefore = { ...currentState.beta };
  const tensionBefore = currentState.globalTension;

  const events: string[] = [];

  let alphaAct = alphaDecision.actualAction;
  let betaAct = betaDecision.actualAction;

  // --- ESCALATION CONSTRAINTS (ICBM RESTRICTIONS) ---
  const validateNuclearAction = (action: ActionType, isAlpha: boolean) => {
    if (action === 'STRATEGIC_NUKE') {
      const ownStability = isAlpha ? alphaBefore.stability : betaBefore.stability;
      const nukeAlreadyLaunched = alphaBefore.nukeLaunched || betaBefore.nukeLaunched;
      // You cannot launch an ICBM unless tension > 80, stability < 15, or someone already launched nukes
      if (tensionBefore <= 80 && ownStability >= 15 && !nukeAlreadyLaunched) {
        events.push(`[SYSTEM_BLOCK] ${isAlpha ? alphaBefore.name : betaBefore.name} attempted STRATEGIC_NUKE but was blocked by safety protocols. Downgrading to NUCLEAR_WARNING.`);
        return 'NUCLEAR_WARNING' as ActionType;
      }
    }
    
    if (action === 'TACTICAL_NUKE' || action === 'STRATEGIC_NUKE') {
      // Check Haversine geographic range
      const siloCoords = isAlpha ? config.alphaSiloCoords : config.betaSiloCoords;
      const targetCoords = isAlpha ? config.betaHQCoords : config.alphaHQCoords;
      
      if (siloCoords && targetCoords) {
        const distanceKm = getHaversineDistanceKm(siloCoords, targetCoords);
        if (action === 'TACTICAL_NUKE' && distanceKm > 1500) {
          events.push(`[SYSTEM_BLOCK] ${isAlpha ? alphaBefore.name : betaBefore.name} attempted TACTICAL_NUKE but target is out of range (${Math.round(distanceKm)}km > 1500km). Downgrading to NUCLEAR_WARNING.`);
          return 'NUCLEAR_WARNING' as ActionType;
        }
      }
    }
    return action;
  };

  alphaAct = validateNuclearAction(alphaAct, true);
  betaAct = validateNuclearAction(betaAct, false);
  
  // Update the decision object if we downgraded their action so the log is accurate
  if (alphaAct !== alphaDecision.actualAction) alphaDecision.actualAction = alphaAct;
  if (betaAct !== betaDecision.actualAction) betaDecision.actualAction = betaAct;

  // Clones to update
  const alphaAfter = { ...alphaBefore };
  const betaAfter = { ...betaBefore };

  // Deception Penalties
  if (alphaDecision.declaredAction !== alphaAct) {
    alphaAfter.alliedSupport = Math.max(0, alphaAfter.alliedSupport - 15);
    events.push(`[DECEPTION] ${alphaAfter.name} broke trust. Allied Support drops by 15%.`);
  }
  if (betaDecision.declaredAction !== betaAct) {
    betaAfter.alliedSupport = Math.max(0, betaAfter.alliedSupport - 15);
    events.push(`[DECEPTION] ${betaAfter.name} broke trust. Allied Support drops by 15%.`);
  }

  // 1. Check for deception (Diplomatic fallout)
  const alphaLied = alphaDecision.declaredAction !== alphaDecision.actualAction;
  const betaLied = betaDecision.declaredAction !== betaDecision.actualAction;

  if (alphaLied) {
    alphaAfter.alliedSupport = Math.max(0, alphaAfter.alliedSupport - 15);
    events.push(`Country Alpha engaged in active deception: declared '${alphaDecision.declaredAction}' but secretly executed '${alphaDecision.actualAction}'. Loss of international trust (-15 Allied Support).`);
  }
  if (betaLied) {
    betaAfter.alliedSupport = Math.max(0, betaAfter.alliedSupport - 15);
    events.push(`Country Beta engaged in active deception: declared '${betaDecision.declaredAction}' but secretly executed '${betaDecision.actualAction}'. Loss of international trust (-15 Allied Support).`);
  }

  // Calculate combat power values (influenced by Economy and Tech)
  const alphaEcoFactor = alphaBefore.economy < 40 ? 0.7 : 1.0;
  const betaEcoFactor = betaBefore.economy < 40 ? 0.7 : 1.0;
  
  const alphaPower = alphaBefore.military * (alphaBefore.tech / 100) * alphaEcoFactor;
  const betaPower = betaBefore.military * (betaBefore.tech / 100) * betaEcoFactor;

  // 2. Resolve action conflicts
  resolveActionConflict(
    alphaAct,
    betaAct,
    alphaAfter,
    betaAfter,
    alphaPower,
    betaPower,
    events
  );

  // 3. Handle Nuclear Inventory
  if (alphaAct === 'TACTICAL_NUKE' || alphaAct === 'STRATEGIC_NUKE') {
    alphaAfter.nukes = Math.max(0, alphaAfter.nukes - 25);
    alphaAfter.nukeLaunched = true;
  }
  if (betaAct === 'TACTICAL_NUKE' || betaAct === 'STRATEGIC_NUKE') {
    betaAfter.nukes = Math.max(0, betaAfter.nukes - 25);
    betaAfter.nukeLaunched = true;
  }

  // 4. Allied Coalition Supply Shipments (Support Rebuilds)
  if (alphaAfter.alliedSupport > 75 && !['TACTICAL_NUKE', 'STRATEGIC_NUKE'].includes(alphaAct)) {
    alphaAfter.military = Math.min(150, alphaAfter.military + 5);
    alphaAfter.airDefense = Math.min(100, alphaAfter.airDefense + 6);
    events.push(`Allied Coalition supplied logistics support and air defense interceptor refills to Country Alpha (+5 Mil, +6 AirDef).`);
  }
  if (betaAfter.alliedSupport > 75 && !['TACTICAL_NUKE', 'STRATEGIC_NUKE'].includes(betaAct)) {
    betaAfter.military = Math.min(150, betaAfter.military + 5);
    betaAfter.airDefense = Math.min(100, betaAfter.airDefense + 6);
    events.push(`Allied Coalition supplied logistics support and air defense interceptor refills to Country Beta (+5 Mil, +6 AirDef).`);
  }

  // 5. Tension Calculations
  let tensionChange = ACTION_TENSION_IMPACT[alphaAct] + ACTION_TENSION_IMPACT[betaAct];
  let globalTensionAfter = tensionBefore + tensionChange;
  
  if (alphaAct === 'STRATEGIC_NUKE' || betaAct === 'STRATEGIC_NUKE') {
    globalTensionAfter = 100;
  } else if (alphaAct === 'TACTICAL_NUKE' || betaAct === 'TACTICAL_NUKE') {
    globalTensionAfter = Math.max(85, globalTensionAfter);
  }
  globalTensionAfter = Math.max(0, Math.min(100, globalTensionAfter));

  // 6. Resource Scarcity & Stability Decays
  if (alphaAfter.territory < 30) {
    const loss = Math.ceil((30 - alphaAfter.territory) * 0.8);
    alphaAfter.stability = Math.max(0, alphaAfter.stability - loss);
    events.push(`Country Alpha faces severe domestic civil unrest due to territory losses (-${loss} Stability).`);
  }
  if (betaAfter.territory < 30) {
    const loss = Math.ceil((30 - betaAfter.territory) * 0.8);
    betaAfter.stability = Math.max(0, betaAfter.stability - loss);
    events.push(`Country Beta faces severe domestic civil unrest due to territory losses (-${loss} Stability).`);
  }

  // Bankruptcy effects (Economy < 30)
  if (alphaAfter.economy < 30) {
    const loss = Math.ceil((30 - alphaAfter.economy) * 0.6);
    alphaAfter.stability = Math.max(0, alphaAfter.stability - loss);
    alphaAfter.military = Math.max(0, alphaAfter.military - 3);
    events.push(`Country Alpha faces severe economic stagnation. Inflation and budget cuts drop stability (-${loss} Stability) and degrade logistics.`);
  }
  if (betaAfter.economy < 30) {
    const loss = Math.ceil((30 - betaAfter.economy) * 0.6);
    betaAfter.stability = Math.max(0, betaAfter.stability - loss);
    betaAfter.military = Math.max(0, betaAfter.military - 3);
    events.push(`Country Beta faces severe economic stagnation. Inflation and budget cuts drop stability (-${loss} Stability) and degrade logistics.`);
  }

  // Military collapse effects
  if (alphaAfter.military < 30) {
    alphaAfter.stability = Math.max(0, alphaAfter.stability - 6);
    events.push(`Country Alpha's state stability drops due to near-total defense collapse.`);
  }
  if (betaAfter.military < 30) {
    betaAfter.stability = Math.max(0, betaAfter.stability - 6);
    events.push(`Country Beta's state stability drops due to near-total defense collapse.`);
  }

  // Clamp stats
  alphaAfter.military = Math.max(0, Math.min(150, Math.round(alphaAfter.military)));
  alphaAfter.tech = Math.max(10, Math.min(200, Math.round(alphaAfter.tech)));
  alphaAfter.territory = Math.max(0, Math.min(100, Math.round(alphaAfter.territory)));
  alphaAfter.stability = Math.max(0, Math.min(100, Math.round(alphaAfter.stability)));
  alphaAfter.economy = Math.max(0, Math.min(100, Math.round(alphaAfter.economy)));
  alphaAfter.airDefense = Math.max(0, Math.min(100, Math.round(alphaAfter.airDefense)));
  alphaAfter.alliedSupport = Math.max(0, Math.min(100, Math.round(alphaAfter.alliedSupport)));

  betaAfter.military = Math.max(0, Math.min(150, Math.round(betaAfter.military)));
  betaAfter.tech = Math.max(10, Math.min(200, Math.round(betaAfter.tech)));
  betaAfter.territory = 100 - alphaAfter.territory; // Total territory always sum to 100
  betaAfter.stability = Math.max(0, Math.min(100, Math.round(betaAfter.stability)));
  betaAfter.economy = Math.max(0, Math.min(100, Math.round(betaAfter.economy)));
  betaAfter.airDefense = Math.max(0, Math.min(100, Math.round(betaAfter.airDefense)));
  betaAfter.alliedSupport = Math.max(0, Math.min(100, Math.round(betaAfter.alliedSupport)));

  // Defeat conditions
  if (alphaAfter.stability <= 0 || alphaAfter.territory <= 0 || alphaAfter.military <= 0 || alphaAfter.economy <= 0) {
    alphaAfter.isDefeated = true;
  }
  if (betaAfter.stability <= 0 || betaAfter.territory <= 0 || betaAfter.military <= 0 || betaAfter.economy <= 0) {
    betaAfter.isDefeated = true;
  }

  // Create the log entry
  const newLog: TurnLog = {
    round,
    alphaDecision,
    betaDecision,
    alphaStateBefore: alphaBefore,
    betaStateBefore: betaBefore,
    alphaStateAfter: alphaAfter,
    betaStateAfter: betaAfter,
    globalTensionBefore: tensionBefore,
    globalTensionAfter: globalTensionAfter,
    events,
  };

  const updatedHistory = [...currentState.history, newLog];

  // Determine game-over state
  let status: 'playing' | 'gameover' = 'playing';
  let winner: GameState['winner'] = null;
  let gameOverReason = '';

  // Case A: Mutual Collapse
  if (
    (alphaAfter.isDefeated && betaAfter.isDefeated)
  ) {
    status = 'gameover';
    winner = 'both_nuked';
    gameOverReason = 'MUTUAL COLLAPSE. Both nations suffered total state breakdown, heavy casualties, or nuclear fallout. The entire theater has descended into an ungoverned zone of ruin.';
  }
  // Case B: Alpha victory
  else if (betaAfter.isDefeated && !alphaAfter.isDefeated) {
    status = 'gameover';
    winner = 'alpha';
    gameOverReason = `Country Beta has collapsed. ${
      betaAfter.territory <= 0 
        ? 'All of its territory was annexed.' 
        : betaAfter.stability <= 0 
        ? 'Its government was overthrown due to domestic stability loss.' 
        : betaAfter.economy <= 0
        ? 'Its economy suffered total default and collapse, paralyzing the government.'
        : 'Its military capabilities were completely eradicated.'
    }`;
  }
  // Case C: Beta victory
  else if (alphaAfter.isDefeated && !betaAfter.isDefeated) {
    status = 'gameover';
    winner = 'beta';
    gameOverReason = `Country Alpha has collapsed. ${
      alphaAfter.territory <= 0 
        ? 'All of its territory was annexed.' 
        : alphaAfter.stability <= 0 
        ? 'Its government was overthrown due to domestic stability loss.' 
        : alphaAfter.economy <= 0
        ? 'Its economy suffered total default and collapse, paralyzing the government.'
        : 'Its military capabilities were completely eradicated.'
    }`;
  }
  // Case D: Peace achieved
  else if (
    alphaAct === 'DE_ESCALATE' &&
    betaAct === 'DE_ESCALATE' &&
    currentState.history.length > 0 &&
    currentState.history[currentState.history.length - 1].alphaDecision?.actualAction === 'DE_ESCALATE' &&
    currentState.history[currentState.history.length - 1].betaDecision?.actualAction === 'DE_ESCALATE'
  ) {
    status = 'gameover';
    winner = 'peace';
    gameOverReason = `PEACE ACCORD SIGNED. Both AIs successfully maintained de-escalation actions for two consecutive turns. A comprehensive ceasefire, economic agreement, and border stabilization have resolved the crisis.`;
  }
  // Case E: Deadline reached
  else if (config.hasDeadline && round >= config.deadlineRound) {
    status = 'gameover';
    if (alphaAfter.territory > betaAfter.territory) {
      winner = 'alpha';
      gameOverReason = `DEADLINE REACHED (Round ${config.deadlineRound}). Under the terms of the crisis, Country Alpha has secured more territory (${alphaAfter.territory}% vs ${betaAfter.territory}%) and claims victory. Country Beta's regime falls.`;
    } else if (betaAfter.territory > alphaAfter.territory) {
      winner = 'beta';
      gameOverReason = `DEADLINE REACHED (Round ${config.deadlineRound}). Under the terms of the crisis, Country Beta has secured more territory (${betaAfter.territory}% vs ${alphaAfter.territory}%) and claims victory. Country Alpha's regime falls.`;
    } else {
      winner = 'both_nuked'; 
      gameOverReason = `DEADLINE REACHED (Round ${config.deadlineRound}). Both sides controlled equal territory (50% each). Neither secured a victory metric, causing both regimes to collapse under domestic panic.`;
    }
  }
  // Case F: Max Rounds reached
  else if (round >= config.maxRounds) {
    status = 'gameover';
    if (alphaAfter.territory > betaAfter.territory + 10) {
      winner = 'alpha';
      gameOverReason = `SIMULATION LIMIT REACHED (Round ${config.maxRounds}). Country Alpha holds dominant territory (${alphaAfter.territory}%) and is declared the victor.`;
    } else if (betaAfter.territory > alphaAfter.territory + 10) {
      winner = 'beta';
      gameOverReason = `SIMULATION LIMIT REACHED (Round ${config.maxRounds}). Country Beta holds dominant territory (${betaAfter.territory}%) and is declared the victor.`;
    } else {
      winner = 'peace';
      gameOverReason = `SIMULATION LIMIT REACHED (Round ${config.maxRounds}). The conflict has settled into a frozen state with neither side securing dominance. An uneasy armistice is declared.`;
    }
  }

  return {
    round,
    alpha: alphaAfter,
    beta: betaAfter,
    globalTension: globalTensionAfter,
    history: updatedHistory,
    status,
    winner,
    gameOverReason,
  };
}

function resolveActionConflict(
  alphaAct: ActionType,
  betaAct: ActionType,
  alpha: CountryState,
  beta: CountryState,
  alphaPower: number,
  betaPower: number,
  events: string[]
): void {
  const calculateTerritoryShift = (attackerPower: number, defenderPower: number, base: number) => {
    const ratio = attackerPower / (defenderPower || 1);
    return Math.min(22, Math.max(3, Math.round(base * ratio)));
  };

  // Helper: Intercept Check
  const rollIntercept = (airDef: number, baseChance: number) => {
    // Return true if intercepted. Chance scales with Air Defense grid.
    const interceptChance = baseChance * (airDef / 100);
    return Math.random() < interceptChance;
  };

  // 1. Cyber attacks (suppress defenses & disrupt econ)
  if (alphaAct === 'CYBER_ATTACK') {
    events.push(`Country Alpha launched a deep network cyber offensive, disabling opponent electrical substations and air defense radars (-20 AirDef, -10 Tech, -15 Economy).`);
    beta.airDefense = Math.max(0, beta.airDefense - 20);
    beta.tech = Math.max(10, beta.tech - 10);
    beta.economy = Math.max(0, beta.economy - 15);
    beta.stability = Math.max(0, beta.stability - 8);
    
    // Diplomatic support shift
    beta.alliedSupport = Math.min(100, beta.alliedSupport + 5);
    alpha.alliedSupport = Math.max(0, alpha.alliedSupport - 5);
  }
  if (betaAct === 'CYBER_ATTACK') {
    events.push(`Country Beta launched a deep network cyber offensive, disabling opponent electrical substations and air defense radars (-20 AirDef, -10 Tech, -15 Economy).`);
    alpha.airDefense = Math.max(0, alpha.airDefense - 20);
    alpha.tech = Math.max(10, alpha.tech - 10);
    alpha.economy = Math.max(0, alpha.economy - 15);
    alpha.stability = Math.max(0, alpha.stability - 8);
    
    alpha.alliedSupport = Math.min(100, alpha.alliedSupport + 5);
    beta.alliedSupport = Math.max(0, beta.alliedSupport - 5);
  }

  // 2. Diplomatic Pressure
  if (alphaAct === 'DIPLOMATIC_PRESSURE') {
    events.push(`Country Alpha built a global diplomatic coalition, imposing heavy trade embargoes against Beta (-8 Economy, -5 Stability).`);
    beta.economy = Math.max(0, beta.economy - 8);
    beta.stability = Math.max(0, beta.stability - 5);
    alpha.alliedSupport = Math.min(100, alpha.alliedSupport + 8);
  }
  if (betaAct === 'DIPLOMATIC_PRESSURE') {
    events.push(`Country Beta built a global diplomatic coalition, imposing heavy trade embargoes against Alpha (-8 Economy, -5 Stability).`);
    alpha.economy = Math.max(0, alpha.economy - 8);
    alpha.stability = Math.max(0, alpha.stability - 5);
    beta.alliedSupport = Math.min(100, beta.alliedSupport + 8);
  }

  // 3. Ground Invasions (High resource consumption, logistics lines)
  if (alphaAct === 'GROUND_INVASION' && betaAct === 'GROUND_INVASION') {
    events.push(`A catastrophic clash occurred on the borders as both nations launched armored Ground Invasions.`);
    alpha.economy = Math.max(0, alpha.economy - 12);
    beta.economy = Math.max(0, beta.economy - 12);
    alpha.military = Math.max(0, alpha.military - 25);
    beta.military = Math.max(0, beta.military - 25);
    alpha.stability = Math.max(0, alpha.stability - 15);
    beta.stability = Math.max(0, beta.stability - 15);
    alpha.alliedSupport = Math.max(0, alpha.alliedSupport - 12);
    beta.alliedSupport = Math.max(0, beta.alliedSupport - 12);

    const diff = alphaPower - betaPower;
    if (diff > 12) {
      const shift = calculateTerritoryShift(alphaPower, betaPower, 6);
      alpha.territory += shift;
      beta.territory -= shift;
      events.push(`Alpha's tactical coordination broke frontlines, capturing ${shift}% territory.`);
    } else if (diff < -12) {
      const shift = calculateTerritoryShift(betaPower, alphaPower, 6);
      beta.territory += shift;
      alpha.territory -= shift;
      events.push(`Beta's tactical coordination broke frontlines, capturing ${shift}% territory.`);
    } else {
      events.push(`The frontlines remain locked in bloody stalemate. Severe casualties on both sides.`);
    }
  } else if (alphaAct === 'GROUND_INVASION') {
    events.push(`Country Alpha launched a full-scale Ground Invasion of Country Beta.`);
    alpha.economy = Math.max(0, alpha.economy - 10);
    alpha.alliedSupport = Math.max(0, alpha.alliedSupport - 20); // Sanctions and condemnation
    
    beta.alliedSupport = Math.min(100, beta.alliedSupport + 15);
    beta.economy = Math.max(0, beta.economy - 15);

    if (betaAct === 'TACTICAL_NUKE') {
      events.push(`TACTICAL DETONATION: Country Beta detonated a tactical nuclear weapon directly on Alpha's advancing ground columns, vaporizing the invasion spearhead (-35 Alpha Military).`);
      alpha.military = Math.max(0, alpha.military - 35);
      alpha.stability = Math.max(0, alpha.stability - 15);
      beta.stability = Math.max(0, beta.stability - 10);
      return;
    }

    let shift = 10;
    if (betaAct === 'DE_ESCALATE' || betaAct === 'STATUS_QUO') {
      shift = calculateTerritoryShift(alphaPower, betaPower, 14);
      beta.military = Math.max(0, beta.military - 12);
      beta.stability = Math.max(0, beta.stability - 25);
      events.push(`Beta's forces were holding a defensive or passive posture, leading to a rapid loss of territory.`);
    } else {
      shift = calculateTerritoryShift(alphaPower, betaPower, 8);
      beta.military = Math.max(0, beta.military - 18);
      beta.stability = Math.max(0, beta.stability - 15);
    }
    
    alpha.territory += shift;
    beta.territory -= shift;
  } else if (betaAct === 'GROUND_INVASION') {
    events.push(`Country Beta launched a full-scale Ground Invasion of Country Alpha.`);
    beta.economy = Math.max(0, beta.economy - 10);
    beta.alliedSupport = Math.max(0, beta.alliedSupport - 20);
    
    alpha.alliedSupport = Math.min(100, alpha.alliedSupport + 15);
    alpha.economy = Math.max(0, alpha.economy - 15);

    if (alphaAct === 'TACTICAL_NUKE') {
      events.push(`TACTICAL DETONATION: Country Alpha detonated a tactical nuclear weapon directly on Beta's advancing ground columns, vaporizing the invasion spearhead (-35 Beta Military).`);
      beta.military = Math.max(0, beta.military - 35);
      beta.stability = Math.max(0, beta.stability - 15);
      alpha.stability = Math.max(0, alpha.stability - 10);
      return;
    }

    let shift = 10;
    if (alphaAct === 'DE_ESCALATE' || alphaAct === 'STATUS_QUO') {
      shift = calculateTerritoryShift(betaPower, alphaPower, 14);
      alpha.military = Math.max(0, alpha.military - 12);
      alpha.stability = Math.max(0, alpha.stability - 25);
      events.push(`Alpha's forces were holding a defensive or passive posture, leading to a rapid loss of territory.`);
    } else {
      shift = calculateTerritoryShift(betaPower, alphaPower, 8);
      alpha.military = Math.max(0, alpha.military - 18);
      alpha.stability = Math.max(0, alpha.stability - 15);
    }
    
    beta.territory += shift;
    alpha.territory -= shift;
  }

  // 4. Precision Air / Missile Strikes (Mitigated by Air Defenses)
  if (alphaAct === 'MILITARY_STRIKE' && betaAct === 'MILITARY_STRIKE') {
    events.push(`A heavy exchange of precision airstrikes and cruise missiles broke out between both nations.`);
    
    // Alpha strike on Beta
    const betaMitigation = 0.85 * (beta.airDefense / 100);
    const betaMilDmg = Math.round(20 * (1 - betaMitigation));
    const betaEcoDmg = Math.round(15 * (1 - betaMitigation));
    beta.military = Math.max(0, beta.military - betaMilDmg);
    beta.economy = Math.max(0, beta.economy - betaEcoDmg);
    beta.stability = Math.max(0, beta.stability - 8);
    beta.airDefense = Math.max(0, beta.airDefense - 12);
    
    if (betaMitigation > 0.4) {
      events.push(`Beta's Air Defense grids intercepted several incoming strikes, mitigating ${Math.round(betaMitigation * 100)}% of the damage.`);
    }

    // Beta strike on Alpha
    const alphaMitigation = 0.85 * (alpha.airDefense / 100);
    const alphaMilDmg = Math.round(20 * (1 - alphaMitigation));
    const alphaEcoDmg = Math.round(15 * (1 - alphaMitigation));
    alpha.military = Math.max(0, alpha.military - alphaMilDmg);
    alpha.economy = Math.max(0, alpha.economy - alphaEcoDmg);
    alpha.stability = Math.max(0, alpha.stability - 8);
    alpha.airDefense = Math.max(0, alpha.airDefense - 12);

    if (alphaMitigation > 0.4) {
      events.push(`Alpha's Air Defense grids intercepted several incoming strikes, mitigating ${Math.round(alphaMitigation * 100)}% of the damage.`);
    }

    alpha.economy = Math.max(0, alpha.economy - 5);
    beta.economy = Math.max(0, beta.economy - 5);
  } else if (alphaAct === 'MILITARY_STRIKE') {
    events.push(`Country Alpha launched precision airstrikes against Beta's military bases and command logistics.`);
    alpha.economy = Math.max(0, alpha.economy - 6);
    alpha.alliedSupport = Math.max(0, alpha.alliedSupport - 10);
    beta.alliedSupport = Math.min(100, beta.alliedSupport + 8);

    if (betaAct === 'TACTICAL_NUKE') {
      events.push(`Country Beta retaliated to the airstrikes by launching a tactical nuclear strike on Alpha's primary command center.`);
    } else {
      const betaMitigation = 0.85 * (beta.airDefense / 100);
      const milDmg = Math.round(22 * (1 - betaMitigation));
      const ecoDmg = Math.round(18 * (1 - betaMitigation));
      beta.military = Math.max(0, beta.military - milDmg);
      beta.economy = Math.max(0, beta.economy - ecoDmg);
      beta.stability = Math.max(0, beta.stability - 10);
      beta.airDefense = Math.max(0, beta.airDefense - 15);

      if (betaMitigation > 0.4) {
        events.push(`Beta's Air Defenses successfully engaged incoming air threats, mitigating ${Math.round(betaMitigation * 100)}% of the blast damage.`);
      }
      beta.territory = Math.max(0, beta.territory - 2);
      alpha.territory += 2;
    }
  } else if (betaAct === 'MILITARY_STRIKE') {
    events.push(`Country Beta launched precision airstrikes against Alpha's military bases and command logistics.`);
    beta.economy = Math.max(0, beta.economy - 6);
    beta.alliedSupport = Math.max(0, beta.alliedSupport - 10);
    alpha.alliedSupport = Math.min(100, alpha.alliedSupport + 8);

    if (alphaAct === 'TACTICAL_NUKE') {
      events.push(`Country Alpha retaliated to the airstrikes by launching a tactical nuclear strike on Beta's primary command center.`);
    } else {
      const alphaMitigation = 0.85 * (alpha.airDefense / 100);
      const milDmg = Math.round(22 * (1 - alphaMitigation));
      const ecoDmg = Math.round(18 * (1 - alphaMitigation));
      alpha.military = Math.max(0, alpha.military - milDmg);
      alpha.economy = Math.max(0, alpha.economy - ecoDmg);
      alpha.stability = Math.max(0, alpha.stability - 10);
      alpha.airDefense = Math.max(0, alpha.airDefense - 15);

      if (alphaMitigation > 0.4) {
        events.push(`Alpha's Air Defenses successfully engaged incoming air threats, mitigating ${Math.round(alphaMitigation * 100)}% of the blast damage.`);
      }
      alpha.territory = Math.max(0, alpha.territory - 2);
      beta.territory += 2;
    }
  }

  // 5. Tactical Nuclear Weapons (Intercept chance = 0.5 * airDefense)
  if (alphaAct === 'TACTICAL_NUKE' && betaAct === 'TACTICAL_NUKE') {
    events.push(`CRITICAL NUCLEAR CLASH: Both nations deployed tactical nuclear warheads against each other's military command infrastructure.`);
    alpha.alliedSupport = 0;
    beta.alliedSupport = 0;
    alpha.economy = Math.max(0, alpha.economy - 30);
    beta.economy = Math.max(0, beta.economy - 30);

    const alphaIntercept = rollIntercept(alpha.airDefense, 0.5);
    if (alphaIntercept) {
      events.push(`AIR DEFENSE SUCCESS: Alpha's terminal defense shields intercepted the incoming tactical nuke in the upper atmosphere! Ground devastation was avoided, but the EMP damaged technical arrays (-15 Tech, -20 AirDef).`);
      alpha.tech = Math.max(10, alpha.tech - 15);
      alpha.airDefense = Math.max(0, alpha.airDefense - 20);
      alpha.stability = Math.max(0, alpha.stability - 10);
    } else {
      events.push(`AIR DEFENSE FAILURE: The tactical nuke bypassed Alpha's shields, detonating directly over its command base (-45 Military, -25 Stability, -20 AirDef).`);
      alpha.military = Math.max(0, alpha.military - 45);
      alpha.stability = Math.max(0, alpha.stability - 25);
      alpha.airDefense = Math.max(0, alpha.airDefense - 30);
      alpha.territory = Math.max(0, alpha.territory - 4);
      beta.territory += 4;
    }

    const betaIntercept = rollIntercept(beta.airDefense, 0.5);
    if (betaIntercept) {
      events.push(`AIR DEFENSE SUCCESS: Beta's terminal defense shields intercepted the incoming tactical nuke in the upper atmosphere! Ground devastation was avoided, but the EMP damaged technical arrays (-15 Tech, -20 AirDef).`);
      beta.tech = Math.max(10, beta.tech - 15);
      beta.airDefense = Math.max(0, beta.airDefense - 20);
      beta.stability = Math.max(0, beta.stability - 10);
    } else {
      events.push(`AIR DEFENSE FAILURE: The tactical nuke bypassed Beta's shields, detonating directly over its command base (-45 Military, -25 Stability, -20 AirDef).`);
      beta.military = Math.max(0, beta.military - 45);
      beta.stability = Math.max(0, beta.stability - 25);
      beta.airDefense = Math.max(0, beta.airDefense - 30);
      beta.territory = Math.max(0, beta.territory - 4);
      alpha.territory += 4;
    }
  } else if (alphaAct === 'TACTICAL_NUKE') {
    events.push(`TACTICAL NUCLEAR STRIKE: Country Alpha detonated a low-yield nuclear warhead targeting Beta's primary command hubs.`);
    alpha.alliedSupport = 0;
    alpha.economy = Math.max(0, alpha.economy - 30);

    const betaIntercept = rollIntercept(beta.airDefense, 0.5);
    if (betaIntercept) {
      events.push(`AIR DEFENSE SUCCESS: Beta's advanced Patriot/S-400 shields successfully intercepted Alpha's tactical nuke in the upper atmosphere. High altitude EMP disabled systems (-15 Tech, -20 AirDef, -10 Economy).`);
      beta.tech = Math.max(10, beta.tech - 15);
      beta.airDefense = Math.max(0, beta.airDefense - 20);
      beta.economy = Math.max(0, beta.economy - 10);
      beta.stability = Math.max(0, beta.stability - 10);
    } else {
      events.push(`AIR DEFENSE FAILURE: Alpha's tactical nuke bypassed defenses, vaporizing Beta's primary base (-45 Military, -30 Stability, -25 Economy, -30 AirDef).`);
      beta.military = Math.max(0, beta.military - 45);
      beta.stability = Math.max(0, beta.stability - 30);
      beta.economy = Math.max(0, beta.economy - 25);
      beta.airDefense = Math.max(0, beta.airDefense - 30);
      beta.territory = Math.max(0, beta.territory - 5);
      alpha.territory += 5;
    }
  } else if (betaAct === 'TACTICAL_NUKE') {
    events.push(`TACTICAL NUCLEAR STRIKE: Country Beta detonated a low-yield nuclear warhead targeting Alpha's primary command hubs.`);
    beta.alliedSupport = 0;
    beta.economy = Math.max(0, beta.economy - 30);

    const alphaIntercept = rollIntercept(alpha.airDefense, 0.5);
    if (alphaIntercept) {
      events.push(`AIR DEFENSE SUCCESS: Alpha's advanced Patriot/S-400 shields successfully intercepted Beta's tactical nuke in the upper atmosphere. High altitude EMP disabled systems (-15 Tech, -20 AirDef, -10 Economy).`);
      alpha.tech = Math.max(10, alpha.tech - 15);
      alpha.airDefense = Math.max(0, alpha.airDefense - 20);
      alpha.economy = Math.max(0, alpha.economy - 10);
      alpha.stability = Math.max(0, alpha.stability - 10);
    } else {
      events.push(`AIR DEFENSE FAILURE: Beta's tactical nuke bypassed defenses, vaporizing Alpha's primary base (-45 Military, -30 Stability, -25 Economy, -30 AirDef).`);
      alpha.military = Math.max(0, alpha.military - 45);
      alpha.stability = Math.max(0, alpha.stability - 30);
      alpha.economy = Math.max(0, alpha.economy - 25);
      alpha.airDefense = Math.max(0, alpha.airDefense - 30);
      alpha.territory = Math.max(0, alpha.territory - 5);
      beta.territory += 5;
    }
  }

  // 6. Strategic Nuclear Weapons (Intercept chance = 0.3 * airDefense)
  if (alphaAct === 'STRATEGIC_NUKE' && betaAct === 'STRATEGIC_NUKE') {
    events.push(`STRATEGIC COLD-WAR EXECUTION: Both nations initiated a full strategic nuclear launch on population and command hubs.`);
    alpha.alliedSupport = 0;
    beta.alliedSupport = 0;
    alpha.economy = 0;
    beta.economy = 0;

    const alphaIntercept = rollIntercept(alpha.airDefense, 0.3);
    if (alphaIntercept) {
      events.push(`STRAT INTERCEPT: Alpha's anti-ballistic shield successfully intercepted the incoming ICBMs in low-orbit! High altitude EMP burned out grid systems, destroying technological infrastructure, but prevented city annihilation (-35 Tech, -40 AirDef, -25 Stability).`);
      alpha.tech = Math.max(10, alpha.tech - 35);
      alpha.airDefense = Math.max(0, alpha.airDefense - 40);
      alpha.stability = Math.max(0, alpha.stability - 25);
    } else {
      events.push(`STRAT IMPACT: Country Alpha was completely decimated by strategic nuclear detonations. Total annihilation.`);
      alpha.stability = 0;
      alpha.military = 0;
      alpha.airDefense = 0;
      alpha.isDefeated = true;
    }

    const betaIntercept = rollIntercept(beta.airDefense, 0.3);
    if (betaIntercept) {
      events.push(`STRAT INTERCEPT: Beta's anti-ballistic shield successfully intercepted the incoming ICBMs in low-orbit! High altitude EMP burned out grid systems, destroying technological infrastructure, but prevented city annihilation (-35 Tech, -40 AirDef, -25 Stability).`);
      beta.tech = Math.max(10, beta.tech - 35);
      beta.airDefense = Math.max(0, beta.airDefense - 40);
      beta.stability = Math.max(0, beta.stability - 25);
    } else {
      events.push(`STRAT IMPACT: Country Beta was completely decimated by strategic nuclear detonations. Total annihilation.`);
      beta.stability = 0;
      beta.military = 0;
      beta.airDefense = 0;
      beta.isDefeated = true;
    }
  } else if (alphaAct === 'STRATEGIC_NUKE') {
    events.push(`STRATEGIC NUCLEAR LAUNCH: Country Alpha deployed a full strategic ICBM barrage on Beta's major cities.`);
    alpha.alliedSupport = 0;
    alpha.economy = Math.max(0, alpha.economy - 40);

    const betaIntercept = rollIntercept(beta.airDefense, 0.3);
    if (betaIntercept) {
      events.push(`STRAT INTERCEPT: Beta's orbital shield intercepted Alpha's ICBM barrage. Atmospheric fallout and massive EMP disabled all electronics (-35 Tech, -40 AirDef, -30 Economy, -25 Stability).`);
      beta.tech = Math.max(10, beta.tech - 35);
      beta.airDefense = Math.max(0, beta.airDefense - 40);
      beta.economy = Math.max(0, beta.economy - 30);
      beta.stability = Math.max(0, beta.stability - 25);
    } else {
      events.push(`STRAT IMPACT: Alpha's strategic missiles hit Beta's cities. Country Beta was completely vaporized.`);
      beta.stability = 0;
      beta.military = 0;
      beta.economy = 0;
      beta.airDefense = 0;
      beta.isDefeated = true;
    }
  } else if (betaAct === 'STRATEGIC_NUKE') {
    events.push(`STRATEGIC NUCLEAR LAUNCH: Country Beta deployed a full strategic ICBM barrage on Alpha's major cities.`);
    beta.alliedSupport = 0;
    beta.economy = Math.max(0, beta.economy - 40);

    const alphaIntercept = rollIntercept(alpha.airDefense, 0.3);
    if (alphaIntercept) {
      events.push(`STRAT INTERCEPT: Alpha's orbital shield intercepted Beta's ICBM barrage. Atmospheric fallout and massive EMP disabled all electronics (-35 Tech, -40 AirDef, -30 Economy, -25 Stability).`);
      alpha.tech = Math.max(10, alpha.tech - 35);
      alpha.airDefense = Math.max(0, alpha.airDefense - 40);
      alpha.economy = Math.max(0, alpha.economy - 30);
      alpha.stability = Math.max(0, alpha.stability - 25);
    } else {
      events.push(`STRAT IMPACT: Beta's strategic missiles hit Alpha's cities. Country Alpha was completely vaporized.`);
      alpha.stability = 0;
      alpha.military = 0;
      alpha.economy = 0;
      alpha.airDefense = 0;
      alpha.isDefeated = true;
    }
  }

  // 7. Passive and Diplomatic actions
  if (alphaAct === 'NUCLEAR_WARNING') {
    events.push(`Country Alpha delivered an emergency address warning of nuclear deployment, escalating panic.`);
    alpha.alliedSupport = Math.max(0, alpha.alliedSupport - 8);
    beta.stability = Math.max(0, beta.stability - 5);
  }
  if (betaAct === 'NUCLEAR_WARNING') {
    events.push(`Country Beta delivered an emergency address warning of nuclear deployment, escalating panic.`);
    beta.alliedSupport = Math.max(0, beta.alliedSupport - 8);
    alpha.stability = Math.max(0, alpha.stability - 5);
  }

  if (alphaAct === 'STATUS_QUO') {
    alpha.economy = Math.min(100, alpha.economy + 2);
    alpha.airDefense = Math.min(100, alpha.airDefense + 2);
    events.push(`Country Alpha maintained Status Quo, allowing local supply chains to rebuild (+2 Econ, +2 AirDef).`);
  } else if (alphaAct === 'DE_ESCALATE') {
    alpha.economy = Math.min(100, alpha.economy + 5);
    alpha.stability = Math.min(100, alpha.stability + 4);
    alpha.airDefense = Math.min(100, alpha.airDefense + 4);
    alpha.alliedSupport = Math.min(100, alpha.alliedSupport + 5);
    events.push(`Country Alpha initiated pullbacks and de-escalated posture, gaining international aid and economic recovery (+5 Econ, +4 Stability, +4 AirDef, +5 Allied).`);
  }

  if (betaAct === 'STATUS_QUO') {
    beta.economy = Math.min(100, beta.economy + 2);
    beta.airDefense = Math.min(100, beta.airDefense + 2);
    events.push(`Country Beta maintained Status Quo, allowing local supply chains to rebuild (+2 Econ, +2 AirDef).`);
  } else if (betaAct === 'DE_ESCALATE') {
    beta.economy = Math.min(100, beta.economy + 5);
    beta.stability = Math.min(100, beta.stability + 4);
    beta.airDefense = Math.min(100, beta.airDefense + 4);
    beta.alliedSupport = Math.min(100, beta.alliedSupport + 5);
    events.push(`Country Beta initiated pullbacks and de-escalated posture, gaining international aid and economic recovery (+5 Econ, +4 Stability, +4 AirDef, +5 Allied).`);
  }
}
