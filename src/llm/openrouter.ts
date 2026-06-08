import type { GameConfig, GameState, TurnDecision } from '../types';
import { getSystemPrompt, getUserPrompt } from './prompts';

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

// Helper to clean and parse JSON from the model response
function parseModelJson(content: string): TurnDecision {
  const cleaned = content.trim();
  
  // Try direct parsing first
  try {
    const parsed = JSON.parse(cleaned);
    return validateAndNormalizeDecision(parsed);
  } catch (e) {
    // If that fails, try to extract from markdown code blocks
    const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
    const match = cleaned.match(jsonRegex);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1].trim());
        return validateAndNormalizeDecision(parsed);
      } catch (innerError) {
        // Fall through to regex extraction
      }
    }

    // Try extracting anything between the first '{' and the last '}'
    const braceRegex = /(\{[\s\S]*\})/i;
    const braceMatch = cleaned.match(braceRegex);
    if (braceMatch && braceMatch[1]) {
      try {
        const parsed = JSON.parse(braceMatch[1].trim());
        return validateAndNormalizeDecision(parsed);
      } catch (innerError) {
        // Fall through
      }
    }

    throw new Error(`Failed to parse structured JSON from model response: "${content.substring(0, 150)}..."`);
  }
}

// Ensure the parsed object matches the TurnDecision structure
function validateAndNormalizeDecision(parsed: any): TurnDecision {
  const validActions = [
    'DE_ESCALATE',
    'STATUS_QUO',
    'DIPLOMATIC_PRESSURE',
    'CYBER_ATTACK',
    'MILITARY_STRIKE',
    'GROUND_INVASION',
    'NUCLEAR_WARNING',
    'TACTICAL_NUKE',
    'STRATEGIC_NUKE',
  ];

  const normalizeAction = (act: any): any => {
    if (typeof act !== 'string') return 'STATUS_QUO';
    const upper = act.toUpperCase().replace(/[-\s]/g, '_');
    if (validActions.includes(upper)) return upper;
    return 'STATUS_QUO';
  };

  return {
    crisisAssessment: parsed.crisisAssessment || 'No assessment provided.',
    opponentPrediction: parsed.opponentPrediction || 'No prediction provided.',
    privateReasoning: parsed.privateReasoning || 'No private reasoning provided.',
    declaredAction: normalizeAction(parsed.declaredAction),
    actualAction: normalizeAction(parsed.actualAction),
  };
}

export async function fetchModelDecision(
  isAlpha: boolean,
  state: GameState,
  config: GameConfig
): Promise<TurnDecision> {
  const modelConfig = isAlpha ? config.modelAlpha : config.modelBeta;
  const systemPrompt = getSystemPrompt(isAlpha, config);
  const userPrompt = getUserPrompt(
    isAlpha,
    state.round + 1,
    state.alpha,
    state.beta,
    state.globalTension,
    state.history
  );

  if (!config.apiKey) {
    throw new Error('OpenRouter API Key is missing. Please enter your key in the header menu.');
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Wargame-AI Strategic Simulator',
      },
      body: JSON.stringify({
        model: modelConfig.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Directing JSON response if supported
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson: any;
      try {
        errJson = JSON.parse(errText);
      } catch (e) {}
      throw new Error(
        errJson?.error?.message || `HTTP error! Status: ${response.status}. Details: ${errText.substring(0, 100)}`
      );
    }

    const data: OpenRouterResponse = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Unknown OpenRouter error.');
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Model returned an empty response.');
    }

    return parseModelJson(content);
  } catch (error: any) {
    console.error('Error calling OpenRouter:', error);
    throw new Error(`[OpenRouter API Error - ${modelConfig.name}]: ${error.message}`);
  }
}
