export class AgentSkillExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentSkillExecutionError';
  }
}
