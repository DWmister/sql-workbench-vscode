export const AI_AGENT_VIEW_ID = 'sqlWorkbench.aiAgent';
export const AI_AGENT_FOCUS_COMMAND_ID = `${AI_AGENT_VIEW_ID}.focus`;

export const AiCommandIds = {
  configure: 'sqlWorkbench.ai.configure',
  explainSql: 'sqlWorkbench.ai.explainSql',
  newConversation: 'sqlWorkbench.ai.newConversation',
  clearHistory: 'sqlWorkbench.ai.clearHistory',
} as const;

export const AiConfigurationKeys = {
  baseUrl: 'sqlWorkbench.ai.baseUrl',
  model: 'sqlWorkbench.ai.model',
  explainInstructions: 'sqlWorkbench.ai.explainInstructions',
} as const;

export const AI_API_KEY_SECRET = 'sqlWorkbench.ai.apiKey';
export const MAX_AI_EXPLAIN_INSTRUCTIONS_LENGTH = 4_000;
