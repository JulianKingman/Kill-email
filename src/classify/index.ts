export * from './types';
export * from './categories';
export * from './claude';
export * from './system-one';

import { KillEmailConfig, SmartKnobs } from '../types';
import { Classifier } from './types';
import { ClaudeClassifier } from './claude';
import { SystemOneClassifier } from './system-one';

export interface ClassifierTiers {
  primary: Classifier;
  // Stronger model for low-confidence answers; null when there is no Claude API key
  escalation: ClaudeClassifier | null;
}

export function createClassifiers(config: KillEmailConfig, knobs: SmartKnobs): ClassifierTiers {
  const { llm, processing, classifier } = config;
  const escalation = llm.apiKey
    ? new ClaudeClassifier({
        apiKey: llm.apiKey,
        model: llm.smartModel,
        batchSize: knobs.smartBatchSize,
        effort: 'medium',
        escalated: true,
        processing,
      })
    : null;

  if (classifier.primary === 'system-one') {
    return { primary: new SystemOneClassifier(classifier.systemOne), escalation };
  }

  if (!llm.apiKey) {
    throw new Error('The Claude classifier needs an Anthropic API key');
  }
  return {
    primary: new ClaudeClassifier({
      apiKey: llm.apiKey,
      model: llm.fastModel,
      batchSize: knobs.fastBatchSize,
      escalated: false,
      processing,
    }),
    escalation,
  };
}
